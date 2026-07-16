# Atomic Inventory Mutations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every inventory-changing business action (purchase receipt/return, sales delivery/return,
production consumption/output) becomes one Postgres RPC call wrapping one all-or-nothing
transaction. JS drops all fresh-read/clamp/multi-write logic and calls one RPC per user action.

**Architecture:** Two layers of Postgres function. Row-level primitives (`apply_purchase_receipt`,
`apply_purchase_return`, `apply_sales_delivery`, `apply_sales_return`, `apply_material_consumption`,
`apply_production_output`) each lock their own row(s), validate, write their ledger row, update
their own quantity column — single detail/usage id, single qty. Batch orchestrators
(`apply_purchase_receipt_batch`, `apply_purchase_return_batch`, `apply_sales_delivery_batch`,
`apply_sales_return_batch`, `apply_production_completion`) are the actual RPC entry points JS
calls: lock the header row `FOR UPDATE` first (serializes every action on that header), loop a
`jsonb` line array through the row-level primitive, then recompute header status from the
now-consistent sibling rows.

**Tech Stack:** PostgreSQL (plpgsql functions via Supabase SQL editor — no migration CLI in this
repo, `supabase/function_trigger.sql` is a flat file pasted in manually), TypeScript service layer
(`@supabase/supabase-js` `.rpc()`), React 19 components.

## Global Constraints

- Overflow on a document-level cap that's a data-entry mistake (over-receive, over-return —
  purchase or sales, over-consume material) → `RAISE EXCEPTION`, whole transaction rolls back.
- Overflow on sales delivery specifically (order-remaining **and now also** physical product stock)
  → clamp after locking, return applied qty, no exception — a benign race, not a mistake.
- One user action (e.g. "Receive 3 PO lines") = one RPC call = one transaction. Line arrays travel
  as `jsonb`, decoded with `jsonb_to_recordset`.
- Material consumed during production keeps ledger type `SALES` (existing convention).
  `PRODUCTION` stays exclusive to the finished-goods credit.
- Row-level functions read `material_id`/`product_id`/`unit_cost`/`planned_quantity` off the locked
  row itself — never trust these from the client. Batch line payloads only ever carry
  `{detail_id, quantity}` (plus `unit_cost` nowhere — purchase unit cost is the PO line's own,
  read server-side).
- No automated test runner exists in this repo (`npm run lint` = `tsc --noEmit` is the only
  scripted check; no jest/vitest, no Supabase CLI/psql). SQL verification is a self-contained
  `BEGIN; ... ROLLBACK;` smoke-test block the user pastes into the Supabase SQL editor and reports
  the output of — do not attempt to run these yourself.
- Delete dead code as you go: no re-exported unused fields, no `// removed` comments, no
  backwards-compat shims for the old signatures.

---

### Task 1: Purchase flow SQL — `apply_purchase_receipt(_batch)`, `apply_purchase_return(_batch)`

**Files:**
- Modify: `supabase/function_trigger.sql` (append to `-- function section`; replace the existing
  `apply_purchase_return` definition in place)

**Interfaces:**
- Produces: `apply_purchase_receipt_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL) RETURNS TABLE(detail_id uuid, applied_quantity numeric)` — RPC name `apply_purchase_receipt_batch`, line shape `{detail_id, quantity}`.
- Produces: `apply_purchase_return_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL) RETURNS TABLE(detail_id uuid, applied_quantity numeric)` — RPC name `apply_purchase_return_batch`, line shape `{detail_id, quantity}`.

- [ ] **Step 1: Append the receipt functions to `supabase/function_trigger.sql`**

Add at the end of the file (after `apply_manual_stock_decrease`):

```sql
-- Receiving is now one atomic transaction per submit, not per-line JS round trips. Throws on
-- over-receipt (a data-entry mistake — the line just doesn't have that much left to receive), not
-- a clamp: see docs/superpowers/specs/2026-07-14-atomic-inventory-mutations-design.md decision #1.
CREATE OR REPLACE FUNCTION apply_purchase_receipt(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_quantity numeric;
    v_received numeric;
    v_material_id uuid;
    v_unit_cost numeric;
    v_remaining numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT quantity, received_quantity, material_id, unit_cost
    INTO v_quantity, v_received, v_material_id, v_unit_cost
    FROM purchase_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase line % not found', p_detail_id;
    END IF;

    v_remaining := v_quantity - v_received;
    IF p_qty > v_remaining THEN
        RAISE EXCEPTION 'Cannot receive % — only % still outstanding on this line', p_qty, v_remaining;
    END IF;

    UPDATE purchase_detail
    SET received_quantity = v_received + p_qty
    WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (material_id, transaction_type, quantity, unit_cost, purchase_detail_id, remark)
    VALUES (v_material_id, 'PURCHASE', p_qty, v_unit_cost, p_detail_id, p_remark);

    RETURN p_qty;
END;
$$;

-- One RPC per "Receive Goods" submit — all lines commit together or none do. Header lock
-- serializes this against any other action on the same PO (a concurrent Return, another Receive).
CREATE OR REPLACE FUNCTION apply_purchase_receipt_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_any_positive boolean;
    v_fully_received boolean;
BEGIN
    PERFORM id FROM purchase_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order % not found', p_header_id;
    END IF;

    SELECT bool_or((x->>'quantity')::numeric > 0) INTO v_any_positive
    FROM jsonb_array_elements(p_lines) x;
    IF NOT COALESCE(v_any_positive, false) THEN
        RAISE EXCEPTION 'Enter a quantity to receive for at least one line';
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM purchase_detail WHERE detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to purchase order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_purchase_receipt(v_line.detail_id, v_line.quantity, p_remark);
        RETURN NEXT;
    END LOOP;

    SELECT bool_and(pd.received_quantity >= pd.quantity) INTO v_fully_received
    FROM purchase_detail pd WHERE pd.header_id = p_header_id;

    UPDATE purchase_header
    SET status = CASE WHEN v_fully_received THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END,
        received_date = CURRENT_DATE
    WHERE id = p_header_id;

    RETURN;
END;
$$;
```

- [ ] **Step 2: Replace `apply_purchase_return` and add its batch wrapper**

The existing `apply_purchase_return(uuid, numeric, numeric, text)` (in `function_trigger.sql`, the
one that already inserts its own ledger row) changes signature — it no longer takes `p_unit_cost`
(read off the row instead) and now throws instead of clamping. Drop the old overload first, then
add the new one plus its batch wrapper, right after where the old definition was:

```sql
DROP FUNCTION IF EXISTS apply_purchase_return(uuid, numeric, numeric, text);

-- Now throws on over-return instead of clamping (decision #1), and no longer takes p_unit_cost —
-- it's the PO line's own unit_cost, read under the same lock, not a separate client-supplied value.
CREATE OR REPLACE FUNCTION apply_purchase_return(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_received numeric;
    v_returned numeric;
    v_material_id uuid;
    v_unit_cost numeric;
    v_material_qty numeric;
    v_remaining numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT received_quantity, returned_quantity, material_id, unit_cost
    INTO v_received, v_returned, v_material_id, v_unit_cost
    FROM purchase_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase line % not found', p_detail_id;
    END IF;
    IF v_material_id IS NULL THEN
        RAISE EXCEPTION 'Purchase line % has no material linked', p_detail_id;
    END IF;

    v_remaining := v_received - v_returned;
    IF p_qty > v_remaining THEN
        RAISE EXCEPTION 'Cannot return % — only % received and not yet returned', p_qty, v_remaining;
    END IF;

    SELECT quantity INTO v_material_qty FROM material WHERE id = v_material_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material % not found', v_material_id;
    END IF;
    IF p_qty > v_material_qty THEN
        RAISE EXCEPTION 'Cannot return % — only % currently in stock (rest already consumed)', p_qty, v_material_qty;
    END IF;

    UPDATE purchase_detail SET returned_quantity = v_returned + p_qty WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (material_id, transaction_type, quantity, unit_cost, purchase_detail_id, remark)
    VALUES (v_material_id, 'PURCHASE_RETURN', -p_qty, v_unit_cost, p_detail_id, p_remark);

    RETURN p_qty;
END;
$$;

CREATE OR REPLACE FUNCTION apply_purchase_return_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_fully_returned boolean;
BEGIN
    PERFORM id FROM purchase_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order % not found', p_header_id;
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM purchase_detail WHERE detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to purchase order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_purchase_return(v_line.detail_id, v_line.quantity, p_remark);
        RETURN NEXT;
    END LOOP;

    SELECT bool_and(pd.returned_quantity >= pd.received_quantity) INTO v_fully_returned
    FROM purchase_detail pd WHERE pd.header_id = p_header_id;

    UPDATE purchase_header
    SET status = CASE WHEN v_fully_returned THEN 'RETURNED' ELSE 'PARTIALLY_RETURNED' END
    WHERE id = p_header_id;

    RETURN;
END;
$$;
```

- [ ] **Step 3: Manual verification — paste into Supabase SQL editor**

Report the output back before moving on. This is a self-contained fixture, nothing persists:

```sql
BEGIN;

INSERT INTO vendors (id, company_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Test Vendor');
INSERT INTO material (id, name, quantity) VALUES ('22222222-2222-2222-2222-222222222222', 'Test Material', 0);
INSERT INTO purchase_header (id, purchase_no, quotation_date, status, vendor_id)
  VALUES ('33333333-3333-3333-3333-333333333333', 'PO-TEST', now(), 'ORDERED', '11111111-1111-1111-1111-111111111111');
INSERT INTO purchase_detail (detail_id, header_id, material_id, material_name, quantity, unit_cost)
  VALUES ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
          '22222222-2222-2222-2222-222222222222', 'Test Material', 10, 5);

-- Receive 6 of 10 — expect one row (applied 6), material.quantity 6, header PARTIALLY_RECEIVED
SELECT * FROM apply_purchase_receipt_batch('33333333-3333-3333-3333-333333333333',
  '[{"detail_id":"44444444-4444-4444-4444-444444444444","quantity":6}]'::jsonb, 'test receipt');
SELECT quantity FROM material WHERE id = '22222222-2222-2222-2222-222222222222'; -- expect 6
SELECT status, received_date FROM purchase_header WHERE id = '33333333-3333-3333-3333-333333333333'; -- expect PARTIALLY_RECEIVED

-- Over-receive — expect an ERROR, nothing else changes
SELECT * FROM apply_purchase_receipt_batch('33333333-3333-3333-3333-333333333333',
  '[{"detail_id":"44444444-4444-4444-4444-444444444444","quantity":100}]'::jsonb, null);

-- Receive the rest — expect header RECEIVED
SELECT * FROM apply_purchase_receipt_batch('33333333-3333-3333-3333-333333333333',
  '[{"detail_id":"44444444-4444-4444-4444-444444444444","quantity":4}]'::jsonb, null);
SELECT status FROM purchase_header WHERE id = '33333333-3333-3333-3333-333333333333'; -- expect RECEIVED

-- Return 3 — expect material.quantity 7, header PARTIALLY_RETURNED
SELECT * FROM apply_purchase_return_batch('33333333-3333-3333-3333-333333333333',
  '[{"detail_id":"44444444-4444-4444-4444-444444444444","quantity":3}]'::jsonb, 'test return');
SELECT quantity FROM material WHERE id = '22222222-2222-2222-2222-222222222222'; -- expect 7
SELECT status FROM purchase_header WHERE id = '33333333-3333-3333-3333-333333333333'; -- expect PARTIALLY_RETURNED

-- Over-return (more than the 7 still returnable) — expect an ERROR
SELECT * FROM apply_purchase_return_batch('33333333-3333-3333-3333-333333333333',
  '[{"detail_id":"44444444-4444-4444-4444-444444444444","quantity":50}]'::jsonb, null);

ROLLBACK;
```

Expected: the two `SELECT * FROM apply_..._batch(...)` calls with over-large quantities raise
`ERROR: Cannot receive ... only ... still outstanding` and `ERROR: Cannot return ... only ...
received and not yet returned` respectively; every other statement succeeds with the commented
expected value.

- [ ] **Step 4: Commit**

```bash
git add supabase/function_trigger.sql
git commit -m "feat(db): atomic purchase receipt/return RPCs"
```

---

### Task 2: Sales delivery/return SQL — `apply_sales_delivery(_batch)`, `apply_sales_return(_batch)`

**Files:**
- Modify: `supabase/function_trigger.sql` (replace `apply_sales_delivery` and `apply_sales_return`
  in place; append the two batch wrappers)

**Interfaces:**
- Produces: `apply_sales_delivery_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL) RETURNS TABLE(detail_id uuid, applied_quantity numeric)`
- Produces: `apply_sales_return_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL) RETURNS TABLE(detail_id uuid, applied_quantity numeric)`

- [ ] **Step 1: Replace `apply_sales_delivery`**

```sql
DROP FUNCTION IF EXISTS apply_sales_delivery(uuid, numeric);

-- Now also clamps against physical product stock (locked), not just the order line — closes a real
-- gap: today only an unlocked JS pre-check estimates this. Still clamps, doesn't throw (decision
-- #1's exception to the throw rule) — this is the one place a genuine concurrent race is expected.
-- Now inserts its own SALES ledger row too, instead of leaving that to a follow-up JS call.
CREATE OR REPLACE FUNCTION apply_sales_delivery(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_quantity numeric;
    v_delivered numeric;
    v_product_id uuid;
    v_product_qty numeric;
    v_applied numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT quantity, delivered_quantity, product_id
    INTO v_quantity, v_delivered, v_product_id
    FROM sales_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF v_product_id IS NOT NULL THEN
        SELECT quantity INTO v_product_qty FROM product WHERE id = v_product_id FOR UPDATE;
        v_product_qty := COALESCE(v_product_qty, 0);
    ELSE
        v_product_qty := 0;
    END IF;

    v_applied := GREATEST(0, LEAST(p_qty, v_quantity - v_delivered, v_product_qty));
    IF v_applied <= 0 THEN
        RETURN 0;
    END IF;

    UPDATE sales_detail SET delivered_quantity = v_delivered + v_applied WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (product_id, transaction_type, quantity, sales_detail_id, remark)
    VALUES (v_product_id, 'SALES', -v_applied, p_detail_id, p_remark);

    RETURN v_applied;
END;
$$;

CREATE OR REPLACE FUNCTION apply_sales_delivery_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_any_applied boolean := false;
    v_fully_delivered boolean;
BEGIN
    PERFORM id FROM sales_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found', p_header_id;
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM sales_detail WHERE detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to sales order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_sales_delivery(v_line.detail_id, v_line.quantity, p_remark);
        IF applied_quantity > 0 THEN v_any_applied := true; END IF;
        RETURN NEXT;
    END LOOP;

    IF NOT v_any_applied THEN
        RETURN;
    END IF;

    SELECT bool_and(sd.delivered_quantity >= sd.quantity) INTO v_fully_delivered
    FROM sales_detail sd WHERE sd.header_id = p_header_id;

    UPDATE sales_header
    SET status = CASE WHEN v_fully_delivered THEN 'DELIVERED' ELSE 'PARTIALLY_DELIVERED' END
    WHERE id = p_header_id;

    RETURN;
END;
$$;
```

- [ ] **Step 2: Replace `apply_sales_return`**

```sql
DROP FUNCTION IF EXISTS apply_sales_return(uuid, numeric);

-- Now throws on over-return instead of clamping (decision #1 — Sales Return is in the throw
-- bucket, unlike Sales Delivery above). Now inserts its own SALES_RETURN ledger row too.
CREATE OR REPLACE FUNCTION apply_sales_return(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_delivered numeric;
    v_returned numeric;
    v_product_id uuid;
    v_remaining numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT delivered_quantity, returned_quantity, product_id
    INTO v_delivered, v_returned, v_product_id
    FROM sales_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales line % not found', p_detail_id;
    END IF;

    v_remaining := v_delivered - v_returned;
    IF p_qty > v_remaining THEN
        RAISE EXCEPTION 'Cannot return % — only % delivered and not yet returned', p_qty, v_remaining;
    END IF;

    UPDATE sales_detail SET returned_quantity = v_returned + p_qty WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (product_id, transaction_type, quantity, sales_detail_id, remark)
    VALUES (v_product_id, 'SALES_RETURN', p_qty, p_detail_id, p_remark);

    RETURN p_qty;
END;
$$;

CREATE OR REPLACE FUNCTION apply_sales_return_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_fully_returned boolean;
BEGIN
    PERFORM id FROM sales_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found', p_header_id;
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM sales_detail WHERE detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to sales order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_sales_return(v_line.detail_id, v_line.quantity, p_remark);
        RETURN NEXT;
    END LOOP;

    SELECT bool_and(sd.returned_quantity >= sd.delivered_quantity) INTO v_fully_returned
    FROM sales_detail sd WHERE sd.header_id = p_header_id;

    UPDATE sales_header
    SET status = CASE WHEN v_fully_returned THEN 'RETURNED' ELSE 'PARTIALLY_RETURNED' END
    WHERE id = p_header_id;

    RETURN;
END;
$$;
```

- [ ] **Step 3: Manual verification — paste into Supabase SQL editor**

```sql
BEGIN;

INSERT INTO clients (id, company_name) VALUES ('55555555-5555-5555-5555-555555555555', 'Test Client');
INSERT INTO product (id, name, quantity) VALUES ('66666666-6666-6666-6666-666666666666', 'Test Product', 4);
INSERT INTO sales_header (id, sales_no, order_date, status, client_id)
  VALUES ('77777777-7777-7777-7777-777777777777', 'SO-TEST', now(), 'ORDERED', '55555555-5555-5555-5555-555555555555');
INSERT INTO sales_detail (detail_id, header_id, product_id, product_name, quantity, unit_price)
  VALUES ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777',
          '66666666-6666-6666-6666-666666666666', 'Test Product', 10, 20);

-- Ask for 6, only 4 in stock and 10 ordered — expect clamp to 4, no exception
SELECT * FROM apply_sales_delivery_batch('77777777-7777-7777-7777-777777777777',
  '[{"detail_id":"88888888-8888-8888-8888-888888888888","quantity":6}]'::jsonb, 'test delivery');
SELECT quantity FROM product WHERE id = '66666666-6666-6666-6666-666666666666'; -- expect 0
SELECT status, delivered_quantity FROM sales_detail WHERE detail_id = '88888888-8888-8888-8888-888888888888'; -- delivered_quantity 4
SELECT status FROM sales_header WHERE id = '77777777-7777-7777-7777-777777777777'; -- expect PARTIALLY_DELIVERED

-- Return 5 (only 4 delivered) — expect an ERROR
SELECT * FROM apply_sales_return_batch('77777777-7777-7777-7777-777777777777',
  '[{"detail_id":"88888888-8888-8888-8888-888888888888","quantity":5}]'::jsonb, null);

-- Return 4 — expect product back to 4, header RETURNED
SELECT * FROM apply_sales_return_batch('77777777-7777-7777-7777-777777777777',
  '[{"detail_id":"88888888-8888-8888-8888-888888888888","quantity":4}]'::jsonb, 'test return');
SELECT quantity FROM product WHERE id = '66666666-6666-6666-6666-666666666666'; -- expect 4
SELECT status FROM sales_header WHERE id = '77777777-7777-7777-7777-777777777777'; -- expect RETURNED

ROLLBACK;
```

Expected: the 5-qty return raises `ERROR: Cannot return ... only ... delivered and not yet
returned`; everything else matches the commented values.

- [ ] **Step 4: Commit**

```bash
git add supabase/function_trigger.sql
git commit -m "feat(db): atomic sales delivery/return RPCs, delivery now stock-checked"
```

---

### Task 3: Production SQL — `apply_material_consumption`, `apply_production_output`, `apply_production_completion`

**Files:**
- Modify: `supabase/function_trigger.sql` (append)

**Interfaces:**
- Produces: `apply_material_consumption(p_usage_id uuid, p_qty numeric, p_remark text DEFAULT NULL) RETURNS numeric`
- Produces: `apply_production_output(p_detail_id uuid, p_qty numeric) RETURNS numeric`
- Produces: `apply_production_completion(p_header_id uuid, p_reconciliations jsonb, p_leftovers jsonb, p_produced jsonb) RETURNS void` — the RPC `confirmProductionDone()` calls. `p_reconciliations` line shape `{usage_id, actual_quantity}`, `p_leftovers` shape `{sales_detail_id, material_id, quantity}`, `p_produced` shape `{detail_id, quantity}`.

- [ ] **Step 1: Append the two row-level primitives**

```sql
-- Closes the other half of Known Gap #2 in docs/flows.md: material deducted during production
-- (over-usage reconciliation, AUTOMATIC consumable burn) had no floor check. Always SALES-typed —
-- both callers are material leaving during production, matching the existing convention.
CREATE OR REPLACE FUNCTION apply_material_consumption(p_usage_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_material_id uuid;
    v_material_qty numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT material_id INTO v_material_id
    FROM production_material_usage
    WHERE id = p_usage_id
    FOR UPDATE;

    IF NOT FOUND OR v_material_id IS NULL THEN
        RAISE EXCEPTION 'Material usage row % not found or has no material linked', p_usage_id;
    END IF;

    SELECT quantity INTO v_material_qty FROM material WHERE id = v_material_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material % not found', v_material_id;
    END IF;
    IF p_qty > v_material_qty THEN
        RAISE EXCEPTION 'Cannot consume % — only % in stock', p_qty, v_material_qty;
    END IF;

    INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id, remark)
    VALUES (v_material_id, 'SALES', -p_qty, p_usage_id, p_remark);

    RETURN p_qty;
END;
$$;

-- No upper cap — over-producing is legitimate (yield above plan is extra credit, already how
-- produced_quantity works today). Overwrite, not additive: safe because apply_production_completion
-- claims the header exactly once (IN_PRODUCTION -> DONE_IN_PRODUCTION), so this runs at most once
-- per line per order.
CREATE OR REPLACE FUNCTION apply_production_output(p_detail_id uuid, p_qty numeric)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id uuid;
BEGIN
    SELECT product_id INTO v_product_id
    FROM sales_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales line % not found', p_detail_id;
    END IF;

    UPDATE sales_detail SET produced_quantity = p_qty WHERE detail_id = p_detail_id;

    UPDATE workflow_tasks
    SET status = 'DONE', end_date = CURRENT_DATE
    WHERE sales_detail_id = p_detail_id AND status NOT IN ('DONE', 'CANCELLED');

    IF p_qty > 0 THEN
        INSERT INTO inventory_transaction (product_id, transaction_type, quantity, sales_detail_id)
        VALUES (v_product_id, 'PRODUCTION', p_qty, p_detail_id);
    END IF;

    RETURN p_qty;
END;
$$;
```

- [ ] **Step 2: Append the orchestrator**

```sql
-- The whole "Mark Production Done" action in one transaction. Replaces confirmProductionDone()'s
-- JS-side loop of saveInventoryTransaction calls entirely.
CREATE OR REPLACE FUNCTION apply_production_completion(
    p_header_id uuid,
    p_reconciliations jsonb,
    p_leftovers jsonb,
    p_produced jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_claimed uuid;
    v_recon record;
    v_consumable record;
    v_leftover record;
    v_produced_line record;
    v_planned numeric;
    v_material_id uuid;
    v_sales_detail_id uuid;
    v_diff numeric;
    v_leftover_qty numeric;
    v_new_usage_id uuid;
BEGIN
    -- Idempotency claim, same guard as today: only the caller that actually flips
    -- IN_PRODUCTION -> DONE_IN_PRODUCTION writes anything. A retry after a partial failure finds
    -- the order already done and is a no-op.
    UPDATE sales_header
    SET status = 'DONE_IN_PRODUCTION'
    WHERE id = p_header_id AND status = 'IN_PRODUCTION'
    RETURNING id INTO v_claimed;

    IF v_claimed IS NULL THEN
        RETURN;
    END IF;

    -- Reconciliation: diff = planned - actual. planned is read off the locked row, never trusted
    -- from the client. diff<0 (used more) goes through the guarded consumption function; diff>0
    -- (used less) is a safe increase, plain insert.
    FOR v_recon IN
        SELECT * FROM jsonb_to_recordset(p_reconciliations) AS x(usage_id uuid, actual_quantity numeric)
    LOOP
        SELECT planned_quantity, material_id, sales_detail_id
        INTO v_planned, v_material_id, v_sales_detail_id
        FROM production_material_usage
        WHERE id = v_recon.usage_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Material usage row % not found', v_recon.usage_id;
        END IF;

        v_diff := v_planned - v_recon.actual_quantity;

        -- Leftovers targeting this same (sales_detail_id, material_id) merge into this row's
        -- returned_quantity instead of becoming a second row.
        SELECT COALESCE(SUM((x->>'quantity')::numeric), 0) INTO v_leftover_qty
        FROM jsonb_to_recordset(p_leftovers) AS x(sales_detail_id uuid, material_id uuid, quantity numeric)
        WHERE x.sales_detail_id = v_sales_detail_id AND x.material_id = v_material_id;

        IF v_diff < 0 THEN
            PERFORM apply_material_consumption(v_recon.usage_id, -v_diff, NULL);
        ELSIF v_diff > 0 THEN
            INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id)
            VALUES (v_material_id, 'ADJUSTMENT', v_diff, v_recon.usage_id);
        END IF;

        IF v_leftover_qty > 0 THEN
            INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id)
            VALUES (v_material_id, 'ADJUSTMENT', v_leftover_qty, v_recon.usage_id);
        END IF;

        UPDATE production_material_usage
        SET actual_quantity = v_recon.actual_quantity,
            returned_quantity = GREATEST(0, v_diff) + v_leftover_qty
        WHERE id = v_recon.usage_id;
    END LOOP;

    -- AUTOMATIC consumables: found here, not passed in by the client. addOrderConsumable() (Kanban,
    -- unchanged) already set actual_quantity; this just burns it, guarded.
    FOR v_consumable IN
        SELECT pmu.id AS usage_id, pmu.actual_quantity AS actual_quantity
        FROM production_material_usage pmu
        JOIN sales_detail sd ON sd.detail_id = pmu.sales_detail_id
        JOIN material m ON m.id = pmu.material_id
        WHERE sd.header_id = p_header_id
          AND m.material_type = 'CONSUMABLE_MATERIAL'
          AND COALESCE(pmu.consumption_mode, m.consumption_mode) = 'AUTOMATIC'
          AND pmu.actual_quantity > 0
    LOOP
        PERFORM apply_material_consumption(v_consumable.usage_id, v_consumable.actual_quantity, NULL);
    END LOOP;

    -- Leftovers for a material with no existing planned row on that line — a genuine unplanned
    -- by-product — get their own new usage row. (Ones matching a reconciled row were already
    -- merged above.)
    FOR v_leftover IN
        SELECT * FROM jsonb_to_recordset(p_leftovers) AS x(sales_detail_id uuid, material_id uuid, quantity numeric)
    LOOP
        IF v_leftover.quantity <= 0 THEN CONTINUE; END IF;

        IF EXISTS (
            SELECT 1
            FROM production_material_usage pmu
            JOIN jsonb_to_recordset(p_reconciliations) AS r(usage_id uuid, actual_quantity numeric) ON r.usage_id = pmu.id
            WHERE pmu.sales_detail_id = v_leftover.sales_detail_id AND pmu.material_id = v_leftover.material_id
        ) THEN
            CONTINUE;
        END IF;

        INSERT INTO production_material_usage (sales_detail_id, material_id, planned_quantity, actual_quantity, returned_quantity, remark)
        VALUES (v_leftover.sales_detail_id, v_leftover.material_id, 0, 0, v_leftover.quantity, 'Leftover from production')
        RETURNING id INTO v_new_usage_id;

        INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id)
        VALUES (v_leftover.material_id, 'ADJUSTMENT', v_leftover.quantity, v_new_usage_id);
    END LOOP;

    -- Actual produced credits finished goods at the yield actually achieved, not the plan.
    FOR v_produced_line IN
        SELECT * FROM jsonb_to_recordset(p_produced) AS x(detail_id uuid, quantity numeric)
    LOOP
        PERFORM apply_production_output(v_produced_line.detail_id, v_produced_line.quantity);
    END LOOP;

    -- Belt-and-suspenders close for any line with no produced entry.
    UPDATE workflow_tasks wt
    SET status = 'DONE', end_date = CURRENT_DATE
    FROM sales_detail sd
    WHERE wt.sales_detail_id = sd.detail_id
      AND sd.header_id = p_header_id
      AND wt.status NOT IN ('DONE', 'CANCELLED');
END;
$$;
```

- [ ] **Step 3: Manual verification — paste into Supabase SQL editor**

```sql
BEGIN;

INSERT INTO clients (id, company_name) VALUES ('99999999-9999-9999-9999-999999999999', 'Test Client 2');
INSERT INTO product (id, name, quantity) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Product 2', 0);
INSERT INTO material (id, name, quantity) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test Material 2', 5);
INSERT INTO sales_header (id, sales_no, order_date, status, client_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'SO-TEST-2', now(), 'IN_PRODUCTION', '99999999-9999-9999-9999-999999999999');
INSERT INTO sales_detail (detail_id, header_id, product_id, product_name, quantity, unit_price, produce_quantity)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Product 2', 5, 20, 5);
INSERT INTO production_material_usage (id, sales_detail_id, material_id, planned_quantity)
  VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 4);

-- Used 6 (more than the 4 planned, only 5 in stock) — expect an ERROR, nothing commits
SELECT apply_production_completion('cccccccc-cccc-cccc-cccc-cccccccccccc',
  '[{"usage_id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","actual_quantity":6}]'::jsonb, '[]'::jsonb,
  '[{"detail_id":"dddddddd-dddd-dddd-dddd-dddddddddddd","quantity":5}]'::jsonb);

-- Used 3 (less than planned 4) and produced 5 — expect material 5+1=6, product 0+5=5, header DONE_IN_PRODUCTION
SELECT apply_production_completion('cccccccc-cccc-cccc-cccc-cccccccccccc',
  '[{"usage_id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","actual_quantity":3}]'::jsonb, '[]'::jsonb,
  '[{"detail_id":"dddddddd-dddd-dddd-dddd-dddddddddddd","quantity":5}]'::jsonb);
SELECT quantity FROM material WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; -- expect 6
SELECT quantity FROM product WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; -- expect 5
SELECT status FROM sales_header WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; -- expect DONE_IN_PRODUCTION

-- Second call is a no-op (idempotency claim) — expect no error, no change
SELECT apply_production_completion('cccccccc-cccc-cccc-cccc-cccccccccccc', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
SELECT quantity FROM product WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; -- still 5

ROLLBACK;
```

Expected: the 6-qty call raises `ERROR: Cannot consume ... only ... in stock`; the second call
succeeds with the commented values; the third call is silent and changes nothing.

- [ ] **Step 4: Commit**

```bash
git add supabase/function_trigger.sql
git commit -m "feat(db): atomic production completion RPC, closes negative-stock gap on over-usage"
```

---

### Task 4: `PurchasesService.ts` + `PurchasesView.tsx` — wire up receipt/return

**Files:**
- Modify: `src/services/PurchasesService.ts:288-493` (the `ReceiveLine`/`PurchaseReturnLine`
  interfaces, `receivePurchaseOrder`, `getMaterialStock`, `returnPurchaseOrder`)
- Modify: `src/components/PurchasesView.tsx:546-617` (`handleReceive`, `handleReturn`)

**Interfaces:**
- Consumes: RPCs `apply_purchase_receipt_batch`, `apply_purchase_return_batch` from Task 1.
- Produces: `ReceiveLine { detailId: string; quantity: number }`, `PurchaseReturnLine { detailId: string; quantity: number }` — both drop `materialId`/`unitCost`, now dead (the RPC reads them off the row).

- [ ] **Step 1: Replace the interfaces, `receivePurchaseOrder`, and `returnPurchaseOrder` in `src/services/PurchasesService.ts`**

Replace lines 288–370 (`ReceiveLine` interface through the end of `receivePurchaseOrder`):

```typescript
export interface ReceiveLine {
  detailId: string;
  quantity: number; // > 0; validated server-side against quantity − receivedQuantity
}

// Books goods in from the vendor — one atomic transaction per submit via apply_purchase_receipt_batch
// (function_trigger.sql): every line commits together or the whole receipt throws and rolls back.
// The RPC clamps nothing — an over-receipt is a data-entry mistake, not a race, so it raises instead.
export const receivePurchaseOrder = async (
  purchase: PurchaseHeader,
  lines: ReceiveLine[],
  remark?: string,
): Promise<void> => {
  const payload = lines.filter(l => l.quantity > 0).map(l => ({ detail_id: l.detailId, quantity: l.quantity }));
  if (payload.length === 0) return;

  const { error } = await supabase.rpc('apply_purchase_receipt_batch', {
    p_header_id: purchase.id,
    p_lines: payload,
    p_remark: remark ?? null,
  });
  if (error) {
    console.error('receivePurchaseOrder', error);
    throw error;
  }
};
```

Then delete the `getMaterialStock` helper and its doc comment (originally around what was lines
400–412 — the "Current material stock, keyed by id" block) and replace `returnPurchaseOrder`
(originally lines 388–493, `PurchaseReturnLine` interface through the end of the function) with:

```typescript
export interface PurchaseReturnLine {
  detailId: string;
  quantity: number; // > 0; validated server-side against receivedQuantity − returnedQuantity and current material stock
}

// Sends received material back to the vendor — one atomic transaction per submit via
// apply_purchase_return_batch (function_trigger.sql). Throws (and rolls back the whole submit) on
// over-return or on trying to return more than is currently in stock (already consumed elsewhere)
// — the RPC's exception message replaces the old JS pre-check.
export const returnPurchaseOrder = async (
  purchase: PurchaseHeader,
  lines: PurchaseReturnLine[],
  remark?: string,
): Promise<void> => {
  const payload = lines.filter(l => l.quantity > 0).map(l => ({ detail_id: l.detailId, quantity: l.quantity }));
  if (payload.length === 0) return;

  const { error } = await supabase.rpc('apply_purchase_return_batch', {
    p_header_id: purchase.id,
    p_lines: payload,
    p_remark: remark ?? null,
  });
  if (error) {
    console.error('returnPurchaseOrder', error);
    throw error;
  }
};
```

Remove the now-unused `saveInventoryTransaction` import (line 13) — nothing in this file calls it
anymore. Confirm `generateId` and `nowIso` are still used elsewhere in the file (they are —
`createPurchaseQuotation`) and leave those imports alone.

- [ ] **Step 2: Update `handleReceive`/`handleReturn` in `src/components/PurchasesView.tsx`**

Replace the line-building in `handleReceive` (around line 548):

```typescript
    const lines: ReceiveLine[] = receivingPurchase.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);
```

And in `handleReturn` (around line 588):

```typescript
    const lines: PurchaseReturnLine[] = returningPurchase.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors. If `ReceiveLine`/`PurchaseReturnLine` still show `materialId`/`unitCost` usages
anywhere, the compiler will point at them — remove those call sites too (there shouldn't be any
outside what this task already touched).

- [ ] **Step 4: Commit**

```bash
git add src/services/PurchasesService.ts src/components/PurchasesView.tsx
git commit -m "refactor: PurchasesService receipt/return call the atomic batch RPCs"
```

---

### Task 5: `OrdersService.ts` + `OrdersView.tsx` — wire up delivery/return

**Files:**
- Modify: `src/services/OrdersService.ts:781-1097` (`DeliveryLine`, `markDelivered`,
  `SalesReturnLine`, `returnSalesOrder`)
- Modify: `src/components/OrdersView.tsx:823-890` (`handleMarkDelivered`, `handleReturn`)

**Interfaces:**
- Consumes: RPCs `apply_sales_delivery_batch`, `apply_sales_return_batch` from Task 2.
- Produces: `DeliveryLine { detailId: string; quantity: number }`, `SalesReturnLine { detailId: string; quantity: number }` — both drop `productId`, now dead.

- [ ] **Step 1: Replace `DeliveryLine`/`markDelivered` in `src/services/OrdersService.ts`**

Replace lines 781–890 (`DeliveryLine` interface through the end of `markDelivered`):

```typescript
export interface DeliveryLine {
  detailId: string;
  quantity: number; // > 0; clamped server-side to min(quantity − deliveredQuantity, product stock)
}

// Shipping is what takes finished goods out of stock — one atomic transaction per submit via
// apply_sales_delivery_batch (function_trigger.sql). Clamps rather than throws (decision #1's
// exception): a request that outruns what's left is a benign race (another delivery, or stock
// genuinely short), not a mistake, so it silently ships what it can rather than blocking the rest
// of the batch.
export const markDelivered = async (
  header: SalesHeader,
  lines: DeliveryLine[],
  remark?: string,
): Promise<void> => {
  const payload = lines.filter(l => l.quantity > 0).map(l => ({ detail_id: l.detailId, quantity: l.quantity }));
  if (payload.length === 0) return;

  const { error } = await supabase.rpc('apply_sales_delivery_batch', {
    p_header_id: header.id,
    p_lines: payload,
    p_remark: remark ?? null,
  });
  if (error) {
    console.error('markDelivered', error);
    throw error;
  }
};
```

- [ ] **Step 2: Replace `SalesReturnLine`/`returnSalesOrder`**

Replace lines 1017–1097 (`SalesReturnLine` interface through the end of `returnSalesOrder`):

```typescript
export interface SalesReturnLine {
  detailId: string;
  quantity: number; // > 0; validated server-side against deliveredQuantity − returnedQuantity
}

// The client sends finished goods back — one atomic transaction per submit via
// apply_sales_return_batch (function_trigger.sql). Throws on over-return (decision #1): you cannot
// return more than actually shipped, and that's a data-entry mistake, not a race.
export const returnSalesOrder = async (
  header: SalesHeader,
  lines: SalesReturnLine[],
  remark?: string,
): Promise<void> => {
  const payload = lines.filter(l => l.quantity > 0).map(l => ({ detail_id: l.detailId, quantity: l.quantity }));
  if (payload.length === 0) return;

  const { error } = await supabase.rpc('apply_sales_return_batch', {
    p_header_id: header.id,
    p_lines: payload,
    p_remark: remark ?? null,
  });
  if (error) {
    console.error('returnSalesOrder', error);
    throw error;
  }
};
```

`getProductStock` (used by Start Production's ATP panel) is untouched — only markDelivered's own
internal pre-check block is gone, not the exported function itself.

- [ ] **Step 3: Update `handleMarkDelivered`/`handleReturn` in `src/components/OrdersView.tsx`**

Replace the line-building in `handleMarkDelivered` (around line 825):

```typescript
    const lines: DeliveryLine[] = deliveringOrder.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);
```

And in `handleReturn` (around line 866):

```typescript
    const lines: SalesReturnLine[] = returningOrder.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);
```

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/OrdersService.ts src/components/OrdersView.tsx
git commit -m "refactor: OrdersService delivery/return call the atomic batch RPCs"
```

---

### Task 6: `OrdersService.ts` + `ProductionCompletionModal.tsx` — wire up production completion

**Files:**
- Modify: `src/services/OrdersService.ts:587-779` (`MaterialReconciliationInput`,
  `LeftoverMaterialInput`, `ProducedLine`, `confirmProductionDone`)
- Modify: `src/components/ProductionCompletionModal.tsx:88-107` (`handleConfirm`'s three input arrays)

**Interfaces:**
- Consumes: RPC `apply_production_completion` from Task 3.
- Produces: `MaterialReconciliationInput { usageId: string; actualQuantity: number }` (drops
  `materialId`/`plannedQuantity` — both now read server-side), `ProducedLine { detailId: string;
  quantity: number }` (drops `productId`). `LeftoverMaterialInput` is unchanged (`salesDetailId`,
  `materialId`, `quantity` are all genuine user input, not derivable server-side).

- [ ] **Step 1: Replace the interfaces and `confirmProductionDone` in `src/services/OrdersService.ts`**

Replace lines 587–779 (`MaterialReconciliationInput` interface through the end of
`confirmProductionDone`):

```typescript
export interface MaterialReconciliationInput {
  usageId: string; // production_material_usage.id
  actualQuantity: number;
}

export interface LeftoverMaterialInput {
  salesDetailId: string;
  materialId: string;
  quantity: number;
}

// What actually came off the floor, per line. An actual above the planned produce qty IS extra
// production, so there is one number here, not two.
export interface ProducedLine {
  detailId: string;
  quantity: number;
}

// The whole "Mark Production Done" action in one transaction via apply_production_completion
// (function_trigger.sql): reconciles actual material usage against the startProduction reservation,
// burns AUTOMATIC consumables, credits leftover/by-product material, credits the finished goods
// actually produced, closes workflow_tasks, and advances the header to DONE_IN_PRODUCTION — all
// server-side. planned_quantity and material_id/product_id are read off the locked rows inside the
// function, not trusted from this call.
export const confirmProductionDone = async (
  header: SalesHeader,
  reconciliations: MaterialReconciliationInput[],
  leftovers: LeftoverMaterialInput[],
  produced: ProducedLine[],
): Promise<void> => {
  const { error } = await supabase.rpc('apply_production_completion', {
    p_header_id: header.id,
    p_reconciliations: reconciliations.map(r => ({ usage_id: r.usageId, actual_quantity: r.actualQuantity })),
    p_leftovers: leftovers.map(l => ({ sales_detail_id: l.salesDetailId, material_id: l.materialId, quantity: l.quantity })),
    p_produced: produced.map(p => ({ detail_id: p.detailId, quantity: p.quantity })),
  });
  if (error) {
    console.error('confirmProductionDone', error);
    throw error;
  }
};
```

`saveInventoryTransaction` stays imported in this file — `startProduction()` (unchanged, out of
scope per the design spec's flagged note) still uses it.

- [ ] **Step 2: Update `handleConfirm` in `src/components/ProductionCompletionModal.tsx`**

Replace lines 88–107:

```typescript
    const reconciliations: MaterialReconciliationInput[] = order.details.flatMap(d =>
      d.materials.filter(isPlanned).map(m => ({
        usageId: m.id,
        actualQuantity: actualQuantities[m.id] ?? m.plannedQuantity,
      }))
    );

    const leftoverInputs: LeftoverMaterialInput[] = leftovers.map(l => ({
      salesDetailId: l.salesDetailId,
      materialId: l.materialId,
      quantity: l.quantity,
    }));

    const producedInputs: ProducedLine[] = order.details.map(d => ({
      detailId: d.detailId,
      quantity: actualProduced[d.detailId] ?? d.produceQuantity,
    }));
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/OrdersService.ts src/components/ProductionCompletionModal.tsx
git commit -m "refactor: OrdersService production completion calls the atomic RPC"
```

---

### Task 7: Docs — `flows.md`, `test-cases.md`, final verification

**Files:**
- Modify: `docs/flows.md`
- Modify: `docs/test-cases.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update `docs/flows.md`'s Purchase flow table + notes**

In the `| Step | Function | Writes | Stock effect |` table for Purchase flow, replace the
**Receive Goods** row's description to say it now calls `apply_purchase_receipt_batch()` (Postgres
RPC, one transaction for the whole submit, throws on over-receipt rather than clamping) instead of
the old fresh-read-then-clamp JS description. Replace the **Return** row similarly for
`apply_purchase_return_batch()`, noting the JS pre-check (`getMaterialStock`) is gone — the RPC's
exception message is now the only shortfall signal.

Update the note beginning "Receiving is **partial, per line**..." to drop the "server-side clamp"
language (receipt now throws, not clamps) and describe the batch-transaction guarantee instead.

- [ ] **Step 2: Update `docs/flows.md`'s Sales flow table + notes**

Update the **Deliver** and **Return** rows the same way: `apply_sales_delivery_batch()` (clamps,
now against product stock too — the old JS `getProductStock` pre-check inside `markDelivered` is
gone) and `apply_sales_return_batch()` (now throws instead of clamping).

Update `confirmProductionDone()` in detail" section to describe the single
`apply_production_completion()` RPC call instead of the JS loop of `saveInventoryTransaction`
calls, and note materials deducted during over-usage reconciliation and AUTOMATIC consumable burn
are now stock-checked (previously unguarded).

- [ ] **Step 3: Update `docs/flows.md`'s "Known gaps" section**

The `2.` gap entry currently ends with a paragraph starting "**Still open: consumables and
over-usage reconciliation.**" — replace it to say this is now fixed: both writers go through
`apply_material_consumption()` inside `apply_production_completion()`, row-locked, refusing rather
than allowing negative stock.

- [ ] **Step 4: Update `docs/test-cases.md`**

- `TC-S-15` is marked with a `⚠️` for "Nothing stops this from driving stock negative" — remove the
  `⚠️` and update the expected result: with only, say, 5 on hand, an actual of 50 now raises an
  error and rolls back rather than silently going negative.
- `TC-P-09`/`TC-P-15` describe double-submit as clamping — purchase receive/return now throw on the
  loser of a race instead (per decision #1); update the expected result to describe an error
  message, not a silent clamp.
- `TC-S-23` (delivery double-submit) is unchanged in spirit (still clamps) but note it's now also
  checked against physical product stock.

- [ ] **Step 5: Final verification**

Run: `npm run lint`
Expected: no errors, confirms every changed file across Tasks 4–6 still typechecks together.

Then hand off to the user for the manual smoke test — reference `docs/test-cases.md` TC-P-07
through TC-P-18 (purchase receive/return) and TC-S-07 through TC-S-30 (production/delivery/return)
against the live app, since there is no automated UI test suite in this repo.

- [ ] **Step 6: Commit**

```bash
git add docs/flows.md docs/test-cases.md
git commit -m "docs: reflect atomic inventory mutation RPCs in flows and test cases"
```

# Atomic Inventory Mutations — Design

## Goal

Every inventory-changing business action (receive, return, deliver, consume, produce) becomes
**one Postgres function call, one transaction, all-or-nothing**. JS gathers input, calls one RPC,
refreshes. No JS-side quantity math is trusted for the write path.

Out of scope: simple CRUD (vendors/clients/materials/products/categories/employees) stays in
TypeScript via the Supabase client, unchanged.

## Current state (read from code, not assumed)

Already atomic-ish, built for the *previous* answer to this same problem (row-locked clamp, but
ledger insert + header-status update left to a follow-up JS call):
- `apply_sales_delivery(detail_id, qty)` — clamps to `quantity − delivered_quantity`, updates the
  column only.
- `apply_sales_return(detail_id, qty)` — clamps to `delivered_quantity − returned_quantity`, column only.
- `apply_purchase_return(detail_id, qty, unit_cost, remark)` — clamps to
  `min(received−returned, material stock)`, **does** insert its own ledger row (only one that does).
- `apply_manual_stock_decrease(...)` — throws (not clamps) on insufficient stock, inserts its own
  ledger row. Single-field form, not a line-batch. **Unchanged by this design** — it already matches
  the target shape.

Pure JS, no locking at all (the real gaps):
- `receivePurchaseOrder()` (`PurchasesService.ts`) — fresh-read-then-clamp-then-write, two round trips.
- `confirmProductionDone()`'s material reconciliation, AUTOMATIC-consumable deduction, and
  produced-goods credit (`OrdersService.ts`) — same pattern, no stock floor check on the two writers
  that decrease material (documented as "Known gaps" #2 open item in `docs/flows.md`).

## Decisions locked in (user-confirmed)

1. **Overflow handling is split by cause, not by function-wide rule:**
   - A request that exceeds a **document-level cap that's a data-entry mistake to exceed** —
     over-receive, over-return (purchase or sales), over-consume material — **raises an exception**.
     Nothing partial is written; the whole batch rolls back.
   - A request that exceeds a **cap that shrank underneath the caller because someone else's
     transaction won the race** — sales delivery's `quantity − delivered_quantity` — **clamps**
     after the lock, same as `apply_sales_delivery()` today. Not a mistake, just came second.
2. **One user action = one transaction.** "Receive 3 PO lines" is one RPC call taking all 3 lines,
   not 3 calls. If line 2 is invalid, line 1's write never lands either.
3. **Material consumed during production keeps ledger type `SALES`** (existing convention:
   reservation at Start Production and over-usage at completion are already `SALES`).
   `PRODUCTION` stays exclusive to the finished-goods credit. No report/filter breakage.

## Two layers of function

**Row-level primitives** — the 6 functions named in the request, each locks its own row(s),
validates, writes its ledger row, updates its own quantity column. Single detail/usage id, single
qty. These are the reusable, testable unit.

**Batch orchestrators** — one per user action, the actual RPC entry point JS calls. Locks the
header row `FOR UPDATE` first (serializes every action against that header, including two different
action types racing on the same PO/SO), loops the row-level primitive over a `jsonb` array of
lines, then recomputes and writes header status from the now-consistent sibling rows. A `RAISE
EXCEPTION` anywhere in the loop aborts the whole transaction — no separate two-pass validate step
needed, Postgres gives us that for free.

| Batch RPC (JS calls this) | Wraps | Semantics |
|---|---|---|
| `apply_purchase_receipt_batch(header_id, lines, remark)` | `apply_purchase_receipt` × N | throw |
| `apply_purchase_return_batch(header_id, lines, remark)` | `apply_purchase_return` × N | throw |
| `apply_sales_delivery_batch(header_id, lines, remark)` | `apply_sales_delivery` × N | clamp |
| `apply_sales_return_batch(header_id, lines, remark)` | `apply_sales_return` × N | throw |
| `apply_production_completion(header_id, reconciliations, leftovers, produced)` | `apply_material_consumption` + `apply_production_output` + leftover/consumable logic | mixed — see below |

`lines` is `jsonb`: `[{"detail_id": "...", "quantity": 5, "unit_cost": 10.5}]` (`unit_cost` only for
purchase lines). Decoded with `jsonb_to_recordset`. `remark` is one value for the whole call
(matches today — one delivery-note/DO reference per submit, not per line).

Client-supplied `material_id`/`product_id` on line inputs are **dropped**. The row-level function
reads them off the locked `purchase_detail`/`sales_detail`/`production_material_usage` row itself —
one less thing to trust from the client, and it closes a real gap (see below).

### 1. `apply_purchase_receipt(detail_id, qty, unit_cost, remark)` + `_batch`

Lock `purchase_detail` FOR UPDATE → `remaining = quantity − received_quantity` → **`qty > remaining`
raises** `'Cannot receive % — only % still outstanding on this line'`. Update
`received_quantity`, insert `PURCHASE` ledger row (`+qty`, `material_id` off the row). Batch: lock
`purchase_header` first; if every requested line is `<= 0`, raise `'Enter a quantity to receive for
at least one line'` before locking anything; after the loop, `status = RECEIVED` if every sibling
line's `received_quantity >= quantity` else `PARTIALLY_RECEIVED`, stamp `received_date`.

### 2. `apply_purchase_return(detail_id, qty, unit_cost, remark)` + `_batch`

Lock `purchase_detail`, then `material` FOR UPDATE. `remaining = received_quantity −
returned_quantity` → **`qty > remaining` raises** `'Cannot return % — only % received and not yet
returned'`. **`qty > material.quantity` raises** `'Cannot return % — only % currently in stock (rest
already consumed)'` (replaces the JS `getMaterialStock` pre-check in `returnPurchaseOrder` — the
throw text takes over that job). Update `returned_quantity`, insert `PURCHASE_RETURN` (`−qty`).
Batch mirrors receipt: header lock, status → `RETURNED`/`PARTIALLY_RETURNED` off sibling rows.

### 3. `apply_sales_delivery(detail_id, qty, remark)` + `_batch`

Lock `sales_detail`, then `product` FOR UPDATE. `applied = GREATEST(0, LEAST(qty, quantity −
delivered_quantity, product.quantity))` — **clamps against both caps**, doesn't throw. This is new:
today's function only clamps against the order line, and the product-stock floor is an unlocked JS
pre-check (`markDelivered`'s `getProductStock` shortfall message) that a genuine race can slip past.
Folding the stock clamp into the locked function closes that gap. Update `delivered_quantity`,
insert `SALES` (`−applied`) when `applied > 0`. Batch returns `TABLE(detail_id, applied)` so JS can
diff against what was requested and surface a "shipped less than asked — X was short" notice instead
of a hard pre-flight block; skips header-status write entirely if every line applied 0 (nothing
changed, matches today's `if (delivered === 0) return`).

### 4. `apply_sales_return(detail_id, qty, remark)` + `_batch`

Lock `sales_detail` FOR UPDATE. `remaining = delivered_quantity − returned_quantity` → **`qty >
remaining` raises** `'Cannot return % — only % delivered and not yet returned'`. Update
`returned_quantity`, insert `SALES_RETURN` (`+qty`). Batch: header lock, status →
`RETURNED`/`PARTIALLY_RETURNED`.

### 5. `apply_material_consumption(usage_id, qty, remark)`

Lock `production_material_usage`, then `material` FOR UPDATE. **`qty > material.quantity` raises**
`'Cannot consume % of % — only % in stock'`. Insert `SALES` ledger row (`−qty`) — hardcoded, not a
param: both callers (reconciliation over-usage, AUTOMATIC consumable burn) use `SALES` per decision
#3, no caller ever needs a different type. No document-status write — it's called from within
`apply_production_completion`, which owns that.

### 6. `apply_production_output(detail_id, qty)`

Lock `sales_detail` FOR UPDATE. No upper cap — over-producing is legitimate (yield above plan is
just extra credit, already how `produced_quantity` works today). Update `produced_quantity = qty`
(overwrite, matching today's `confirmProductionDone` — safe because the header's idempotency claim
in `apply_production_completion` already guarantees this runs at most once per order), insert
`PRODUCTION` ledger row (`+qty`, `product_id` off the row), close that line's open `workflow_tasks`
row (`status='DONE'`).

### `apply_production_completion(header_id, reconciliations, leftovers, produced)`

The one RPC `confirmProductionDone()` calls — the whole "Mark Done" action in one transaction.

1. Lock `sales_header` FOR UPDATE. Idempotency claim: `UPDATE ... SET status='DONE_IN_PRODUCTION'
   WHERE id = header_id AND status='IN_PRODUCTION' RETURNING id` — if it didn't match, `RETURN`
   (already completed or wrong state), same guard as today.
2. `reconciliations`: `jsonb` array of `{usage_id, actual_quantity}` — **`actual_quantity` is the
   only user-asserted number here**; `planned_quantity` is read off the locked
   `production_material_usage` row itself, not trusted from the client (today's JS passes back a
   value it read earlier in the call — stale by construction). Per row: `diff = planned − actual`.
   `diff < 0` (used more than planned) → `apply_material_consumption(usage_id, −diff, null)` (this
   is the case that needs the stock floor — closes the other half of Known Gap #2's open item).
   `diff > 0` → plain `ADJUSTMENT +diff` insert, no guard needed (increases can't go negative).
   Update `actual_quantity`, `returned_quantity = GREATEST(0, diff) + matched leftover`.
3. **AUTOMATIC consumables are found by the function, not passed in** — JS doesn't need to loop
   materials at all. Query `production_material_usage` joined to `material`/`sales_detail` for this
   header where `material_type = 'CONSUMABLE_MATERIAL'` and
   `COALESCE(pmu.consumption_mode, material.consumption_mode) = 'AUTOMATIC'` and `actual_quantity >
   0` (set earlier by `addOrderConsumable()` on the Kanban board, unchanged). Each row →
   `apply_material_consumption(usage_id, actual_quantity, null)`.
4. `leftovers`: `{sales_detail_id, material_id, quantity}` — merge into an existing planned row's
   `returned_quantity` if one exists for that `(sales_detail_id, material_id)`, else insert a new
   `production_material_usage` row (`planned=0, actual=0, returned=quantity`). Either way a plain
   `ADJUSTMENT +quantity` insert (increase, no guard).
5. `produced`: `{detail_id, quantity}` array → `apply_production_output(detail_id, quantity)` per
   line (`product_id` read off the row, not passed).
6. Close any remaining open `workflow_tasks` for this header's lines (`status != 'DONE'/'CANCELLED'`
   → `'DONE'`) — belt-and-suspenders with step 6's per-line close in case a line had no `produced`
   entry.

No exception path beyond the material-consumption stock floor — this action reconciles what
*already happened* on the shop floor, so most of it is bookkeeping, not permission-checking.

## Scope note — flag if wrong

Two material-decreasing writes exist outside the 6 named functions and are **not** touched by this
design, since they weren't in the request:

- **`startProduction()`'s reservation** (`material −reserved`, `SALES` type) — currently plain JS,
  guarded only by the unlocked `checkProductionStock()` pre-check. Same risk shape as material
  consumption above, just not named. Leave as-is, or fold in later as a 7th
  `apply_production_start_batch()`?
- **`cancelSalesOrder()`'s un-reserve from `IN_PRODUCTION`** (`material +planned`, `ADJUSTMENT`) —
  an increase, can't go negative, stays plain JS by the same logic as reconciliation's `diff > 0`
  case above. Not flagging this one, it's correctly out of scope.

If Start Production should be in scope too, say so during spec review — it's the same shape as
function 5 and would slot in the same way.

## JS changes

- `PurchasesService.ts`: `receivePurchaseOrder()` and `returnPurchaseOrder()` collapse to one
  `supabase.rpc('apply_purchase_receipt_batch'/'apply_purchase_return_batch', {...})` call each —
  drop the fresh-refetch, the manual clamp loop, the separate header-status write, and (for returns)
  the `getMaterialStock` pre-check (the RPC's exception message replaces it).
- `OrdersService.ts`: `markDelivered()` and `returnSalesOrder()` collapse the same way. `markDelivered`
  keeps its product-stock pre-check as an *optional* nicer up-front message (the RPC clamps either
  way now) — or drop it and rely on the post-call applied-vs-requested diff; pick one during
  implementation, both are correct. `confirmProductionDone()` becomes one
  `apply_production_completion` call — drop all the `saveInventoryTransaction` loops, the leftover
  merge logic, the consumable loop (function 3 above absorbs it).
- `InventoryTransactionService.saveInventoryTransaction()` stays (still used by `startProduction()`,
  untouched per the scope note, and anywhere else that writes a ledger row outside these 6 flows).
- No changes to `ImportExportService.ts`'s `commitPurchaseImport`/`commitSalesImport` — bulk import
  is a different code path, out of scope.

## SQL file organization

Per the request: `function_trigger.sql`, sections in this order — `-- index section` (unchanged,
append nothing new needed), `-- trigger section` (unchanged), `-- function section` (existing
functions kept, 4 replaced with `CREATE OR REPLACE` — `apply_sales_delivery`, `apply_sales_return`,
`apply_purchase_return` gain the throw/clamp changes above — plus the new ones appended). Existing
`get_*`/`next_document_number`/`apply_manual_stock_decrease` untouched.

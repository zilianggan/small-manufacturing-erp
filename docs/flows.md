# Purchase / Sales / Inventory Flows

How the three modules actually move data today. Line refs are to `src/` at the time of writing.

## Core rule: who owns stock

`material.quantity` and `product.quantity` are **never written by app code**. `helper.ts` (the
`erp_material` / `erp_product` serializers) deliberately omits `quantity`, so a material or product
edit can't stomp it.

The only writer is a DB trigger:

```sql
-- supabase/function_trigger.sql
CREATE TRIGGER trg_inventory_update_stock
AFTER INSERT ON inventory_transaction ...

update_material_stock():
  IF NEW.material_id IS NOT NULL THEN UPDATE material SET quantity = quantity + NEW.quantity ...
  IF NEW.product_id  IS NOT NULL THEN UPDATE product  SET quantity = quantity + NEW.quantity ...
```

Consequences worth internalising:

- `inventory_transaction.quantity` is **signed**: `+` adds stock, `-` removes it.
- A row sets **exactly one** of `material_id` / `product_id`.
- The trigger is `AFTER INSERT` **only** — deleting or updating a ledger row does **not** reverse
  the stock it applied.
- Nothing constrains stock to stay `>= 0`. The only guard anywhere is
  `checkProductionStock()`, and it only covers Start Production.

Transaction types (`types.ts:362`): `PURCHASE` | `SALES` | `PURCHASE_RETURN` | `SALES_RETURN` |
`PRODUCTION` | `ADJUSTMENT`. The type is **descriptive only** — the sign of `quantity` is what moves
stock.

A ledger row joins back to the order that caused it via exactly one of three FKs: `purchase_detail_id`
(material received/returned on a PO), `production_material_usage_id` (material reserved/consumed/
returned on an SO), or `sales_detail_id` (finished goods produced, shipped, or returned on an SO —
`ON DELETE SET NULL`, indexed). Every product-side row uses the third route.

---

## Purchase flow

Tables: `purchase_header` + `purchase_detail`. Service: `PurchasesService.ts`. UI: `PurchasesView.tsx`
(list, two tabs), `PurchaseOrderDetailView.tsx` (drill-down).

```
                  createPurchaseQuotation()
                  next_document_number('PO')
                            │
                            ▼
                      ┌───────────┐   convertToPurchaseOrder()      ┌─────────┐
                      │ QUOTATION │ ─────────────────────────────▶  │ ORDERED │
                      └───────────┘   sets order_date               └─────────┘
                         │                                          │        │
              updatePurchase()                  receivePurchaseOrder()      cancelPurchaseOrder()
              deletePurchase()                            │                  │
                                                          ▼  ** material +qty **      ▼
                                             ┌────────────────────┐        ┌───────────┐
                                             │ PARTIALLY_RECEIVED │──┐     │ CANCELLED │
                                             └────────────────────┘  │     └───────────┘
                                                          │           │ receive again  (no stock effect)
                                                          ▼           │  ** material +qty **
                                                   ┌──────────┐       │
                                                   │ RECEIVED │◀──────┘
                                                   └──────────┘
                                              (every line fully received)
                                                          │
                                              returnPurchaseOrder()   ← also available from
                                                          ▼  ** material −qty **   PARTIALLY_RECEIVED
                                              ┌────────────────────┐
                                              │ PARTIALLY_RETURNED │──┐
                                              └────────────────────┘  │ returnPurchaseOrder()
                                                          │            │ again, same line or another
                                                          ▼            │  ** material −qty **
                                                    ┌──────────┐       │
                                                    │ RETURNED │◀──────┘
                                                    └──────────┘
                                              (every line fully returned)
```

| Step | Function | Writes | Stock effect |
|---|---|---|---|
| New quotation | `createPurchaseQuotation()` | header (`QUOTATION`, `quotation_date`), details | none |
| Edit | `updatePurchase()` | header + **replaces all detail rows** | none |
| Proceed to PO | `convertToPurchaseOrder()` | header → `ORDERED`, `order_date`; replaces details | none |
| Receive Goods | `receivePurchaseOrder(purchase, lines)` | `apply_purchase_receipt_batch(headerId, lines, remark)` (Postgres RPC, `function_trigger.sql`) — one transaction for the whole submit: locks the header, then per line locks `purchase_detail`, **throws** (rolls back everything) if a line asks for more than `quantity − receivedQuantity`, else bumps `received_quantity` and inserts that line's `PURCHASE` ledger row; header → `PARTIALLY_RECEIVED` or `RECEIVED`; stamps `received_date` | **material +qty** |
| Cancel | `cancelPurchaseOrder()` | header → `CANCELLED` | none |
| Return | `returnPurchaseOrder()` | `apply_purchase_return_batch(headerId, lines, remark)` (same RPC pattern) — locks the header, then per line locks `purchase_detail` **and** `material`, **throws** if a line exceeds `receivedQuantity − returnedQuantity` or current `material.quantity` (already consumed elsewhere), else bumps `returned_quantity` and inserts that line's `PURCHASE_RETURN` ledger row; header → `PARTIALLY_RETURNED` or `RETURNED` | **material −qty**, never below 0 — an over-return throws before writing anything, whole batch rolls back |
| Delete | `deletePurchase()` | deletes header (details cascade) | **none — does not reverse a receipt** |

Notes:

- **Quotation tab** shows `status = QUOTATION`. **Purchase Order tab** shows `ORDERED`,
  `PARTIALLY_RECEIVED`, `RECEIVED`, `PARTIALLY_RETURNED`, `RETURNED`, `CANCELLED`.
- Receiving is **partial, per line**: a PO can be booked in over several deliveries. The header only
  reaches `RECEIVED` once **every** line has `received_quantity >= quantity`. Each submit is one
  all-or-nothing transaction (`apply_purchase_receipt_batch`) — either every line in the submit
  commits together, or a single over-large line throws and none of them do. That's what makes a
  double-submit safe (the ledger is insert-only, so an over-receipt could never be taken back).
- **Cancel is offered only on `ORDERED`** — the one status where no goods have moved. **Return is
  offered on `PARTIALLY_RECEIVED` / `RECEIVED` / `PARTIALLY_RETURNED`** — once material has arrived,
  you can send it back even while the rest of the PO is still in transit. Cancel and Return never
  appear together on the same order.
- Returns are **partial, per line**, capped at `receivedQuantity − returnedQuantity` **and** at current
  material stock — `apply_purchase_return_batch()` throws (whole submit rolls back) if any line
  exceeds either cap, row-locked so it can't go negative even under concurrent writers.
- Receive and Return share one component, `LineQuantityModal.tsx` — see the Sales flow note.
- A PO can be linked to a sales order (`sales_header_id`) — that's a reference only, it has no
  stock or lifecycle effect.
- Purchases only ever touch **materials**, never products.
- `Generate Invoice` (`PurchaseInvoiceModal.tsx`) is a print-only document on `ORDERED`/`RECEIVED`.
  It writes nothing.

---

## Sales flow

Tables: `sales_header` + `sales_detail` + `production_material_usage` + `workflow_tasks`.
Service: `OrdersService.ts`. UI: `OrdersView.tsx`, `SalesOrderDetailView.tsx`, `WorkflowsView.tsx`
(Kanban), `ProductionCompletionModal.tsx`.

A sales order carries **two independent tables**: the **products** the client ordered
(`sales_detail`) and the **production materials** needed to make them (`production_material_usage`).
Materials are not nested inside a product line in the UI — the form renders a flat
`| Product | Material | Planned Qty |` table where Product names one of the order's own lines. They
*are* still stored hanging off `sales_detail_id`, because that FK already **is** (header, product):
repointing it at `sales_header_id` + `product_id` would break the `workflow_tasks.sales_detail_id`
link, the ledger's `production_material_usage_id` join, and the cascade-delete, and buy nothing. **The
two-table split is a UI shape, not a schema shape.**

Consumption mode (`AUTOMATIC` deducts a consumed consumable at completion, `MANUAL` records it as
history only) is a **material-master property** (`material.consumption_mode`) only — there is no
per-order override. `production_material_usage` has no `consumption_mode` column; the sales form's old
per-row Consumption Mode picker that once wrote one was removed, since it only ever applied to
`RAW_MATERIAL` rows (the form's material picker), a type the setting is never meaningful for (it's
`CONSUMABLE_MATERIAL`-only).

Production is **optional**, not a mandatory stage: `Deliver` is reachable straight from `ORDERED`
(ship from finished-goods stock, no production run) whenever stock already covers the order.
`Start Production` is reachable from `ORDERED` *or* `PARTIALLY_DELIVERED` (ship what stock covers,
produce the rest) — but only when the order actually has production materials set; see
`canStartProduction()` below.

```
createSalesQuotation()                                                       CANCELLED
next_document_number('SO')                                              ▲ ▲ ▲  (no stock effect —
         │                                                               │ │ │   see per-status note)
         ▼                                                               │ │ │
   ┌───────────┐  convertToSalesOrder()   ┌─────────┐───cancelSalesOrder()┘ │ │
   │ QUOTATION │ ───────────────────────▶ │ ORDERED │                      │ │
   └───────────┘  sets delivery_date      └─────────┘                      │ │
                                            │        │                     │ │
                    checkProductionStock(produce) markDelivered(lines)     │ │
                    startProduction(produce) ← HARD  ** product −qty **────┘ │
                    gate, only if canStartProduction()  (SALES, stock-checked)│
                                            │                                 │
                                            ▼  ** material −reserved **       │
                                    ┌───────────────┐                        │
                                    │ IN_PRODUCTION │ ──cancelSalesOrder()────┤
                                    └───────────────┘  ** material +planned back **
                                            │ confirmProductionDone(produced)
                                            ▼  ** product +ACTUAL PRODUCED **  (PRODUCTION)
                                 ┌─────────────────────┐
                                 │ DONE_IN_PRODUCTION  │ ──cancelSalesOrder()──┘
                                 └─────────────────────┘  (no stock effect — goods already
                                            │               made stay in stock, see below)
                                            │ markDelivered(lines)
                                            ▼  ** product −qty **  (SALES, stock-checked)
                               ┌─────────────────────┐   cancel is gone from here on —
                               │ PARTIALLY_DELIVERED │◀┐  Return is the only exit
                               └─────────────────────┘ │
                                    │       ▲           │ deliver again / start production on the rest
                                    │       └─ startProduction(produce) — mixed case, see above
                                    ▼  ** product −qty **
                                          ┌───────────┐
                                          │ DELIVERED │
                                          └───────────┘
                                       (every line fully delivered)
                                                │ returnSalesOrder()   ← also available from
                                                ▼  ** product +qty **     PARTIALLY_DELIVERED
                                   ┌─────────────────────┐
                                   │ PARTIALLY_RETURNED  │──┐
                                   └─────────────────────┘  │ returnSalesOrder() again
                                                │            │  ** product +qty **
                                                ▼            │
                                          ┌──────────┐       │
                                          │ RETURNED │◀──────┘
                                          └──────────┘
                                   (every delivered unit fully returned)
```

| Step | Function | Writes | Stock effect |
|---|---|---|---|
| New quotation | `createSalesQuotation()` | header (`QUOTATION`), details + `production_material_usage` (planned BOM per line) | none |
| Edit | `updateSalesOrder()` | header + **replaces details** (usage rows cascade-delete) | none |
| Proceed to SO | `convertToSalesOrder()` | header → `ORDERED`, `delivery_date` | none |
| Outstanding demand | `getOutstandingDemand()` | read-only | **planning only** — warns, never reserves, never blocks a save |
| Available to promise | form's ATP panel (`getProductStock` + `getOutstandingDemand`) | read-only | **planning only** — per product on **this** order: in stock, outstanding elsewhere, available, this order's qty. Tells the user whether they can skip production |
| Production gate | `canStartProduction(header)` | read-only | `true` only when status is `ORDERED`/`PARTIALLY_DELIVERED` **and** at least one line has production materials — an order with no BOM can't Start Production at all, it can only Deliver |
| Stock gate | `checkProductionStock(header, produce)` | read-only | returns shortfalls for the **scaled** BOM; **blocks** Start Production |
| Start Production | `startProduction(header, produce)` | single call to `apply_production_start()` (Postgres RPC, `function_trigger.sql`) — one transaction: idempotency-claims `ORDERED`/`PARTIALLY_DELIVERED` → `IN_PRODUCTION` (a retry after a rolled-back failure starts clean, never double-deducts), sets `sales_detail.produce_quantity`, **rewrites** each `production_material_usage.planned_quantity` to the scaled reservation, opens one `workflow_tasks` row per line, and deducts material via `apply_material_consumption()` (row-locked, throws on insufficient stock) | **material −reserved**, never below 0 — an over-request throws before writing anything, whole run rolls back. Throws up front if every line's `produce` qty is 0 — a run that makes nothing is refused, both in the modal (Confirm disabled) and in the service (hard guarantee) |
| Kanban | `updateWorkflowStage()` | `workflow_tasks.stage` | none |
| Add consumable | `addOrderConsumable()` | `production_material_usage` row (`actual_quantity` set, planned 0) | **none at this point** |
| Stock gate (completion) | `checkProductionCompletionStock(header, reconciliations)` | read-only | returns shortfalls for reconciliation rows using MORE than the Start Production reservation, plus AUTOMATIC consumables' fixed `actual_quantity`; **blocks** Confirm Production Done. Mirrors the Start Production stock gate above — front-runs the same guard `apply_material_consumption()` enforces server-side, instead of surfacing it only after the RPC throws |
| Confirm Done | `confirmProductionDone(header, recon, leftovers, produced)` | single call to `apply_production_completion()` (Postgres RPC, `function_trigger.sql`) — see below | several, including **product +actual produced** — see below |
| Deliver | `markDelivered(header, lines)` | `apply_sales_delivery_batch(headerId, lines, remark)` (Postgres RPC, `function_trigger.sql`) — one transaction for the whole submit: locks the header, then per line locks `sales_detail` **and** `product`, clamps to `min(quantity − deliveredQuantity, product.quantity)`, bumps `delivered_quantity`, and inserts that line's `SALES` ledger row; header → `PARTIALLY_DELIVERED` or `DELIVERED` | **product −qty**. Reachable from `ORDERED` now too (`canDeliver()`). Clamps rather than throws — a request that outruns what's left is a benign race (another delivery, or genuinely short stock), not a data-entry mistake, so it ships what it can instead of blocking the rest of the batch. The old JS `getProductStock` pre-check is gone; the RPC's own row-locked read of `product.quantity` is the only shortfall check now |
| Return | `returnSalesOrder()` | `apply_sales_return_batch(headerId, lines, remark)` (same RPC pattern) — locks the header, then per line locks `sales_detail`, **throws** (rolls back everything) if a line exceeds `deliveredQuantity − returnedQuantity`, else bumps `returned_quantity` and inserts that line's `SALES_RETURN` ledger row; header → `PARTIALLY_RETURNED` or `RETURNED` | **product +qty** |
| Cancel from `ORDERED` | `cancelSalesOrder()` | header → `CANCELLED` | none |
| Cancel from `IN_PRODUCTION` | `cancelSalesOrder()` | `ADJUSTMENT` row per material, `+plannedQuantity`; tasks → `CANCELLED` | **material +planned** (un-reserve) |
| Cancel from `DONE_IN_PRODUCTION` | `cancelSalesOrder()` | header → `CANCELLED` | **none** — material is already consumed and the finished goods already exist; they stay in stock to sell to someone else |
| Delete | `deleteSalesOrder()` | deletes header (details + usage rows cascade) | none — only offered on `QUOTATION` (`canDeleteSalesOrder()`) |

Notes:

- **Sales orders reserve nothing.** Inventory is always physical stock. The SO form renders two
  read-only panels: **Finished Goods — Available to Promise**, scoped to the products actually on
  *this* order (`in stock / outstanding elsewhere / available / this order's qty`, driven by
  `getProductStock` + `getOutstandingDemand`), and **Material Demand**, the wider outstanding-material
  book from `getOutstandingDemand()` alone. Both **warn** when available goes negative — but never
  block the save. A business can accept an order it can't fill yet; it just needs to see that this
  implies more production or more purchasing, or — for the product panel — that it can skip
  production and ship from stock. **Start Production, by contrast, is a hard gate** — a run you don't
  have the metal for is just a wrong number in the ledger, not a business decision.
  - Product outstanding counts every open order (`ORDERED` … `PARTIALLY_DELIVERED`), excluding the
    order currently being edited.
  - Material outstanding counts **`ORDERED` orders only** — an `IN_PRODUCTION` order's material has
    already been deducted from stock, so counting it as "still required" would double-count the very
    shortage it caused.
- **Produce Qty** is chosen at Start Production, defaulting to
  `ordered − delivered − finished goods in stock` (make only what's left to cover after whatever
  already shipped from stock) and editable. Materials are deducted against it, not against the
  ordered qty: `reserved = plannedQuantity × produceQty / orderedQty`, rounded to 2dp. A produce qty
  of 0 on every line is refused — see the Start Production row above.
- **Cancel is offered on `ORDERED`, `IN_PRODUCTION`, and `DONE_IN_PRODUCTION`** — every status before
  the goods reach the client. **Return is offered on `PARTIALLY_DELIVERED` / `DELIVERED` /
  `PARTIALLY_RETURNED`** — once the client has some of the goods, Return replaces Cancel as the only
  exit. The two actions never appear together on the same order.
- **`canStartProduction()`, `canDeliver()`, and `canDeleteSalesOrder()`** (`OrdersService.ts`) are the
  single source of truth for these gates — `OrdersView.tsx`'s row menu and
  `SalesOrderDetailView.tsx`'s button bar both import them, so the two surfaces can't drift out of
  sync with each other (they had, before this was centralized: the detail page still gated Deliver on
  `DONE_IN_PRODUCTION` only after the row menu had already been opened up to `ORDERED`).
- **Delete business rule:** a Sales Order is a business document from the moment it's `ORDERED` —
  audit trail requires it stay on record forever, so `canDeleteSalesOrder()` is simply
  `status === 'QUOTATION'`. Everywhere else, Cancel is the only exit — it stays available on
  `ORDERED`/`IN_PRODUCTION`/`DONE_IN_PRODUCTION` regardless of ledger history, since cancelling itself
  already reverses the reservation (see `IN_PRODUCTION` row above). No schema change: the two
  RESTRICT FKs on
  `inventory_transaction` (`purchase_detail_id`, `production_material_usage_id`) stay as-is,
  now purely a safety net for a delete attempted outside the UI.
- Delivery is **partial, per line**, and the return cap follows it: `deliveredQuantity −
  returnedQuantity`, not `quantity − returnedQuantity`. **You cannot return what hasn't shipped.**
- `markDelivered`/`returnSalesOrder` deliberately **have no conditional-status-claim lock** (unlike
  `confirmProductionDone`, which is still all-or-nothing). A second delivery/return is a legitimate
  operation, not a retry, so no status transition distinguishes them.
- **Every inventory-changing action is now one Postgres RPC call wrapping one all-or-nothing
  transaction** — purchase receipt/return, sales delivery/return, production start, and production
  completion alike. Each locks its header row `FOR UPDATE` first (serializing every action on that
  header), then loops its lines through a row-level primitive that locks its own row(s) before writing.
  JS no longer does any fresh-read/clamp/multi-write dance for these actions; it builds the line array
  and makes one `.rpc()` call. This closes the old gap where a JS-side "fresh read, clamp in JS, then
  write" — even against a fresh read — was still unlocked round trips, so two genuinely concurrent calls
  on the same line could both read the same stale remaining, both pass their own clamp, and both write,
  into a ledger that's insert-only and can't be undone. **Start Production was the last holdout** —
  plain sequential JS with no lock and no transaction, flagged as an explicit scope exclusion when the
  other five actions were migrated and never revisited until it was. A partial JS failure could leave
  some materials deducted (and `planned_quantity` already rewritten) while others weren't, and a retry
  from the still-`ORDERED` header would re-deduct whatever had already succeeded; two concurrent runs
  sharing a material had no lock between them and could both pass `checkProductionStock()`'s pre-check
  and jointly drive `material.quantity` negative. `apply_production_start()` closes both: the
  `ORDERED`/`PARTIALLY_DELIVERED` → `IN_PRODUCTION` idempotency claim means a retry after a rolled-back
  failure starts clean instead of double-deducting, and `apply_material_consumption()`'s lock on
  `material` serializes concurrent runs instead of letting them race.
- Receive / Deliver / both Returns all render **one** component, `LineQuantityModal.tsx`: pick a
  quantity per line, capped at `total − alreadyDone`. Only the nouns differ.

### `confirmProductionDone()` in detail (`OrdersService.ts`)

`confirmProductionDone()` is a thin wrapper: it builds the three line arrays and makes one call to
`apply_production_completion()` (Postgres RPC, `function_trigger.sql`). Everything below happens
server-side, inside that one transaction. The reservation made at Start Production is `−planned`
(already scaled to Produce Qty); completion reconciles it against actual use:

1. **Reconciliation**, per planned material — `diff = planned − actual` (`planned_quantity` is read
   off the locked `production_material_usage` row, never trusted from the client):
   - `diff > 0` (used less) → `ADJUSTMENT` `+diff` → **material returned**
   - `diff < 0` (used more) → routed through `apply_material_consumption()`, which locks `material`
     and **throws** if there isn't `−diff` in stock, rather than allowing negative stock
   - `diff = 0` → no row
2. **Leftover / by-product** material → `ADJUSTMENT` `+qty` → **material +qty**. If the material is
   already a planned row on that line it merges into `returned_quantity`; otherwise a fresh
   `production_material_usage` row is inserted.
3. **AUTOMATIC consumables** (`materialType = CONSUMABLE_MATERIAL`, `consumptionMode = AUTOMATIC`)
   → also routed through `apply_material_consumption()` (`SALES` `−actual_quantity`, throws on
   insufficient stock) → **material −qty**. MANUAL consumables are recorded as history only; the
   user adjusts stock by hand in the Inventory tab. The mode is read straight off the **material**
   (`production_material_usage` has no `consumption_mode` column of its own).
4. **Actual produced** per line → `apply_production_output()` → `PRODUCTION` `+producedQty` on
   `product_id`, linked via `sales_detail_id` → **product +qty**, and persisted to
   `sales_detail.produced_quantity`. This is what credits finished goods, and it is the **actual**
   yield — not the ordered qty, not the planned produce qty. A short run credits less; an over-run
   credits more (no upper cap — legitimate extra yield).
5. Closes `workflow_tasks` (`DONE`), header → `DONE_IN_PRODUCTION`. The status flip
   (`IN_PRODUCTION` → `DONE_IN_PRODUCTION`) is still the idempotency claim, now made inside the RPC
   itself: a retry after a partial failure finds the header already claimed and is a silent no-op.

---

## Inventory flow

Table: `inventory_transaction` (the ledger). Service: `InventoryTransactionService.ts`.
UI: `InventoryView.tsx` (ledger list + stock-adjustment drawer + stats), `MaterialView.tsx` /
`ProductView.tsx` (catalog).

Every stock movement in the system is one ledger row. Writers, all of them:

| Origin | Type | Sign | Target |
|---|---|---|---|
| `receivePurchaseOrder()` — per receipt, partial | `PURCHASE` | `+` | material |
| `startProduction()` — reservation, scaled to Produce Qty | `SALES` | `−` | material |
| `confirmProductionDone()` — used more than planned | `SALES` | `−` | material |
| `confirmProductionDone()` — used less than planned | `ADJUSTMENT` | `+` | material |
| `confirmProductionDone()` — leftover/by-product | `ADJUSTMENT` | `+` | material |
| `confirmProductionDone()` — AUTOMATIC consumable | `SALES` | `−` | material |
| `confirmProductionDone()` — **actual produced** | `PRODUCTION` | `+` | **product** |
| `markDelivered()` — per delivery, partial | `SALES` | `−` | **product** |
| `returnPurchaseOrder()` — via `apply_purchase_return()` RPC, can't exceed current stock | `PURCHASE_RETURN` | `−` | material |
| `returnSalesOrder()` | `SALES_RETURN` | `+` | **product** |
| `cancelSalesOrder()` from `IN_PRODUCTION` | `ADJUSTMENT` | `+` | material |
| **Inventory tab → Stock Adjustment drawer, INCREASE** | `ADJUSTMENT` | `+` | material **or product** |
| **Inventory tab → Stock Adjustment drawer, DECREASE** — via `apply_manual_stock_decrease()` RPC, can't exceed current stock | `ADJUSTMENT` | `−` | material **or product** |
| **Import → inventory adjustments** (`ImportExportService.ts`) | `ADJUSTMENT` | signed, straight from the sheet | material **or product** |
| **Import → `commitPurchaseImport()`** (`ImportExportService.ts:486`) | `PURCHASE` | `+` | material |
| **Import → `commitSalesImport()`** (`ImportExportService.ts:679`) | `SALES` | `−` | **product** |

`cancelSalesOrder()` from `IN_PRODUCTION` used to write `SALES_RETURN`; it's `ADJUSTMENT` now.
`SALES_RETURN` means one thing only: the client sent finished goods back via `returnSalesOrder()`.
Un-reserving material on a cancel is an internal correction, not a customer return — and
`ADJUSTMENT +` is already what the "used less than planned" reconciliation row above emits for
exactly this shape of correction.

**`apply_purchase_return()` and `apply_manual_stock_decrease()` insert the ledger row themselves**,
inside the Postgres function, instead of leaving it to a follow-up JS call — the only two writers in
this table that do. This is deliberate, not stylistic: the guarantee they provide (material stock
can't go negative) depends on holding a row lock on `material` from the moment its quantity is read
until the ledger row that changes it is written. `apply_sales_delivery()`/`apply_sales_return()`
(Sales flow, above) don't need this — they only cap a `sales_detail` column nothing else writes, so
locking it for the function's duration was the whole guarantee and the ledger insert could safely stay
in JS, one call later. `material.quantity` has no such exclusivity: purchases, production,
consumables, and every other adjustment touch it through the same trigger, so releasing the lock
before the insert would reopen the exact race the function exists to close.

`commitPurchaseImport()` and `commitSalesImport()` bypass `saveInventoryTransaction()` and insert
into `inventory_transaction` directly via `supabase.from('inventory_transaction').insert(...)`.
`commitPurchaseImport()` does link its rows (`purchase_detail_id`, zipped back from the
`purchase_detail` insert's `RETURNING detail_id`) — the imported PO shows up in the material's
movement history same as a normal receipt. `commitSalesImport()` does not: it leaves
`sales_detail_id` unset even though the `sales_detail` rows it could link to are inserted
immediately above, so imported SALES rows show in the ledger as bare product movements with no
reference number back to the SO (see the comment at `ImportExportService.ts:674`).

### Reads

- `getInventoryTransactions()` — the paginated ledger list. Search by material/product name resolves
  ids first, then OR's `material_id.in.(…)` / `product_id.in.(…)`.
- `getInventoryMovements({materialId|productId}, excludeTypes)` — per-item movement list for the
  detail pages.
- `getInventoryStatsSummary()` — last 6 months, aggregated client-side. "Top Consumed" stays
  **materials only** on purpose: products now do have ledger rows for ordinary sales
  (`markDelivered()` writes `SALES −qty`), but mixing finished goods into a "top consumed materials"
  list would compare two different things. A separate top-selling-products stat would be a different
  feature.

---

## Known gaps

These are real behaviours of the current code, not bugs filed against it. Test cases in
`test-cases.md` marked ⚠️ assert **today's** behaviour, not the desired one.

~~**Products are never drawn down by a sale.**~~ **Fixed.** `product.quantity` is now credited by
`PRODUCTION` on production completion (`confirmProductionDone()`) and debited by `SALES` on delivery
(`markDelivered()`) — see the Sales flow table above.

1. ~~**Deleting never reverses stock.**~~ **Fixed for sales orders.** The trigger is still
   `AFTER INSERT` only — nothing un-applies a ledger row — but a sales order can no longer reach
   Delete past `QUOTATION`: `canDeleteSalesOrder()` (see the Sales flow notes above) is
   `status === 'QUOTATION'`, and `cancelSalesOrder()` already reverses the `IN_PRODUCTION`
   reservation before the order can even become `CANCELLED`. Purchase orders are unchanged —
   `deletePurchase()` still doesn't reverse a receipt, and Delete is still hidden by status alone
   (see `TC-P-11`/`TC-P-18`).
2. ~~**Stock can go negative — manual adjustments and purchase returns.**~~ **Fixed for these two
   writers.** `checkProductionStock()` already guarded Start Production. Now `apply_purchase_return()`
   and `apply_manual_stock_decrease()` (`function_trigger.sql`) guard the other two *discretionary*
   writers — a purchase return of material already consumed in production, and a manual Stock
   Adjustment DECREASE — both row-locked, both refuse (throw) rather than let stock go negative. See
   the Inventory flow's writer table above for how.

   **Fixed for consumables and over-usage reconciliation too.** Both writers inside
   `confirmProductionDone()` (AUTOMATIC consumable deduction, and the "used more than planned"
   reconciliation row) now go through `apply_material_consumption()`, row-locked, refusing (throws)
   rather than allowing negative stock — folded into the same `apply_production_completion()`
   transaction described in "`confirmProductionDone()` in detail" above, alongside the receipt/return/
   delivery/return/production RPCs covering every other inventory-changing action.
~~3. **Delivery is gated on production.**~~ **Fixed.** `Deliver` is reachable straight from `ORDERED`
   now, and `markDelivered()` stock-checks per product before writing any ledger row (throws with the
   short products named if the shelf can't cover the request). `Start Production` is gated the other
   way instead: `canStartProduction()` hides it when an order has no production materials set, since a
   produce qty of 0 (the old "fully-stocked" workaround) is refused outright.
4. ~~**`inventory_transaction`'s two older FKs have no `ON DELETE`, so a delete on a sales order
   CANCELLED out of `IN_PRODUCTION`/`DONE_IN_PRODUCTION` throws an FK violation.**~~ **Fixed —
   no longer reachable.** Schema unchanged: `purchase_detail_id` and `production_material_usage_id`
   still RESTRICT (`schema.sql:209-210`). What changed is the business rule, not the FK: **a sales
   order is a business document from `ORDERED` onward — audit trail requires it stay on record
   forever, so it can only be cancelled, never deleted** — `canDeleteSalesOrder()` hides Delete past
   `QUOTATION`, well before any inventory transaction could exist. The two RESTRICT FKs now serve
   purely as a safety net for a delete attempted outside the UI (direct SQL, a bypassed client) —
   see the Sales flow notes above. Purchase orders keep the old, narrower gate (`TC-P-11`/`TC-P-18`:
   Delete hidden by status only) since this business rule was scoped to sales orders only.

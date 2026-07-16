# Partial Receiving, Produce Qty, Partial Delivery & Outstanding Demand

Supersedes the delivery/production half of
[`2026-07-13-finished-goods-and-returns-design.md`](2026-07-13-finished-goods-and-returns-design.md).
That change made `product.quantity` real (credited on production done, debited on delivery) and added
per-line returns. Everything it built stays; this change makes the **quantities** partial and
**produce qty** explicit.

## What actually changes

Five deltas against today's code. Everything else in `flows.md` is untouched.

| # | Change | Today |
|---|---|---|
| 1 | **Partial receiving** on a PO | `receivePurchaseOrder()` books the full ordered qty on every line, once |
| 2 | **SO carries two independent tables** (Products, Production Materials) | materials are nested inside each product line in the form |
| 3 | **Outstanding demand** panels on the SO form | nothing — no visibility into open demand |
| 4 | **Produce Qty** at Start Production; **Actual Produced** at Done | reserves the full BOM; credits FG at *ordered* qty + an "extra produced" box |
| 5 | **Partial delivery** on an SO | `markDelivered()` is an all-or-nothing status flip |

## Decisions

### `production_material_usage` keeps its `sales_detail_id` FK

The brief says usage rows should hang off `sales_header_id` + `product_id`. They already do —
`sales_detail_id` → `sales_detail` **is** (header, product). Repointing the FK would break the
`workflow_tasks.sales_detail_id` link, the ledger's `production_material_usage_id` join, and the
`ON DELETE CASCADE` that cleans usage rows up when a line is replaced, and buy nothing.

**So the "two independent tables" requirement is satisfied in the UI, not the schema.** The SO form
renders a flat Production Material table — `| Product | Material | Planned Qty | Consumption Mode |`
— where Product is a dropdown over the order's own product lines. Each row writes to that line's
`detail_id`. Same data, the shape the brief asks for, zero migration.

### Consumption mode moves onto the usage row

`material.consumption_mode` stays as the **default**, but each usage row gets its own
`consumption_mode` so one order can deduct a consumable automatically while another records it for a
manual adjustment. Reads fall back to the material's mode when the row's is null.

### Produce Qty rewrites `planned_quantity` at Start Production

`planned_quantity` entered in the SO form is the BOM for the **ordered** quantity. When production
starts with a smaller Produce Qty (because finished goods are already on the shelf), the reservation
must scale:

```
scale       = produceQty / orderedQty          (orderedQty > 0; 0 ordered ⇒ scale 0)
reserved    = round(plannedQuantity × scale)
```

Start Production **overwrites `planned_quantity` with `reserved`** — the brief's "save planned
material snapshot for reconciliation". After the start, `planned_quantity` means *what we actually
reserved*, which is exactly what Mark Done reconciles actual usage against. Before the start it's an
estimate. One column, two lifecycle meanings, and the status tells you which.

### One modal for four per-line-quantity actions

Receive, Deliver, Purchase Return and Sales Return are the same interaction: pick a quantity per
line, capped at `total − alreadyDone`. `ReturnModal.tsx` already is this modal with the nouns
hardcoded. It becomes **`LineQuantityModal.tsx`**, with the nouns as props:

| Action | Item | Total col | Done col | Cap |
|---|---|---|---|---|
| Receive Goods | Material | Ordered | Received | `quantity − receivedQuantity` |
| Deliver | Product | Ordered | Delivered | `quantity − deliveredQuantity` |
| Return to Vendor | Material | Received | Returned | `receivedQuantity − returnedQuantity` |
| Return from Client | Product | Delivered | Returned | `deliveredQuantity − returnedQuantity` |

Note the sales-return cap changes: it was `quantity − returnedQuantity` (delivery was all-or-nothing,
so ordered *was* delivered). With partial delivery it must be `deliveredQuantity − returnedQuantity`
— you cannot return what hasn't shipped.

### "Extra Produced" is deleted, not kept

Actual Produced can exceed Planned Produce. That *is* extra production. Keeping a separate
"Extra Produced (beyond ordered quantity)" box alongside an editable Actual Produced field would be
two inputs for one number. `ExtraProducedInput` and its UI section go.

### Outstanding demand is planning-only

Never reserves, never blocks a save. Two read-only panels on the SO form:

```
Products                                          Materials
Product   In Stock  Outstanding  Available        Material  In Stock  Required  Available
Bracket        12           30       −18   ⚠      Steel         400       900      −500  ⚠
```

- **Product outstanding** = Σ `quantity − delivered_quantity` over every line of every SO in
  `ORDERED` / `IN_PRODUCTION` / `DONE_IN_PRODUCTION` / `PARTIALLY_DELIVERED`.
- **Material required** = Σ `planned_quantity` over usage rows of SOs in **`ORDERED` only**. Once an
  order is `IN_PRODUCTION` its material is already deducted from stock — counting it again would
  double-count the very shortage it caused.
- Negative Available renders a warning ("additional production/purchasing may be required"). Save is
  never blocked.

Start Production keeps its **hard** material block (`checkProductionStock`, now scaled by Produce
Qty). Outstanding demand is soft; production is strict. Those are different questions.

## Schema

Appended to `supabase/schema.sql`:

```sql
ALTER TABLE sales_detail ADD COLUMN delivered_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE sales_detail ADD COLUMN produce_quantity   NUMERIC NOT NULL DEFAULT 0; -- set at Start Production
ALTER TABLE sales_detail ADD COLUMN produced_quantity  NUMERIC NOT NULL DEFAULT 0; -- set at Mark Done

ALTER TABLE production_material_usage
  ADD COLUMN consumption_mode TEXT CHECK (consumption_mode IN ('AUTOMATIC','MANUAL'));

-- Backfill: everything already DELIVERED shipped in full under the old all-or-nothing markDelivered.
UPDATE sales_detail SET delivered_quantity = quantity
WHERE header_id IN (SELECT id FROM sales_header
                    WHERE status IN ('DELIVERED','PARTIALLY_RETURNED','RETURNED'));
```

`purchase_detail.received_quantity` already exists. Both status columns are plain `TEXT` with no
CHECK, so the two new statuses are a TypeScript + UI change only.

The backfill matters: without it every historically delivered order shows `delivered 0 / ordered N`
and its Return action caps at zero.

## Status model

```
PURCHASE                                   SALES
────────                                   ─────
QUOTATION                                  QUOTATION
    │ convert                                  │ convert
ORDERED ───── cancel ──▶ CANCELLED         ORDERED ─────────── cancel ──▶ CANCELLED
    │ receive (partial)                        │ start production            ▲ ▲
    ▼  ** material +qty **                     ▼  ** material −reserved **   │ │
PARTIALLY_RECEIVED ──┐                     IN_PRODUCTION ─────── cancel ─────┘ │
    │ receive again  │                         │        ** material +back **   │
    ▼                │                         │ confirm done                  │
RECEIVED ◀───────────┘                         ▼  ** product +actualProduced **│
    │ return          (all lines full)     DONE_IN_PRODUCTION ── cancel ───────┘
    ▼  ** material −qty **                     │                (no stock effect)
PARTIALLY_RETURNED ──┐                         │ deliver (partial)
    │                │                         ▼  ** product −qty **
    ▼                │                     PARTIALLY_DELIVERED ──┐
RETURNED ◀───────────┘                         │ deliver again   │
                                               ▼                 │
                                           DELIVERED ◀───────────┘
                                               │ return (partial)
                                               ▼  ** product +qty **
                                           PARTIALLY_RETURNED ──┐
                                               │                │
                                               ▼                │
                                           RETURNED ◀───────────┘
```

Header status is **derived after every partial write**: all lines exhausted → the terminal status,
otherwise the `PARTIALLY_*` one.

- **Receive** is offered on `ORDERED` / `PARTIALLY_RECEIVED`.
- **Return to Vendor** on `RECEIVED` / `PARTIALLY_RECEIVED` / `PARTIALLY_RETURNED` — you can send
  back what has arrived even while the rest of the PO is still in transit.
- **Deliver** on `DONE_IN_PRODUCTION` / `PARTIALLY_DELIVERED`.
- **Return from Client** on `DELIVERED` / `PARTIALLY_DELIVERED` / `PARTIALLY_RETURNED`.
- **Cancel** stays pre-goods-movement only: purchase `ORDERED`; sales `ORDERED` / `IN_PRODUCTION` /
  `DONE_IN_PRODUCTION`. Never shown alongside Return.

## Services

### `PurchasesService.ts`

```ts
export interface ReceiveLine { detailId: string; materialId: string; quantity: number; unitCost: number; }
export const receivePurchaseOrder = (purchase: PurchaseHeader, lines: ReceiveLine[]) => Promise<void>
```

Fresh-read `purchase_detail` first, clamp each line to `quantity − received_quantity`, insert
`PURCHASE +qty`, bump `received_quantity`, derive header status, stamp `received_date` on the first
receipt. Same fresh-read-then-clamp shape as `returnPurchaseOrder()` — the ledger is insert-only and
the trigger is `AFTER INSERT`, so an over-receipt cannot be undone. The old
`receivedQuantity >= quantity` skip-guard is subsumed by the clamp.

### `OrdersService.ts`

```ts
// planning only — never reserves, never blocks
export interface DemandRow { id: string; name: string; inStock: number; outstanding: number; }
export const getOutstandingDemand = (excludeHeaderId?: string)
  => Promise<{ products: DemandRow[]; materials: DemandRow[] }>

// Start Production, now quantity-aware
export interface ProduceLine { detailId: string; quantity: number; }
export const checkProductionStock = (header: SalesHeader, produce: ProduceLine[]) => Promise<MaterialShortfall[]>
export const startProduction     = (header: SalesHeader, produce: ProduceLine[]) => Promise<void>

// Mark Done: actual produced replaces extraProduced
export interface ProducedLine { detailId: string; productId: string; quantity: number; }
export const confirmProductionDone = (
  header, reconciliations, leftovers, produced: ProducedLine[]) => Promise<void>

// Delivery, now partial
export interface DeliveryLine { detailId: string; productId: string; quantity: number; }
export const markDelivered = (header: SalesHeader, lines: DeliveryLine[]) => Promise<void>
```

`startProduction` scales and persists `planned_quantity`, stores `produce_quantity`, reserves
`−planned`, opens the tasks, flips to `IN_PRODUCTION`.

`confirmProductionDone` keeps its conditional-status-claim idempotency lock (it is still an
all-or-nothing transition), and credits `PRODUCTION +producedQty` per line instead of
`+detail.quantity` plus a separate extra loop. It also persists `produced_quantity` and honours the
usage row's own `consumption_mode` before the material's.

`markDelivered` **loses** the conditional-status-claim lock — a partial action can legitimately run
twice — and gains the fresh-read-then-clamp guard instead, identical to the return functions. The
clamp is what makes a double-submit safe now.

`returnSalesOrder`'s cap moves from `quantity` to `deliveredQuantity`.

## UI

- **`ReturnModal.tsx` → `LineQuantityModal.tsx`** — nouns and the submit label become props. Four
  call sites (receive, deliver, purchase return, sales return).
- **`StartProductionModal.tsx`** (new) — `| Product | Ordered | In Stock | Suggested | Produce Qty |`.
  Suggested = `max(0, ordered − inStock)`, prefilled into an editable Produce Qty. Confirm runs
  `checkProductionStock` with the entered quantities; shortfalls render in the modal and **block**.
- **`ProductionCompletionModal.tsx`** — the "Extra Produced" section becomes a **Product table**
  (`| Product | Planned Produce | Actual Produced |`, prefilled with `produce_quantity`). The
  material section is unchanged.
- **`OrdersView.tsx` SO form** — product lines and production materials become two sibling tables,
  plus the two read-only Outstanding Demand panels.
- Status badges + tab `.in([...])` lists gain `PARTIALLY_RECEIVED` / `PARTIALLY_DELIVERED` in
  `OrdersView` / `SalesOrderDetailView` / `PurchasesView` / `PurchaseOrderDetailView`, and the
  action gating follows the status model above.

Quotation and invoice documents are untouched: sales renders `SalesQuotationModal`, purchase renders
`PurchaseInvoiceModal`, both print-only, neither writes anything.

## Non-goals

- **Negative stock is still unguarded** outside Start Production (`flows.md` gap #2). A purchase
  return of already-consumed material still drives stock below zero. Unchanged, still its own piece
  of work.
- **Delivering straight from `ORDERED`** when finished goods already cover the order. The flow keeps
  production as the gate; a fully-stocked order simply starts production with Produce Qty 0 and marks
  it done. Worth revisiting if it annoys in practice.
- **`inventory_transaction`'s two older FKs still RESTRICT** (`flows.md` gap #4 / `TC-S-14`).

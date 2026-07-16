# Finished-Goods Stock Movement & Order Returns

Closes gap #1 in `docs/flows.md` (products are never moved by production or sale) and gives
`PURCHASE_RETURN` / `SALES_RETURN` a real emitter.

## Problem

Two gaps, from `docs/flows.md`:

1. **`product.quantity` is fiction.** `confirmProductionDone()` credits only *extra* yield;
   `markDelivered()` is a bare status flip. So finished goods are never credited when made and
   never drawn down when sold. The two omissions cancel out on the happy path — the number looks
   plausible by accident, not by design. It drifts the moment anything is produced but not shipped.
2. **You cannot record a return.** The only post-stock-movement exit is Cancel, which is offered
   *before* stock moves (`ORDERED`). Once a PO is `RECEIVED` or an SO is `DELIVERED` there is no
   way to send goods back. `PURCHASE_RETURN` is declared in the type union and emitted by nothing.

## Decisions

Settled during brainstorming:

- **Return is not a rename of Cancel — it's a new action at a different status.** Cancel is offered
  at every status *before* the goods reach the client; once they have, Return replaces it. The two
  actions never appear together.
- **Returns follow standard direction.** Purchase return = goods go back to the vendor, material
  **decreases**. Sales return = client sends goods back, product **increases**.
- **Returns are partial by line.** A modal with a per-line qty, capped at what was actually
  received/delivered minus what's already been returned.
- **Production output gets its own `PRODUCTION` type**, so the ledger can distinguish manufactured
  yield from a manual stock correction.

## Ledger writers after this change

New and changed rows only; every other writer in `flows.md` is untouched.

| Event | Type | Sign | Target | Links via |
|---|---|---|---|---|
| `confirmProductionDone()` — ordered qty | `PRODUCTION` | `+` | **product** | `sales_detail_id` |
| `confirmProductionDone()` — extra produced | `PRODUCTION` | `+` | **product** | `sales_detail_id` *(was `ADJUSTMENT` via a synthetic usage row)* |
| `markDelivered()` | `SALES` | `−` | **product** | `sales_detail_id` |
| `returnPurchaseOrder()` | `PURCHASE_RETURN` | `−` | material | `purchase_detail_id` |
| `returnSalesOrder()` | `SALES_RETURN` | `+` | **product** | `sales_detail_id` |
| `cancelSalesOrder()` from `IN_PRODUCTION` | `ADJUSTMENT` | `+` | material | `production_material_usage_id` *(was `SALES_RETURN`)* |

Happy path now nets to zero *and is recorded*: produce +10 (`PRODUCTION`), deliver −10 (`SALES`).
Previously both were silent.

The last row reclaims `SALES_RETURN` to mean one thing only: **the client sent goods back**.
Un-reserving material on a cancel is an internal correction, not a customer return — and
`ADJUSTMENT +` is already what the "used less than planned" reconciliation emits for exactly this
shape of correction. Without this the ledger would use one type for two unrelated events.

## Schema

`inventory_transaction` can only join back to an order via `purchase_detail_id` or
`production_material_usage_id` — there is **no link to a sales line**. That's why the existing
extra-produced code fakes one by inserting a junk `production_material_usage` row with
`material_id` null. Three new product-side writers would triple that junk (2+ rows per line, every
order), and those rows leak into `SalesDetail.materials` as blank-named entries.

So: add the real FK. Append to `supabase/schema.sql` (the repo's migration convention):

```sql
-- Product-side ledger rows (PRODUCTION/SALES/SALES_RETURN on a finished good) had no way to
-- join back to the order that caused them; the old extra-produced path faked it with a
-- synthetic production_material_usage row. This is that link, done properly.
ALTER TABLE inventory_transaction
ADD COLUMN sales_detail_id UUID REFERENCES sales_detail(detail_id) ON DELETE SET NULL;

-- Partial returns need to know how much of each line has already gone back.
ALTER TABLE purchase_detail ADD COLUMN returned_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE sales_detail    ADD COLUMN returned_quantity NUMERIC NOT NULL DEFAULT 0;
```

`ON DELETE SET NULL` is deliberate: `inventory_transaction`'s other two FKs have no `ON DELETE` and
therefore RESTRICT, which is the cause of gap #5 (`TC-S-14` — deleting a sales order cancelled out
of `IN_PRODUCTION` throws an FK violation). Not repeating that mistake on the new column.

**No status migration needed.** `purchase_header.status` and `sales_header.status` are plain `TEXT`
with no CHECK constraint, so the two new statuses are a TypeScript + UI change only.

`production_material_usage.returned_quantity` already exists and means something different
(leftover material from production). The new columns are on the *detail* tables. Names collide,
meanings don't — worth knowing when reading the diff.

## Types (`src/types.ts`)

```ts
export type InventoryTransactionType =
  'PURCHASE' | 'SALES' | 'PURCHASE_RETURN' | 'SALES_RETURN' | 'PRODUCTION' | 'ADJUSTMENT';

interface InventoryTransaction { salesDetailId?: string; /* … */ }
interface PurchaseDetail       { returnedQuantity: number; /* … */ }
interface SalesDetail          { returnedQuantity: number; /* … */ }

// PurchaseHeader (types.ts:143) and SalesHeader (types.ts:205) each gain the same two members.
// NOT the legacy Order (:90) / PurchaseOrder (:116) unions — those back the old
// sales_orders/purchase_orders tables that Dashboard/Reports/ImportExport still read, and
// they are out of scope.
status: … | 'PARTIALLY_RETURNED' | 'RETURNED';
```

`src/helper.ts` — `erp_inventory_transaction` serializer gains
`sales_detail_id: t.salesDetailId || null`.

## Status model

```
PURCHASE                                  SALES
────────                                  ─────
QUOTATION                                 QUOTATION
    │ convert                                 │ convert
ORDERED ────── cancel ──▶ CANCELLED       ORDERED ──────────── cancel ──────▶ CANCELLED
    │ receive  (no stock effect)              │ start production                  ▲ ▲
    ▼          ** material +qty **            ▼  ** material −planned **          │ │
RECEIVED                                  IN_PRODUCTION ──────── cancel ──────────┘ │
    │ return                                  │              ** material +back **   │
    ▼  ** material −qty **                    │ confirm done                        │
PARTIALLY_RETURNED ──┐                        ▼  ** product +qty **   ← new         │
    │ return again   │                    DONE_IN_PRODUCTION ── cancel ─────────────┘
    ▼                │                        │                 (no stock effect —
RETURNED ◀───────────┘                        │                  goods stay in stock)
(all lines fully back)                        │ deliver
                                              ▼  ** product −qty **   ← new
                                          DELIVERED          ← cancel is gone from here on
                                              │ return               ← new
                                              ▼  ** product +qty **
                                          PARTIALLY_RETURNED ──┐
                                              │ return again   │
                                              ▼                │
                                          RETURNED ◀───────────┘
```

Header status is derived after each return: **every** line fully returned → `RETURNED`, otherwise
`PARTIALLY_RETURNED`. Returning again from `PARTIALLY_RETURNED` is allowed until every line is
exhausted.

**Cancel is available at every pre-delivery status, and only there.** Sales: `ORDERED`,
`IN_PRODUCTION`, `DONE_IN_PRODUCTION`. Purchase: `ORDERED` (its only pre-receipt status). From
`DELIVERED` / `RECEIVED` onward the goods are with the counterparty, so Return is the only exit and
Cancel disappears.

`DONE_IN_PRODUCTION` is the one new cancel, and it is a **plain status flip with no stock effect**.
The material is already consumed and the finished goods already exist — cancelling the client's
order doesn't unmake them. They stay in stock to sell to someone else, which is exactly what
`product.quantity` should say. `cancelSalesOrder()` therefore needs no service change for this: its
existing `IN_PRODUCTION` un-reserve branch doesn't fire, and everything else is already the flip.
Only the button's `hidden:` predicate moves.

## Services

### `PurchasesService.ts`

```ts
export interface PurchaseReturnLine {
  detailId: string;
  materialId: string;
  quantity: number;   // > 0, ≤ receivedQuantity − returnedQuantity
  unitCost: number;
}

export const returnPurchaseOrder = async (
  purchase: PurchaseHeader,
  lines: PurchaseReturnLine[],
  remark?: string,
): Promise<void>
```

Per line, skipping `quantity <= 0`: insert `PURCHASE_RETURN` `−quantity` (carrying `unitCost` and
`purchase_detail_id`), then bump `purchase_detail.returned_quantity`. Finally set the header status
from the derived rule above.

Clamp each line to its remaining returnable qty server-side, not just in the modal — the cap is what
stops a double-submit from returning the same goods twice, so it belongs next to the write.

### `OrdersService.ts`

```ts
export interface SalesReturnLine {
  detailId: string;
  productId: string;
  quantity: number;   // > 0, ≤ detail.quantity − returnedQuantity
}

export const returnSalesOrder = async (
  header: SalesHeader,
  lines: SalesReturnLine[],
  remark?: string,
): Promise<void>
```

Same shape: `SALES_RETURN` `+quantity` on `product_id` linked by `sales_detail_id`, bump
`sales_detail.returned_quantity`, derive header status. Sales lines are always delivered in full
(`markDelivered` is all-or-nothing), so the cap is `detail.quantity − returnedQuantity`.

**`markDelivered(header: SalesHeader)`** — signature changes from `headerId: string`, because it now
needs the line items. Inserts `SALES` `−detail.quantity` per line before flipping to `DELIVERED`.

**`confirmProductionDone()`** — two changes:
- New loop crediting `PRODUCTION` `+detail.quantity` per sales line (the ordered qty). This is the
  actual fix for gap #1.
- The existing `extraProduced` loop drops its synthetic `production_material_usage` insert and
  links via `sales_detail_id` instead; type becomes `PRODUCTION`.

**`cancelSalesOrder()`** — the un-reserve row's type flips `SALES_RETURN` → `ADJUSTMENT`. One word.

### `InventoryTransactionService.ts`

`mapTransactionRow` / `mapMovementRow` gain a third join path: `sales_detail(sales_header(...))`,
alongside the existing purchase and production-usage paths. This is what makes finished-goods
movements show a ref no. and client name in the ledger and on `ProductView`'s inventory list.

`getInventoryStatsSummary()`'s "Top Consumed" comment (materials only, "products have no ledger row
for ordinary sales") becomes false with this change and gets removed — products now do.

## UI

**One shared `src/components/ReturnModal.tsx`**, used by both tabs. Generic over lines:

```
Return Purchase Order PO-0117            Return Sales Order SO-0042

 Material      Received  Returned  Return   Product       Delivered  Returned  Return
 Steel Sheet       50        0     [ 5 ]    Steel Bracket     10        0      [ 3 ]
 M6 Bolt          200       20     [ 0 ]    Hinge Assy         4        0      [ 0 ]

 Remark: [ wrong gauge            ]         Remark: [ damaged in transit    ]

              [Cancel]  [Confirm Return]                [Cancel]  [Confirm Return]
```

Props: `title`, `lines: { id, name, movedQty, returnedQty }[]`, `onConfirm(qtyById, remark)`.
Confirm disabled until at least one qty > 0. Inputs capped at `movedQty − returnedQty`; a fully
returned line renders read-only. Modelled on `ProductionCompletionModal.tsx`, which is already this
exact per-line-input-plus-confirm shape.

**Purchases** (`PurchasesView.tsx` row actions + `PurchaseOrderDetailView.tsx` buttons):
- `Cancel Order` — unchanged, `ORDERED` only (its only pre-receipt status).
- **`Return to Vendor`** — new, shown on `RECEIVED` and `PARTIALLY_RETURNED`.
- Status badges: `PARTIALLY_RETURNED` warning, `RETURNED` secondary.
- The PO tab's `.in([...])` status list gains both new statuses, or returned orders vanish from the
  list.

**Orders** (`OrdersView.tsx` + `SalesOrderDetailView.tsx`):
- `Cancel Order` — its `hidden:` predicate gains `DONE_IN_PRODUCTION`, so it now shows on
  `ORDERED` / `IN_PRODUCTION` / `DONE_IN_PRODUCTION`.
- **`Return from Client`** — new, shown on `DELIVERED` and `PARTIALLY_RETURNED`.
- Same badge and `.in([...])` additions as Purchases.

Cancel and Return are mutually exclusive by construction — no status lists both.

**Inventory** (`InventoryView.tsx`): `PRODUCTION` gains a type-filter chip and a badge colour.

Delete visibility stays `QUOTATION` / `CANCELLED`. A returned order has ledger rows behind it and
must not be deletable.

⚠️ Cancelling from `DONE_IN_PRODUCTION` lands on `CANCELLED`, where Delete **is** offered — and that
order has `production_material_usage` rows with ledger rows pointing at them. Those FKs RESTRICT, so
the delete throws. This is gap #5 / `TC-S-14` exactly, and the new cancel widens the set of orders
that can reach it. Not fixed here (it needs the `ON DELETE` fix on the two old FKs, which is its own
change), but the implementation plan should add a test case pinning today's behaviour so it isn't
mistaken for a regression introduced by this work.

## Non-goals

- **Negative stock is still not guarded.** A purchase return of material already consumed in
  production will drive `material.quantity` below zero. That is gap #3 in `flows.md` and it is
  systemic — `checkProductionStock()` guards Start Production and nothing else. Fixing it properly
  means a DB-level constraint or a shared pre-flight check across every writer, which is its own
  piece of work. Calling it out here so the new path isn't mistaken for an oversight.
- **No partial receipt** (gap #4). Unchanged, and independent of this.
- **Restocking fees, credit notes, vendor RMA numbers.** Not asked for.

## Testing

Manual, appended to `docs/test-cases.md`:

- Produce an order → `product.quantity` rises by the ordered qty; ledger shows `PRODUCTION` `+`.
- Deliver it → falls by the same; ledger shows `SALES` `−`. Net zero, both movements visible.
- Extra-produced yield still credits, and no longer creates a blank-named row in Materials Used.
- Return 3 of 10 delivered → `product.quantity` +3, status `PARTIALLY_RETURNED`, line shows 3/10.
- Return the remaining 7 → status `RETURNED`, return action no longer offered.
- Return material on a `RECEIVED` PO → `material.quantity` falls, `PURCHASE_RETURN` `−` in ledger.
- Cancel from `IN_PRODUCTION` → material still comes back, now typed `ADJUSTMENT` not `SALES_RETURN`.
- Cancel from `DONE_IN_PRODUCTION` → status flips, **`product.quantity` is unchanged** and no ledger
  row is written. The finished goods stay in stock.
- `DELIVERED` offers Return and **no** Cancel; every pre-delivery status offers Cancel and no Return.
- Return modal caps input at the remaining returnable qty; a fully returned line is read-only.

## Docs to update

`docs/flows.md` — rewrite both flow diagrams and the ledger-writers table; strike gap #1 (fixed) and
note gap #5 is unchanged but not extended by the new FK.

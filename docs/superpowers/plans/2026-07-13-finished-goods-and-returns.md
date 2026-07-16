# Finished-Goods Stock Movement & Order Returns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `product.quantity` real — credited when production completes, debited when an order ships — and add partial per-line returns to purchase orders and sales orders, each writing a proper `inventory_transaction` row.

**Architecture:** Every stock movement is already one signed `inventory_transaction` row applied by an `AFTER INSERT` DB trigger; this change adds four new writers to that ledger and never touches `material.quantity` / `product.quantity` directly. Product-side rows get a real `sales_detail_id` FK so they can join back to their order, replacing the synthetic-`production_material_usage`-row hack the extra-produced path uses today. Returns are a per-line quantity modal shared by both tabs, backed by a `returned_quantity` column on each detail table.

**Tech Stack:** React 19 + TypeScript + Tailwind v4, Supabase (PostgREST + SQL triggers), module-owned services (`src/services/*Service.ts`) talking to Supabase directly.

**Spec:** [`docs/superpowers/specs/2026-07-13-finished-goods-and-returns-design.md`](../specs/2026-07-13-finished-goods-and-returns-design.md)

## Global Constraints

- **No test runner exists in this repo.** There is no vitest/jest, no `src/**/*.test.ts`, and no `test` script in `package.json`. The established convention is `docs/test-cases.md` — manual cases run by hand against a seeded DB. This plan follows that convention rather than introducing a test framework nobody asked for. **Per-task verification is therefore: `npm run lint` (which is `tsc --noEmit`) must pass, plus the manual case(s) the task adds to `docs/test-cases.md`.** If you want real automated service tests, say so and a vitest setup gets added as its own task first.
- **Do not commit.** Project convention is that the user commits. Each task ends at "lint passes"; leave the working tree dirty.
- **Never write `material.quantity` or `product.quantity` from app code.** The `trg_inventory_update_stock` trigger owns them. `helper.ts`'s `erp_material` / `erp_product` serializers deliberately omit `quantity`. Move stock only by inserting an `inventory_transaction`.
- **`inventory_transaction.quantity` is signed.** `+` adds stock, `-` removes it. `transaction_type` is descriptive only — the sign is what moves stock. A row sets **exactly one** of `material_id` / `product_id`.
- **Migrations are appended to `supabase/schema.sql`** as `ALTER TABLE` statements at the end of the file (see the existing `ALTER TABLE inventory_transaction ADD COLUMN product_id …` at ~line 250). There is no separate migrations directory. The user applies SQL to Supabase by hand.
- **Services talk to Supabase directly** via `supabase.from(...)` for reads and `helper.ts`'s `upsertRecord` for writes. No `db.ts`, no `server.ts` REST hop, no `useTableData`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/schema.sql` | Modify (append) | `sales_detail_id` FK on the ledger; `returned_quantity` on both detail tables |
| `src/types.ts` | Modify | `PRODUCTION` type; `salesDetailId`; `returnedQuantity`; two new statuses |
| `src/helper.ts` | Modify | Serialize `sales_detail_id` |
| `src/services/OrdersService.ts` | Modify | FG credit on production done, FG debit on delivery, `returnSalesOrder`, cancel type fix |
| `src/services/PurchasesService.ts` | Modify | `returnPurchaseOrder` |
| `src/services/InventoryTransactionService.ts` | Modify | Third join path (`sales_detail` → `sales_header`) so product rows show a ref no. |
| `src/components/ReturnModal.tsx` | **Create** | One per-line-quantity return modal, shared by both tabs |
| `src/components/PurchasesView.tsx` | Modify | `Return to Vendor` action, status badges, tab status list |
| `src/components/PurchaseOrderDetailView.tsx` | Modify | Same, as detail-page buttons |
| `src/components/OrdersView.tsx` | Modify | `Return from Client` action, cancel now on `DONE_IN_PRODUCTION`, badges, tab status list |
| `src/components/SalesOrderDetailView.tsx` | Modify | Same, as detail-page buttons |
| `src/components/InventoryView.tsx` | Modify | `PRODUCTION` filter chip + badge; fix now-wrong `SALES` / `SALES_RETURN` labels |
| `docs/flows.md` | Modify | Rewrite diagrams + ledger-writer table; strike gap #1 |
| `docs/test-cases.md` | Modify | New manual cases (added incrementally, per task) |

---

### Task 1: Schema, types, serializer

Pure foundation — no behaviour changes. Everything after this depends on it.

**Files:**
- Modify: `supabase/schema.sql` (append at end of file)
- Modify: `src/types.ts:143`, `src/types.ts:205`, `src/types.ts:360`, and the `InventoryTransaction` / `PurchaseDetail` / `SalesDetail` interfaces
- Modify: `src/helper.ts:69-80` (`erp_inventory_transaction` mapper)

**Interfaces:**
- Consumes: nothing.
- Produces: `InventoryTransactionType` gains `'PRODUCTION'`; `InventoryTransaction.salesDetailId?: string`; `PurchaseDetail.returnedQuantity: number`; `SalesDetail.returnedQuantity: number`; both header status unions gain `'PARTIALLY_RETURNED' | 'RETURNED'`. Every later task uses these.

- [ ] **Step 1: Append the migration to `supabase/schema.sql`**

Add at the very end of the file:

```sql
-- Product-side ledger rows (PRODUCTION/SALES/SALES_RETURN against a finished good) had no way
-- to join back to the order that caused them — the old extra-produced path faked it by inserting
-- a synthetic production_material_usage row with a null material_id. This is that link, done
-- properly. ON DELETE SET NULL is deliberate: inventory_transaction's two older FKs have no
-- ON DELETE and therefore RESTRICT, which is what makes deleting a cancelled-from-IN_PRODUCTION
-- sales order throw (see "Known gaps" #5 in docs/flows.md). Not repeating that here.
ALTER TABLE inventory_transaction
ADD COLUMN sales_detail_id UUID REFERENCES sales_detail(detail_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transaction_sales_detail
ON inventory_transaction(sales_detail_id);

-- Partial returns need to know how much of each line has already gone back.
-- (production_material_usage.returned_quantity already exists and means something different —
-- leftover material from production. These are on the *detail* tables. Same name, different thing.)
ALTER TABLE purchase_detail ADD COLUMN returned_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE sales_detail    ADD COLUMN returned_quantity NUMERIC NOT NULL DEFAULT 0;
```

No status migration is needed: `purchase_header.status` and `sales_header.status` are plain `TEXT` with no CHECK constraint (`schema.sql:126`, `:140`), so new status strings need no DB change.

- [ ] **Step 2: Tell the user to run the SQL**

The repo has no migration runner. Stop and say:

> "Task 1 adds SQL to the end of `supabase/schema.sql`. Please run those three `ALTER TABLE` statements (and the `CREATE INDEX`) against your Supabase project before testing — the app will error on the new columns until you do."

- [ ] **Step 3: Update `src/types.ts`**

`InventoryTransactionType` (line 360) — add `PRODUCTION`:

```ts
export type InventoryTransactionType = 'PURCHASE' | 'SALES' | 'PURCHASE_RETURN' | 'SALES_RETURN' | 'PRODUCTION' | 'ADJUSTMENT';
```

In `interface InventoryTransaction`, beside the existing `productionMaterialUsageId` field:

```ts
  salesDetailId?: string; // FK -> sales_detail.detail_id, set on product-side rows (PRODUCTION on completion, SALES on delivery, SALES_RETURN on a client return)
```

In `interface PurchaseDetail`, beside `receivedQuantity`:

```ts
  returnedQuantity: number; // how much of receivedQuantity has gone back to the vendor
```

In `interface SalesDetail`, beside `quantity`:

```ts
  returnedQuantity: number; // how much of quantity the client has sent back
```

`PurchaseHeader.status` (line 143) and `SalesHeader.status` (line 205) each gain two members:

```ts
  // PurchaseHeader
  status: 'QUOTATION' | 'ORDERED' | 'RECEIVED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'CANCELLED';

  // SalesHeader
  status: 'QUOTATION' | 'ORDERED' | 'IN_PRODUCTION' | 'DONE_IN_PRODUCTION' | 'DELIVERED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'CANCELLED';
```

**Do NOT touch** the legacy `Order.status` (line 90) or `PurchaseOrder.status` (line 116) unions — those back the old `sales_orders` / `purchase_orders` tables that Dashboard/Reports/ImportExport still read, and they are out of scope.

- [ ] **Step 4: Update the serializer in `src/helper.ts`**

In the `erp_inventory_transaction` mapper (line 69), add one line after `production_material_usage_id`:

```ts
    erp_inventory_transaction: (t) => ({
        id: t.id,
        transaction_type: t.transactionType,
        quantity: t.quantity,
        unit_cost: t.unitCost ?? null,
        remark: t.remark || null,
        material_id: t.materialId || null,
        product_id: t.productId || null,
        purchase_detail_id: t.purchaseDetailId || null,
        production_material_usage_id: t.productionMaterialUsageId || null,
        sales_detail_id: t.salesDetailId || null,
        transaction_date: t.transactionDate
    }),
```

Without this line every `salesDetailId` you pass to `saveInventoryTransaction` is silently dropped.

- [ ] **Step 5: Populate the two new fields in the row mappers**

`src/services/PurchasesService.ts`, `mapPurchaseDetailRow` (line 40) — add beside `receivedQuantity`:

```ts
  returnedQuantity: Number(row.returned_quantity) || 0,
```

`src/services/OrdersService.ts`, `mapSalesDetailRow` (line 62) — add beside `quantity`:

```ts
  returnedQuantity: Number(row.returned_quantity) || 0,
```

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: PASS, no errors. (`returnedQuantity` is required on both detail interfaces, so if a construction site is missed, tsc names it here.)

---

### Task 2: Finished goods enter and leave stock

The actual fix for gap #1. After this, `product.quantity` means something.

**Files:**
- Modify: `src/services/OrdersService.ts:416-573` (`confirmProductionDone`), `:575-581` (`markDelivered`), `:587-619` (`cancelSalesOrder`)
- Modify: `src/components/OrdersView.tsx:659-675` (`handleMarkDelivered`), `:706` (row action)
- Modify: `src/components/SalesOrderDetailView.tsx:212` (Mark as Delivered button)
- Modify: `docs/test-cases.md`

**Interfaces:**
- Consumes: `InventoryTransaction.salesDetailId`, `'PRODUCTION'` (Task 1).
- Produces: `markDelivered(header: SalesHeader)` — **signature changed** from `markDelivered(headerId: string)`. `ExtraProducedInput` is unchanged (`{ salesDetailId, productId, quantity }`).

- [ ] **Step 1: Credit the ordered quantity in `confirmProductionDone`**

In `src/services/OrdersService.ts`, insert this loop immediately **before** the existing `for (const p of extraProduced)` loop (~line 529):

```ts
  // Finished goods enter stock the moment production completes — the ordered quantity of every
  // line, credited against product_id and linked back to the sales line that made it. Without
  // this, product.quantity only ever reflected *extra* yield plus manual adjustments, and stayed
  // plausible purely because markDelivered never debited it either (docs/flows.md gap #1).
  for (const detail of header.details) {
    if (detail.quantity <= 0) continue;
    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'PRODUCTION',
      quantity: detail.quantity,
      productId: detail.productId,
      salesDetailId: detail.detailId,
      transactionDate: nowIso(),
    });
  }
```

- [ ] **Step 2: Rewrite the `extraProduced` loop to drop the synthetic-usage-row hack**

Replace the whole existing `for (const p of extraProduced) { … }` block (~lines 529-557, the one that inserts a `production_material_usage` row with `remark: 'Extra produced beyond order'` and then an `ADJUSTMENT`) with:

```ts
  // Extra yield beyond the ordered quantity. Same PRODUCTION type as the ordered qty above —
  // it's the same event, just unplanned. Previously this had to insert a synthetic
  // production_material_usage row (material_id null) purely so the ledger row had something to
  // join back to the order through; sales_detail_id makes that unnecessary, and stops those
  // blank-named rows leaking into the order's Materials Used list.
  for (const p of extraProduced) {
    if (p.quantity <= 0) continue;
    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'PRODUCTION',
      quantity: p.quantity,
      productId: p.productId,
      salesDetailId: p.salesDetailId,
      transactionDate: nowIso(),
    });
  }
```

- [ ] **Step 3: Debit finished goods on delivery**

Replace `markDelivered` (line 575) entirely:

```ts
// Shipping the order is what takes the finished goods out of stock — one SALES row per line,
// negative, against product_id. Takes the full header (not just the id) because it needs the
// line items to know what left.
export const markDelivered = async (header: SalesHeader): Promise<void> => {
  for (const detail of header.details) {
    if (detail.quantity <= 0) continue;
    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'SALES',
      quantity: -detail.quantity,
      productId: detail.productId,
      salesDetailId: detail.detailId,
      transactionDate: nowIso(),
    });
  }

  const { error } = await supabase.from('sales_header').update({ status: 'DELIVERED' }).eq('id', header.id);
  if (error) {
    console.error('markDelivered', error);
    throw error;
  }
};
```

- [ ] **Step 4: Stop `cancelSalesOrder` from lying about `SALES_RETURN`**

In `cancelSalesOrder` (line 587), the un-reserve loop currently emits `transactionType: 'SALES_RETURN'`. Change that one value to `'ADJUSTMENT'` and update the comment above the function:

```ts
// If the order already reserved material stock (Start Production ran), a cancel from
// IN_PRODUCTION must return that stock and close the order's workflow_tasks rows — symmetric
// with what startProduction reserved/opened. The returned material is typed ADJUSTMENT, not
// SALES_RETURN: un-reserving is an internal correction (exactly what the "used less than
// planned" reconciliation already emits), whereas SALES_RETURN now means one thing only — the
// client sent finished goods back.
// Cancelling from ORDERED (before any reservation) or from DONE_IN_PRODUCTION (goods already
// made — they stay in stock to sell to someone else) is a plain status flip.
export const cancelSalesOrder = async (header: SalesHeader): Promise<void> => {
```

and inside the loop:

```ts
        await saveInventoryTransaction({
          id: generateId(),
          transactionType: 'ADJUSTMENT',
          quantity: material.plannedQuantity,
          materialId: material.materialId,
          productionMaterialUsageId: material.id,
          transactionDate: nowIso(),
        });
```

Nothing else in this function changes. The `IN_PRODUCTION` guard already means a `DONE_IN_PRODUCTION` cancel (enabled in Task 6) falls through to the plain status flip with no stock effect — which is the intended behaviour.

- [ ] **Step 5: Update `markDelivered`'s two call sites**

`src/components/OrdersView.tsx` — `handleMarkDelivered` (line 659) now takes the order:

```ts
  const handleMarkDelivered = async (order: SalesHeader) => {
    if (transitioningId === order.id) return;
    setTransitioningId(order.id);
    await CallAPI(() => markDelivered(order), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
        setSelectedOrder(null);
        toast.success('Order marked as delivered.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to mark order as delivered.');
      },
    });
  };
```

Row action (line 706) — pass `o`, not `o.id`:

```ts
    { label: 'Mark as Delivered', icon: <Check className="w-3.5 h-3.5" />, onClick: () => handleMarkDelivered(o), disabled: transitioningId === o.id, hidden: o.status !== 'DONE_IN_PRODUCTION' },
```

`src/components/SalesOrderDetailView.tsx` — the `onMarkDelivered` prop type changes from `(id: string) => void` to `(order: SalesHeader) => void`, and the button (line 212) passes the order:

```tsx
                <Button size="sm" onClick={() => onMarkDelivered(order)} disabled={transitioningId === order.id}>
                  <Check className="w-3.5 h-3.5" /> {transitioningId === order.id ? 'Updating...' : 'Mark as Delivered'}
                </Button>
```

Update the `onMarkDelivered` entry in that file's props interface, and wherever `OrdersView.tsx` renders `<SalesOrderDetailView … onMarkDelivered={…} />` (it will already be passing `handleMarkDelivered`, which now has the right shape).

- [ ] **Step 6: Verify types**

Run: `npm run lint`
Expected: PASS. If it complains about `markDelivered(o.id)`, a call site was missed in Step 5.

- [ ] **Step 7: Add the manual test cases**

Append to the Sales table in `docs/test-cases.md` (renumber if these IDs are taken):

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-S-15 | **Production credits finished goods** | Take an SO for `P1` × 5 through Start Production → Mark Production Done. | **`P1` = 0 + 5 = 5.** Exactly one new `PRODUCTION` ledger row, `+5`, against `P1`, showing the order's ref no. and client. |
| TC-S-16 | **Delivery debits finished goods** | On that `DONE_IN_PRODUCTION` order → Mark as Delivered. | Status → `Delivered`. **`P1` back to 0.** One new `SALES` ledger row, `−5`, against `P1`. Net zero across the two — but both movements are now *visible*, which they weren't before. |
| TC-S-17 | Extra produced, no junk rows | Mark Production Done with extra produced = 2 on the line. | `P1` = 5 + 2 = 7. Two `PRODUCTION` rows (`+5` ordered, `+2` extra). The order's **Materials Used list shows no blank-named row** — the old synthetic `production_material_usage` row is gone. |
| TC-S-18 | Cancel from `IN_PRODUCTION` retypes | Start production on an order using `M1`, then Cancel Order. | Material still comes back, but the ledger row is now **`Adjustment`**, not `Production Return`/`SALES_RETURN`. `SALES_RETURN` is reserved for client returns from here on. |

- [ ] **Step 8: Hand off for manual testing**

Do not run the app. Tell the user Task 2 is ready and name TC-S-15 … TC-S-18 as the cases to run.

---

### Task 3: Return services

**Files:**
- Modify: `src/services/PurchasesService.ts` (append after `cancelPurchaseOrder`, line 334)
- Modify: `src/services/OrdersService.ts` (append after `cancelSalesOrder`, line 619)

**Interfaces:**
- Consumes: `PurchaseDetail.returnedQuantity`, `SalesDetail.returnedQuantity`, `InventoryTransaction.salesDetailId` (Task 1).
- Produces:
  - `PurchaseReturnLine { detailId: string; materialId: string; quantity: number; unitCost: number }`
  - `returnPurchaseOrder(purchase: PurchaseHeader, lines: PurchaseReturnLine[], remark?: string): Promise<void>`
  - `SalesReturnLine { detailId: string; productId: string; quantity: number }`
  - `returnSalesOrder(header: SalesHeader, lines: SalesReturnLine[], remark?: string): Promise<void>`
  Tasks 5 and 6 call these.

- [ ] **Step 1: Add `returnPurchaseOrder` to `src/services/PurchasesService.ts`**

```ts
export interface PurchaseReturnLine {
  detailId: string;
  materialId: string;
  quantity: number; // > 0; clamped below to receivedQuantity − returnedQuantity
  unitCost: number;
}

// Sends received material back to the vendor: one PURCHASE_RETURN row per line, NEGATIVE — the
// goods leave, so material.quantity falls. (A return is not a receipt; only the sign of
// inventory_transaction.quantity actually moves stock.) The line's returned_quantity goes up so a
// part-return can be topped up later, and the header lands on RETURNED once every line is fully
// back, PARTIALLY_RETURNED otherwise.
export const returnPurchaseOrder = async (
  purchase: PurchaseHeader,
  lines: PurchaseReturnLine[],
  remark?: string,
): Promise<void> => {
  const byDetailId = new Map(purchase.details.map(d => [d.detailId, d]));
  const returnedByDetailId = new Map<string, number>();

  for (const line of lines) {
    const detail = byDetailId.get(line.detailId);
    if (!detail) continue;

    // Clamp here, not just in the modal. The cap is what stops a double-submit (or a stale
    // header in the caller's state) from returning the same goods twice, so it belongs next to
    // the write — the ledger is insert-only and the trigger is AFTER INSERT, so an over-return
    // cannot be undone.
    const remaining = detail.receivedQuantity - detail.returnedQuantity;
    const qty = Math.min(line.quantity, remaining);
    if (qty <= 0) continue;

    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'PURCHASE_RETURN',
      quantity: -qty,
      unitCost: line.unitCost,
      materialId: line.materialId,
      purchaseDetailId: line.detailId,
      remark,
      transactionDate: nowIso(),
    });

    const newReturned = detail.returnedQuantity + qty;
    const { error } = await supabase
      .from('purchase_detail')
      .update({ returned_quantity: newReturned })
      .eq('detail_id', line.detailId);
    if (error) {
      console.error('returnPurchaseOrder(detail)', error);
      throw error;
    }
    returnedByDetailId.set(line.detailId, newReturned);
  }

  // Every line clamped to zero — nothing was returned, so don't move the header.
  if (returnedByDetailId.size === 0) return;

  const fullyReturned = purchase.details.every(d => {
    const returned = returnedByDetailId.get(d.detailId) ?? d.returnedQuantity;
    return returned >= d.receivedQuantity;
  });

  const { error } = await supabase
    .from('purchase_header')
    .update({ status: fullyReturned ? 'RETURNED' : 'PARTIALLY_RETURNED' })
    .eq('id', purchase.id);
  if (error) {
    console.error('returnPurchaseOrder(header)', error);
    throw error;
  }
};
```

- [ ] **Step 2: Add `returnSalesOrder` to `src/services/OrdersService.ts`**

```ts
export interface SalesReturnLine {
  detailId: string;
  productId: string;
  quantity: number; // > 0; clamped below to detail.quantity − returnedQuantity
}

// The client sends finished goods back: one SALES_RETURN row per line, POSITIVE — the product
// comes back into stock, mirroring the negative SALES row markDelivered wrote when it shipped.
// Sales lines are always delivered in full (markDelivered is all-or-nothing), so the cap is the
// ordered quantity minus whatever has already come back.
export const returnSalesOrder = async (
  header: SalesHeader,
  lines: SalesReturnLine[],
  remark?: string,
): Promise<void> => {
  const byDetailId = new Map(header.details.map(d => [d.detailId, d]));
  const returnedByDetailId = new Map<string, number>();

  for (const line of lines) {
    const detail = byDetailId.get(line.detailId);
    if (!detail) continue;

    // Clamped server-side for the same reason as returnPurchaseOrder — the ledger is
    // insert-only, so an over-return cannot be taken back.
    const remaining = detail.quantity - detail.returnedQuantity;
    const qty = Math.min(line.quantity, remaining);
    if (qty <= 0) continue;

    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'SALES_RETURN',
      quantity: qty,
      productId: line.productId,
      salesDetailId: line.detailId,
      remark,
      transactionDate: nowIso(),
    });

    const newReturned = detail.returnedQuantity + qty;
    const { error } = await supabase
      .from('sales_detail')
      .update({ returned_quantity: newReturned })
      .eq('detail_id', line.detailId);
    if (error) {
      console.error('returnSalesOrder(detail)', error);
      throw error;
    }
    returnedByDetailId.set(line.detailId, newReturned);
  }

  if (returnedByDetailId.size === 0) return;

  const fullyReturned = header.details.every(d => {
    const returned = returnedByDetailId.get(d.detailId) ?? d.returnedQuantity;
    return returned >= d.quantity;
  });

  const { error } = await supabase
    .from('sales_header')
    .update({ status: fullyReturned ? 'RETURNED' : 'PARTIALLY_RETURNED' })
    .eq('id', header.id);
  if (error) {
    console.error('returnSalesOrder(header)', error);
    throw error;
  }
};
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: PASS. No UI calls these yet — that's Tasks 5 and 6.

---

### Task 4: The shared return modal

One component, both tabs. Not two.

**Files:**
- Create: `src/components/ReturnModal.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (deliberately generic — it knows nothing about purchases or sales).
- Produces:
  ```ts
  export interface ReturnModalLine { id: string; name: string; movedQty: number; returnedQty: number; }
  interface ReturnModalProps {
    isOpen: boolean;
    title: string;
    itemHeader: string;    // "Material" | "Product"
    movedHeader: string;   // "Received" | "Delivered"
    lines: ReturnModalLine[];
    onClose: () => void;
    onSubmit: (quantities: Record<string, number>, remark: string) => Promise<void>;
  }
  ```
  Tasks 5 and 6 render this.

- [ ] **Step 1: Create `src/components/ReturnModal.tsx`**

Patterned on `ProductionCompletionModal.tsx` — same `Dialog` / `form` / `DialogFooter` shape, same `./ui` imports, same number-input styling.

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton } from './ui';

// Deliberately generic over both tabs: a purchase return (material goes back to the vendor) and a
// sales return (product comes back from the client) are the same interaction — pick a quantity per
// line, capped at what actually moved and isn't already back. The caller supplies the nouns.
export interface ReturnModalLine {
  id: string;          // detailId
  name: string;        // material or product name
  movedQty: number;    // received (purchase) or delivered (sales)
  returnedQty: number; // already returned
}

interface ReturnModalProps {
  isOpen: boolean;
  title: string;
  itemHeader: string;  // "Material" | "Product"
  movedHeader: string; // "Received" | "Delivered"
  lines: ReturnModalLine[];
  onClose: () => void;
  onSubmit: (quantities: Record<string, number>, remark: string) => Promise<void>;
}

export default function ReturnModal({ isOpen, title, itemHeader, movedHeader, lines, onClose, onSubmit }: ReturnModalProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Clear the draft whenever a different order opens — without this, a previous order's typed
  // quantities leak into the next one (same bug ProductionCompletionModal's reset guards against).
  useEffect(() => {
    if (!isOpen) return;
    setQuantities({});
    setRemark('');
    setSubmitting(false);
  }, [isOpen, lines]);

  const remainingOf = (line: ReturnModalLine) => Math.max(0, line.movedQty - line.returnedQty);
  const hasAnything = Object.values(quantities).some(q => q > 0);

  const handleChange = (line: ReturnModalLine, raw: string) => {
    // Clamp on the way in so the field can never show a quantity the service would silently
    // reject. The service clamps too — this is the courtesy, that one is the guarantee.
    const clamped = Math.max(0, Math.min(Number(raw) || 0, remainingOf(line)));
    setQuantities({ ...quantities, [line.id]: clamped });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnything || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(quantities, remark.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={title} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <div className="border border-slate-150 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_7rem] gap-3 px-3 py-2 bg-slate-50 font-semibold text-slate-600 text-[11px]">
            <span>{itemHeader}</span>
            <span className="text-right w-20">{movedHeader}</span>
            <span className="text-right w-20">Returned</span>
            <span className="text-right">Return</span>
          </div>

          {lines.map(line => {
            const remaining = remainingOf(line);
            return (
              <div key={line.id} className="grid grid-cols-[1fr_auto_auto_7rem] gap-3 items-center px-3 py-2 border-t border-slate-150">
                <span className="text-slate-700 truncate">{line.name}</span>
                <span className="text-right w-20 font-mono text-slate-600">{line.movedQty}</span>
                <span className="text-right w-20 font-mono text-slate-600">{line.returnedQty}</span>
                {remaining === 0 ? (
                  <span className="text-right text-[10px] text-slate-400 italic">fully returned</span>
                ) : (
                  <input
                    type="number"
                    min="0"
                    max={remaining}
                    value={quantities[line.id] ?? 0}
                    onChange={(e) => handleChange(line, e.target.value)}
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-slate-700 text-[11px] block">Remark</label>
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="e.g. wrong gauge, damaged in transit"
            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded focus:outline-none text-[11px]"
          />
        </div>

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton disabled={!hasAnything || submitting}>
            {submitting ? 'Returning...' : 'Confirm Return'}
          </DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Check `DialogSubmitButton` accepts `disabled`**

Open `src/components/ui/Dialog.tsx` and confirm `DialogSubmitButton` forwards a `disabled` prop to its underlying `<button>`. If it does not, add it:

```tsx
export const DialogSubmitButton = ({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) => (
  // …existing markup, with disabled={disabled} on the button
);
```

Match whatever the existing signature is — do not restructure the component.

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: PASS. Nothing renders `ReturnModal` yet — that's the next two tasks.

---

### Task 5: Purchase returns in the UI

**Files:**
- Modify: `src/components/PurchasesView.tsx:57` (status meta), `:103` (tab status list), `:555-561` (near `handleCancel`), `:571-579` (row actions), plus modal render
- Modify: `src/components/PurchaseOrderDetailView.tsx:24` (status meta), `:186-203` (action buttons), props interface
- Modify: `docs/test-cases.md`

**Interfaces:**
- Consumes: `returnPurchaseOrder`, `PurchaseReturnLine` (Task 3); `ReturnModal`, `ReturnModalLine` (Task 4); `PurchaseDetail.returnedQuantity` and the two new statuses (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Add the two statuses to the status-meta maps**

`src/components/PurchasesView.tsx` (~line 57) and `src/components/PurchaseOrderDetailView.tsx` (~line 24) both hold a status → `{ label, variant }` map. Add to **both**:

```ts
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'secondary' },
```

Use whatever `variant` values the local `Badge` actually supports — check `src/components/ui/Badge.tsx` and pick the closest existing ones rather than inventing new variants.

- [ ] **Step 2: Show returned orders in the PO tab**

`src/components/PurchasesView.tsx` — the PO tab's status list lives in `PurchasesService.getPurchases` (line 103). Update it there:

```ts
  query = tab === 'QUOTATION'
    ? query.eq('status', 'QUOTATION')
    : query.in('status', ['ORDERED', 'RECEIVED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED']);
```

Without this, an order vanishes from the list the moment it's returned.

- [ ] **Step 3: Wire the modal into `PurchasesView.tsx`**

Import at the top:

```ts
import ReturnModal, { ReturnModalLine } from './ReturnModal';
import { returnPurchaseOrder, PurchaseReturnLine } from '../services/PurchasesService';
```

(Fold `returnPurchaseOrder` / `PurchaseReturnLine` into the existing multi-line import from `../services/PurchasesService` at line 9 rather than adding a second import statement.)

State, beside the other modal state:

```ts
  const [returningPurchase, setReturningPurchase] = useState<PurchaseHeader | null>(null);
```

Handlers, beside `handleCancel` (line 555):

```ts
  const openReturn = (purchase: PurchaseHeader) => setReturningPurchase(purchase);

  const handleReturn = async (quantities: Record<string, number>, remark: string) => {
    if (!returningPurchase) return;
    const lines: PurchaseReturnLine[] = returningPurchase.details
      .map(d => ({
        detailId: d.detailId,
        materialId: d.materialId,
        quantity: quantities[d.detailId] || 0,
        unitCost: d.unitCost,
      }))
      .filter(l => l.quantity > 0);

    await CallAPI(() => returnPurchaseOrder(returningPurchase, lines, remark), {
      onCompleted: () => {
        setReturningPurchase(null);
        loadPurchases(activeTab);
        refreshSelectedPurchase(returningPurchase.id);
        toast.success('Material returned to vendor.');
      },
      onError: (err) => { console.error(err); toast.error('Failed to return material.'); },
    });
  };
```

Render, beside the other modals:

```tsx
      <ReturnModal
        isOpen={!!returningPurchase}
        title={`Return to Vendor — ${returningPurchase?.purchaseNo ?? ''}`}
        itemHeader="Material"
        movedHeader="Received"
        lines={(returningPurchase?.details ?? []).map((d): ReturnModalLine => ({
          id: d.detailId,
          name: d.materialName,
          movedQty: d.receivedQuantity,
          returnedQty: d.returnedQuantity,
        }))}
        onClose={() => setReturningPurchase(null)}
        onSubmit={handleReturn}
      />
```

- [ ] **Step 4: Add the row action**

`src/components/PurchasesView.tsx`, `buildRowActions` (line 571). `Cancel Order` is unchanged (still `ORDERED` only — its only pre-receipt status). Add one entry:

```ts
    { label: 'Return to Vendor', icon: <Undo2 className="w-3.5 h-3.5" />, onClick: () => openReturn(p), hidden: !['RECEIVED', 'PARTIALLY_RETURNED'].includes(p.status) },
```

Import `Undo2` from `lucide-react` (already used in `InventoryView.tsx`, so it's a known-good icon in this codebase).

- [ ] **Step 5: Add the detail-page button**

`src/components/PurchaseOrderDetailView.tsx` — add an `onReturn: (purchase: PurchaseHeader) => void` prop to the props interface, pass `openReturn` from `PurchasesView.tsx` where it renders `<PurchaseOrderDetailView … />`, and add a block after the existing `ORDERED` block (~line 203):

```tsx
              {(purchase.status === 'RECEIVED' || purchase.status === 'PARTIALLY_RETURNED') && (
                <Button variant="destructive" size="sm" onClick={() => onReturn(purchase)}>
                  <Undo2 className="w-3.5 h-3.5" /> Return to Vendor
                </Button>
              )}
```

Import `Undo2` from `lucide-react` in this file too.

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Add the manual test cases**

Append to the Purchase table in `docs/test-cases.md`:

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-P-13 | **Partial purchase return** | On a `RECEIVED` PO (`M1` × 20, so `M1` = 120) → Return to Vendor. Enter 5. Confirm. | **`M1` = 120 − 5 = 115.** One `PURCHASE_RETURN` ledger row, **`−5`**, against `M1`. Status → `Partially Returned`. Line shows Returned 5 of 20. |
| TC-P-14 | **Full purchase return** | Return the remaining 15 on that same PO. | `M1` = 100. Status → `Returned`. **`Return to Vendor` is no longer offered.** The line renders "fully returned" and is read-only in the modal. |
| TC-P-15 | Return cap | Reopen the return modal on a part-returned PO and try to type more than remaining. | Input clamps to the remaining qty. Confirm is disabled until at least one line has a qty > 0. |
| TC-P-16 | Cancel vs Return gating | Check the action menu across statuses. | `Cancel Order` on `ORDERED` **only**. `Return to Vendor` on `RECEIVED` / `Partially Returned` only. **Never both at once.** |
| TC-P-17 | Returned orders stay listed | After TC-P-14, look at the Purchase Order tab. | The `Returned` order is still in the list (not filtered out). Delete is **not** offered on it. |

---

### Task 6: Sales returns in the UI (and cancel on `DONE_IN_PRODUCTION`)

**Files:**
- Modify: `src/components/OrdersView.tsx:61` (status meta), `:677-683` (near `handleCancel`), `:698-708` (row actions), plus modal render
- Modify: `src/services/OrdersService.ts:126` (SO tab status list)
- Modify: `src/components/SalesOrderDetailView.tsx:29` (status meta), `:191-220` (action buttons), props interface
- Modify: `docs/test-cases.md`

**Interfaces:**
- Consumes: `returnSalesOrder`, `SalesReturnLine` (Task 3); `ReturnModal`, `ReturnModalLine` (Task 4); `SalesDetail.returnedQuantity` and the two new statuses (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Add the two statuses to the status-meta maps**

Same two entries as Task 5 Step 1, in `src/components/OrdersView.tsx` (~line 61) and `src/components/SalesOrderDetailView.tsx` (~line 29):

```ts
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'secondary' },
```

- [ ] **Step 2: Show returned orders in the SO tab**

`src/services/OrdersService.ts`, `getSalesOrders` (line 126):

```ts
  query = tab === 'QUOTATION'
    ? query.eq('status', 'QUOTATION')
    : query.in('status', ['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION', 'DELIVERED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED']);
```

- [ ] **Step 3: Wire the modal into `OrdersView.tsx`**

Fold into the existing `../services/OrdersService` import at line 9: `returnSalesOrder`, `SalesReturnLine`. Add `import ReturnModal, { ReturnModalLine } from './ReturnModal';`.

State:

```ts
  const [returningOrder, setReturningOrder] = useState<SalesHeader | null>(null);
```

Handlers, beside `handleCancel` (line 677):

```ts
  const openReturn = (order: SalesHeader) => setReturningOrder(order);

  const handleReturn = async (quantities: Record<string, number>, remark: string) => {
    if (!returningOrder) return;
    const lines: SalesReturnLine[] = returningOrder.details
      .map(d => ({
        detailId: d.detailId,
        productId: d.productId,
        quantity: quantities[d.detailId] || 0,
      }))
      .filter(l => l.quantity > 0);

    await CallAPI(() => returnSalesOrder(returningOrder, lines, remark), {
      onCompleted: () => {
        setReturningOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(returningOrder.id);
        toast.success('Product returned by client.');
      },
      onError: (err) => { console.error(err); toast.error('Failed to record return.'); },
    });
  };
```

Render, beside the other modals:

```tsx
      <ReturnModal
        isOpen={!!returningOrder}
        title={`Return from Client — ${returningOrder?.salesNo ?? ''}`}
        itemHeader="Product"
        movedHeader="Delivered"
        lines={(returningOrder?.details ?? []).map((d): ReturnModalLine => ({
          id: d.detailId,
          name: d.productName,
          movedQty: d.quantity,
          returnedQty: d.returnedQuantity,
        }))}
        onClose={() => setReturningOrder(null)}
        onSubmit={handleReturn}
      />
```

- [ ] **Step 4: Update the row actions — cancel widens, return appears**

`src/components/OrdersView.tsx`, `buildRowActions` (line 698). Change the existing `Cancel Order` entry's `hidden:` to include `DONE_IN_PRODUCTION`, and add `Return from Client`:

```ts
    { label: 'Cancel Order', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleCancel(o), danger: true, hidden: !['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION'].includes(o.status) },
    { label: 'Return from Client', icon: <Undo2 className="w-3.5 h-3.5" />, onClick: () => openReturn(o), hidden: !['DELIVERED', 'PARTIALLY_RETURNED'].includes(o.status) },
```

Import `Undo2` from `lucide-react`.

Cancel is now offered at every pre-delivery status and Return at every post-delivery one — they never both appear. `cancelSalesOrder` needs no change for the new `DONE_IN_PRODUCTION` case: its `IN_PRODUCTION` guard doesn't fire, so it falls through to the plain status flip, leaving the finished goods in stock (which is correct — they exist, and can be sold to someone else).

- [ ] **Step 5: Update the detail-page buttons**

`src/components/SalesOrderDetailView.tsx` — add `onReturn: (order: SalesHeader) => void` to the props interface and pass `openReturn` from `OrdersView.tsx`.

Add a Cancel button to the existing `DONE_IN_PRODUCTION` block (~line 210):

```tsx
            {order.status === 'DONE_IN_PRODUCTION' && (
              <>
                <Button size="sm" onClick={() => onMarkDelivered(order)} disabled={transitioningId === order.id}>
                  <Check className="w-3.5 h-3.5" /> {transitioningId === order.id ? 'Updating...' : 'Mark as Delivered'}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => onCancel(order)}>Cancel Order</Button>
              </>
            )}
```

(Note this block also picks up the `onMarkDelivered(order)` signature change from Task 2 Step 5 — if Task 2 is done, it already reads this way.)

Add a new block after it:

```tsx
            {(order.status === 'DELIVERED' || order.status === 'PARTIALLY_RETURNED') && (
              <Button variant="destructive" size="sm" onClick={() => onReturn(order)}>
                <Undo2 className="w-3.5 h-3.5" /> Return from Client
              </Button>
            )}
```

Import `Undo2` from `lucide-react` in this file too.

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Add the manual test cases**

Append to the Sales table in `docs/test-cases.md`:

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-S-19 | **Partial sales return** | On a `DELIVERED` SO (`P1` × 5, so `P1` = 0 after shipping) → Return from Client. Enter 3. Confirm. | **`P1` = 0 + 3 = 3.** One `SALES_RETURN` ledger row, **`+3`**, against `P1`. Status → `Partially Returned`. Line shows Returned 3 of 5. |
| TC-S-20 | **Full sales return** | Return the remaining 2. | `P1` = 5. Status → `Returned`. `Return from Client` no longer offered; the line is read-only in the modal. |
| TC-S-21 | **Cancel from `DONE_IN_PRODUCTION`** | Take an SO for `P1` × 5 to `DONE_IN_PRODUCTION` (so `P1` = 5), then Cancel Order. | Status → `Cancelled`. **`P1` stays 5** — no ledger row is written. The goods were made; cancelling the order doesn't unmake them, and they stay in stock to sell to someone else. |
| TC-S-22 | Cancel vs Return gating | Check the action menu across statuses. | `Cancel Order` on `ORDERED` / `IN_PRODUCTION` / `DONE_IN_PRODUCTION`. `Return from Client` on `DELIVERED` / `Partially Returned`. **Never both at once**, and `DELIVERED` offers no Cancel. |
| TC-S-23 | ⚠️ Deleting a cancelled `DONE_IN_PRODUCTION` order still throws | Cancel an order out of `DONE_IN_PRODUCTION`, then Delete it. | **Fails with an FK violation.** This is `docs/flows.md` gap #5 / `TC-S-14` — `inventory_transaction`'s `production_material_usage_id` FK has no `ON DELETE` so it RESTRICTs. The new `DONE_IN_PRODUCTION` cancel widens the set of orders that can hit it; it is **not** a regression introduced by this work. Fixing it means adding `ON DELETE` to the two older FKs, which is its own change. |

---

### Task 7: Ledger display

Product-side rows currently show no ref no. and carry labels that are now wrong.

**Files:**
- Modify: `src/services/InventoryTransactionService.ts:17-38` (`mapTransactionRow`), `:64-70` (select), `:132-156` (`mapMovementRow`), `:167-191` (`getInventoryMovements` select), `:201-208` (stats comment)
- Modify: `src/components/InventoryView.tsx:53-66` (`MOVEMENT_META`, `TYPE_FILTER_OPTIONS`), `:401` (badge render)

**Interfaces:**
- Consumes: `sales_detail_id` column (Task 1); the rows Tasks 2 and 3 write.
- Produces: nothing downstream.

- [ ] **Step 1: Add the third join path to `mapTransactionRow`**

`src/services/InventoryTransactionService.ts` — a ledger row now reaches its sales header two ways: through `production_material_usage` (material consumed in production) **or** directly through `sales_detail` (finished goods). Update the mapper (line 17):

```ts
const mapTransactionRow = (row: any): InventoryTransaction => {
  const purchaseHeader = row.purchase_detail?.purchase_header;
  // Two routes to the sales header now: the old one via a production material usage row (material
  // consumed against an order), and the direct one via sales_detail (finished goods produced,
  // shipped, or returned). A row only ever has one of them set.
  const salesHeader = row.production_material_usage?.sales_detail?.sales_header
    || row.sales_detail?.sales_header;
  return {
    id: row.id,
    transactionType: row.transaction_type,
    quantity: Number(row.quantity) || 0,
    unitCost: row.unit_cost != null ? Number(row.unit_cost) : undefined,
    remark: row.remark || undefined,
    materialId: row.material_id || undefined,
    materialName: row.material?.name,
    productId: row.product_id || undefined,
    productName: row.product?.name,
    salesDetailId: row.sales_detail_id || undefined,
    refNo: purchaseHeader?.purchase_no || salesHeader?.sales_no,
    counterpartyName: purchaseHeader?.vendors?.company_name || salesHeader?.clients?.company_name,
    status: purchaseHeader?.status || salesHeader?.status,
    purchaseHeaderId: purchaseHeader?.id,
    salesHeaderId: salesHeader?.id,
    transactionDate: row.transaction_date,
    createdAt: row.created_at,
  };
};
```

- [ ] **Step 2: Embed `sales_detail` in both selects**

`getInventoryTransactions` (line 66):

```ts
    .select(`
      *, material(name), product(name),
      purchase_detail(purchase_header(id, purchase_no, status, vendors(company_name))),
      production_material_usage(sales_detail(sales_header(id, sales_no, status, clients(company_name)))),
      sales_detail(sales_header(id, sales_no, status, clients(company_name)))
    `, { count: 'exact' })
```

`getInventoryMovements` (line 173):

```ts
    .select(`
      id, transaction_type, quantity, unit_cost, transaction_date,
      purchase_detail(purchase_header(id, purchase_no, status, vendors(company_name))),
      production_material_usage(id, sales_detail(sales_header(id, sales_no, status, clients(company_name)), workflow_tasks(employee_id, employees(full_name)))),
      sales_detail(sales_header(id, sales_no, status, clients(company_name)))
    `)
```

- [ ] **Step 3: Same third route in `mapMovementRow`**

`src/services/InventoryTransactionService.ts` (line 132) — change the first three lines:

```ts
const mapMovementRow = (row: any): InventoryListItem => {
  const purchaseHeader = row.purchase_detail?.purchase_header;
  const usageSalesDetail = row.production_material_usage?.sales_detail;
  const salesHeader = usageSalesDetail?.sales_header || row.sales_detail?.sales_header;
  const task = usageSalesDetail?.workflow_tasks?.[0];
  // …rest of the function is unchanged
```

- [ ] **Step 4: Fix the now-false stats comment**

`getInventoryStatsSummary`'s docblock (line 201) claims *"Only material-side rows carry consumption data … products have no ledger entry for ordinary sales"*. That is exactly what Task 2 fixed. Replace that sentence with:

```ts
 * "Top Consumed" stays materials-only on purpose: products now DO have ledger rows for ordinary
 * sales (markDelivered writes SALES −qty), but mixing finished goods into a "top consumed
 * materials" list would compare two different things. A separate top-selling-products stat is a
 * different feature.
```

Also delete the same stale claim from the comment at `src/components/InventoryView.tsx:53-56`.

- [ ] **Step 5: Add `PRODUCTION` to `MOVEMENT_META` and fix the two wrong labels**

`src/components/InventoryView.tsx` (line 58). `SALES` is no longer always "Production Consumption" (it's also a delivery now) and `SALES_RETURN` is no longer "Production Return" (that's an `ADJUSTMENT` since Task 2 — `SALES_RETURN` now means a client return):

```ts
const MOVEMENT_META: Record<InventoryTransactionType, { label: string; icon: typeof PackagePlus; badgeClassName: string }> = {
  PURCHASE: { label: 'Purchase', icon: PackagePlus, badgeClassName: 'bg-primary/10 text-primary border-primary/20' },
  PURCHASE_RETURN: { label: 'Purchase Return', icon: PackageMinus, badgeClassName: 'bg-warning/10 text-warning border-warning/20' },
  PRODUCTION: { label: 'Production', icon: Factory, badgeClassName: 'bg-success/10 text-success border-success/20' },
  SALES: { label: 'Consumption / Delivery', icon: PackageMinus, badgeClassName: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400' },
  SALES_RETURN: { label: 'Sales Return', icon: Undo2, badgeClassName: 'bg-success/10 text-success border-success/20' },
  ADJUSTMENT: { label: 'Adjustment', icon: SlidersHorizontal, badgeClassName: 'bg-secondary text-secondary-foreground border-transparent' },
};
```

A `SALES` row is a material consumed in production **or** a finished good shipped — the ledger's own Material/Product column already says which, so one label covers both. `Factory` moves to `PRODUCTION`, which is what it always meant.

Note for the reviewer: pre-existing `SALES_RETURN` rows in the DB (written by the old cancel path) are *material* rows and will now render as "Sales Return". That is historical data reading slightly oddly, not a bug in this code — the old rows are what they are.

- [ ] **Step 6: Check `TYPE_FILTER_OPTIONS`**

Line 66 — if it's derived from `MOVEMENT_META` (e.g. `Object.entries(MOVEMENT_META).map(…)`), `PRODUCTION` appears automatically and there is nothing to do. If it's a hand-written array, add:

```ts
  { value: 'PRODUCTION', label: 'Production' },
```

- [ ] **Step 7: Verify**

Run: `npm run lint`
Expected: PASS. `MOVEMENT_META` is a `Record<InventoryTransactionType, …>`, so if `PRODUCTION` were missing, tsc would have caught it back in Task 1 — confirm it's present now.

- [ ] **Step 8: Add the manual test case**

Append to the Inventory table in `docs/test-cases.md`:

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-I-08 | Finished-goods rows are legible | After TC-S-15/16/19, open Inventory → ledger and filter type = `Production`. | `PRODUCTION` rows show `P1`, `+qty`, **and the sales order's ref no. + client name** (via the new `sales_detail_id` join — before this they'd have shown a blank ref). Clicking through opens the sales order. `Production` appears as a filter chip. |

---

### Task 8: Documentation

**Files:**
- Modify: `docs/flows.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Rewrite the two flow diagrams**

`docs/flows.md` — update the Purchase and Sales ASCII diagrams to the ones in the spec's "Status model" section (`docs/superpowers/specs/2026-07-13-finished-goods-and-returns-design.md`), showing: PO `RECEIVED → PARTIALLY_RETURNED → RETURNED`; SO `DONE_IN_PRODUCTION` (`** product +qty **`) `→ DELIVERED` (`** product −qty **`) `→ PARTIALLY_RETURNED → RETURNED`; and cancel reaching `DONE_IN_PRODUCTION` with no stock effect.

- [ ] **Step 2: Update the step tables**

In the Purchase table, add a `Return` row (`returnPurchaseOrder()` → `PURCHASE_RETURN` per line, `−qty`, bumps `returned_quantity`, header → `PARTIALLY_RETURNED`/`RETURNED`; stock effect **material −qty**).

In the Sales table: `Confirm Done` gains **product +ordered qty**; `Mark Delivered` changes from "**none**" to **product −qty**; add a `Return` row (**product +qty**); add a `Cancel from DONE_IN_PRODUCTION` row (**none** — goods stay in stock).

- [ ] **Step 3: Rewrite the Inventory-flow writers table**

Replace the rows that changed and add the new ones:

| Origin | Type | Sign | Target |
|---|---|---|---|
| `confirmProductionDone()` — ordered qty | `PRODUCTION` | `+` | **product** |
| `confirmProductionDone()` — extra produced | `PRODUCTION` | `+` | **product** |
| `markDelivered()` | `SALES` | `−` | **product** |
| `returnPurchaseOrder()` | `PURCHASE_RETURN` | `−` | material |
| `returnSalesOrder()` | `SALES_RETURN` | `+` | **product** |
| `cancelSalesOrder()` from `IN_PRODUCTION` | `ADJUSTMENT` | `+` | material |

Delete the line *"`PURCHASE_RETURN` is declared in the type union but **no code path emits it**"* — one does now. Add `PRODUCTION` to the transaction-types list, and note the ledger's third join route (`sales_detail_id`).

- [ ] **Step 4: Update "Known gaps"**

- **Gap #1 (products never drawn down by a sale)** — **strike it.** Fixed. Replace with a one-line note that `product.quantity` is now credited by `PRODUCTION` on completion and debited by `SALES` on delivery.
- **Gap #5 (FKs RESTRICT)** — keep, and add: *"The `DONE_IN_PRODUCTION` cancel added in the finished-goods/returns change widens the set of orders that can reach this (see `TC-S-23`). The new `sales_detail_id` FK uses `ON DELETE SET NULL` and does not extend the problem."*
- **Gaps #2, #3, #4** — unchanged. Gap #3 (stock can go negative) explicitly still applies: a purchase return of material already consumed in production will drive `material.quantity` below zero, and nothing guards it. That is a known, accepted non-goal of this change.

- [ ] **Step 5: Verify**

Re-read `docs/flows.md` end to end. Every ledger writer in the table must exist in the code, and every code path that calls `saveInventoryTransaction` must be in the table. Run: `npm run lint`. Expected: PASS.

---

## Self-Review

**Spec coverage:** Schema → T1. Types/serializer → T1. FG credit + debit → T2. Extra-produced hack removal → T2. `SALES_RETURN` → `ADJUSTMENT` retype → T2. `returnPurchaseOrder` / `returnSalesOrder` → T3. `ReturnModal` → T4. Purchase UI + badges + tab list → T5. Sales UI + cancel widening + badges + tab list → T6. Ledger joins + `PRODUCTION` chip + label fixes → T7. Docs → T8. Non-goals (negative stock, partial receipt, credit notes) → correctly absent, and gap #3 is restated in T8 Step 4 so it isn't lost.

**Type consistency:** `markDelivered(header: SalesHeader)` — defined T2 Step 3, both call sites updated T2 Step 5, and the `SalesOrderDetailView` block that renders it is touched again in T6 Step 5 (flagged there). `ReturnModalLine { id, name, movedQty, returnedQty }` — defined T4, consumed with those exact names in T5 Step 3 and T6 Step 3. `PurchaseReturnLine { detailId, materialId, quantity, unitCost }` / `SalesReturnLine { detailId, productId, quantity }` — defined T3, constructed with those exact fields in T5/T6. `onSubmit(quantities: Record<string, number>, remark: string)` — one signature, used identically by both callers. `returnedQuantity` (camel) on the TS interfaces, `returned_quantity` (snake) in SQL and in the `.update()` calls — correct on both sides.

**Ordering:** T1 blocks everything. T2 and T3 are independent of each other. T4 blocks T5 and T6. T5 and T6 are independent. T7 is best after T2/T3 (it displays their rows) but only depends on T1's column. T8 last.

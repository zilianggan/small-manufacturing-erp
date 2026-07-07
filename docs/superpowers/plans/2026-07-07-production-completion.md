# Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real stock movement and production tracking into the Sales Order production flow: `Start Production` reserves planned raw material, and `Mark Production Done` opens a reconciliation dialog (actual usage, leftover by-products, extra finished-goods yield) before flipping status, per `docs/superpowers/specs/2026-07-07-production-completion-design.md`.

**Architecture:** Pattern-A service functions in `OrdersService.ts` (direct Supabase reads/writes + `InventoryTransactionService.saveInventoryTransaction` for stock movement), one new presentational modal component (`ProductionCompletionModal.tsx`), and `OrdersView.tsx` wiring that mirrors its existing `CallAPI`/`transitioningId` transition pattern.

**Tech Stack:** React 19 + TypeScript, Supabase (`supabase-js`), Tailwind v4. No test runner is configured in this project (`package.json` only has `lint`: `tsc --noEmit`) — verification in this plan is type-checking plus a manual QA pass the user runs themselves (do not launch the dev server or drive the UI yourself).

## Global Constraints

- No `db.ts`, no `server.ts` REST hop, no `useTableData` — `OrdersService.ts` stays pattern-A (direct `supabase` calls + `helper.ts`/`InventoryTransactionService.ts` primitives), matching `PurchasesService.ts`.
- `inventory_transaction` is insert-only — stock is trigger-maintained (`update_material_stock()` in `function_trigger.sql` adds `quantity` signed to `material.quantity`/`product.quantity` on INSERT). Never update `material.quantity`/`product.quantity` directly.
- `transactionType` values used: `'SALES'` (reservation, and extra deduction when actual > planned), `'SALES_RETURN'` (reconciliation surplus, leftover credits), `'ADJUSTMENT'` (extra-produced finished goods credit).
- `remark` on every new `inventory_transaction` row is `header.salesNo`.
- `workflow_tasks` gets one row per `sales_detail` line (matches its `sales_detail_id` FK) — not per header.
- Do not touch `WorkflowsView.tsx`, `WorkflowsService.ts`, or the legacy `WorkflowTask` type — out of scope (separate future migration), per the spec.
- Do not run the dev server, open a browser, or otherwise self-test the UI — the user verifies manually. Your verification is `npm run lint` after each task.

---

### Task 1: Types — `productionMaterialUsageId` and material actual/returned quantities

**Files:**
- Modify: `src/types.ts:322-341` (`InventoryTransaction` interface)
- Modify: `src/types.ts:153-160` (`ProductionMaterialUsage` interface)
- Modify: `src/helper.ts:65-75` (`erp_inventory_transaction` row mapper)

**Interfaces:**
- Produces: `InventoryTransaction.productionMaterialUsageId?: string`, `ProductionMaterialUsage.actualQuantity: number`, `ProductionMaterialUsage.returnedQuantity: number` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Add `productionMaterialUsageId` to `InventoryTransaction`**

In `src/types.ts`, find:
```ts
export interface InventoryTransaction {
  id: string;
  transactionType: InventoryTransactionType;
  quantity: number; // signed: + increases stock, - decreases stock
  unitCost?: number;
  remark?: string;
  materialId?: string; // exactly one of materialId/productId is set
  materialName?: string; // joined, display only
  productId?: string;
  productName?: string; // joined, display only
  purchaseDetailId?: string; // FK -> purchase_detail.detail_id, set when a PO receipt generated this row
  transactionDate: string;
  createdAt?: string;
}
```
Replace with:
```ts
export interface InventoryTransaction {
  id: string;
  transactionType: InventoryTransactionType;
  quantity: number; // signed: + increases stock, - decreases stock
  unitCost?: number;
  remark?: string;
  materialId?: string; // exactly one of materialId/productId is set
  materialName?: string; // joined, display only
  productId?: string;
  productName?: string; // joined, display only
  purchaseDetailId?: string; // FK -> purchase_detail.detail_id, set when a PO receipt generated this row
  productionMaterialUsageId?: string; // FK -> production_material_usage.id, set when a production reservation/reconciliation generated this row
  transactionDate: string;
  createdAt?: string;
}
```

- [ ] **Step 2: Add `actualQuantity`/`returnedQuantity` to `ProductionMaterialUsage`**

In `src/types.ts`, find:
```ts
export interface ProductionMaterialUsage {
  id: string;
  salesDetailId?: string;
  materialId: string;
  materialName: string; // joined, display only
  materialCode?: string; // joined, display only
  plannedQuantity: number;
}
```
Replace with:
```ts
export interface ProductionMaterialUsage {
  id: string;
  salesDetailId?: string;
  materialId: string;
  materialName: string; // joined, display only
  materialCode?: string; // joined, display only
  plannedQuantity: number;
  actualQuantity: number;
  returnedQuantity: number;
}
```

- [ ] **Step 3: Map the new column in `helper.ts`'s `erp_inventory_transaction` writer**

In `src/helper.ts`, find:
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
        transaction_date: t.transactionDate
    }),
```
Replace with:
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
        transaction_date: t.transactionDate
    }),
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no new errors (existing `ProductionMaterialUsage` object literals in `OrdersService.ts` will now be missing `actualQuantity`/`returnedQuantity` — that's expected here, Task 2 fixes it).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/helper.ts
git commit -m "feat: add productionMaterialUsageId and material actual/returned quantity fields"
```

---

### Task 2: `OrdersService.ts` — reserve stock and open workflow tasks on Start Production

**Files:**
- Modify: `src/services/OrdersService.ts:40-47` (`mapMaterialUsageRow`)
- Modify: `src/services/OrdersService.ts:1-14` (imports)
- Modify: `src/services/OrdersService.ts:223-229` (`startProduction`)

**Interfaces:**
- Consumes: `SalesHeader`, `SalesDetail`, `ProductionMaterialUsage` (from `../types`, Task 1's new fields); `saveInventoryTransaction` (from `./InventoryTransactionService`, signature `(tx: InventoryTransaction) => Promise<void>`).
- Produces: `startProduction(header: SalesHeader): Promise<void>` — signature changed from `(headerId: string)`. Consumed by Task 5 (`OrdersView.tsx`).

- [ ] **Step 1: Map `actual_quantity`/`returned_quantity` in `mapMaterialUsageRow`**

In `src/services/OrdersService.ts`, find:
```ts
const mapMaterialUsageRow = (row: any): ProductionMaterialUsage => ({
  id: row.id,
  salesDetailId: row.sales_detail_id,
  materialId: row.material_id,
  materialName: row.material?.name || '',
  materialCode: row.material?.code || undefined,
  plannedQuantity: Number(row.planned_quantity) || 0,
});
```
Replace with:
```ts
const mapMaterialUsageRow = (row: any): ProductionMaterialUsage => ({
  id: row.id,
  salesDetailId: row.sales_detail_id,
  materialId: row.material_id,
  materialName: row.material?.name || '',
  materialCode: row.material?.code || undefined,
  plannedQuantity: Number(row.planned_quantity) || 0,
  actualQuantity: Number(row.actual_quantity) || 0,
  returnedQuantity: Number(row.returned_quantity) || 0,
});
```

- [ ] **Step 2: Import `saveInventoryTransaction` and `generateId` is already local**

In `src/services/OrdersService.ts`, find:
```ts
import { supabase } from "./supabase";
import { getClients } from "./ContactsService";
import { Attachment, SalesHeader, SalesDetail, ProductionMaterialUsage } from "../types";
```
Replace with:
```ts
import { supabase } from "./supabase";
import { getClients } from "./ContactsService";
import { saveInventoryTransaction } from "./InventoryTransactionService";
import { Attachment, SalesHeader, SalesDetail, ProductionMaterialUsage } from "../types";
```

- [ ] **Step 3: Rewrite `startProduction` to take the full header, reserve material stock, and open workflow tasks**

In `src/services/OrdersService.ts`, find:
```ts
// Status-only transitions — no inventory_transaction insert. Actual product/
// material stock movement is deferred to a future production/workflow step
// that will consume production_material_usage.actual_quantity.
export const startProduction = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('sales_header').update({ status: 'IN_PRODUCTION' }).eq('id', headerId);
  if (error) {
    console.error('startProduction', error);
    throw error;
  }
};
```
Replace with:
```ts
// Reserves every planned material's stock (one -plannedQuantity
// inventory_transaction each) and opens one workflow_tasks row per
// sales_detail line — reconciliation against actual usage happens in
// confirmProductionDone when the order is marked done.
export const startProduction = async (header: SalesHeader): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  const { error: taskError } = await supabase.from('workflow_tasks').insert(
    header.details.map(d => ({
      sales_detail_id: d.detailId,
      status: 'IN_PRODUCTION',
      start_date: today,
    }))
  );
  if (taskError) {
    console.error('startProduction(workflow_tasks)', taskError);
    throw taskError;
  }

  for (const detail of header.details) {
    for (const material of detail.materials) {
      await saveInventoryTransaction({
        id: generateId(),
        transactionType: 'SALES',
        quantity: -material.plannedQuantity,
        remark: header.salesNo,
        materialId: material.materialId,
        productionMaterialUsageId: material.id,
        transactionDate: today,
      });
    }
  }

  const { error } = await supabase.from('sales_header').update({ status: 'IN_PRODUCTION' }).eq('id', header.id);
  if (error) {
    console.error('startProduction', error);
    throw error;
  }
};
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no new errors from this file (an error will remain about `OrdersView.tsx` still calling `startProduction(order.id)` with a `string` — that's expected here, Task 5 fixes the call site. If `tsc` reports it, confirm the error is on that line and move on).

- [ ] **Step 5: Commit**

```bash
git add src/services/OrdersService.ts
git commit -m "feat: reserve material stock and open workflow tasks on start production"
```

---

### Task 3: `OrdersService.ts` — `confirmProductionDone` reconciliation

**Files:**
- Modify: `src/services/OrdersService.ts` (add new exported interfaces + function; remove `markProductionDone`)

**Interfaces:**
- Consumes: `saveInventoryTransaction` (Task 2's import), `SalesHeader`.
- Produces:
  ```ts
  export interface MaterialReconciliationInput {
    usageId: string;       // production_material_usage.id
    materialId: string;
    plannedQuantity: number;
    actualQuantity: number;
  }
  export interface LeftoverMaterialInput {
    salesDetailId: string;
    materialId: string;
    quantity: number;
  }
  export interface ExtraProducedInput {
    salesDetailId: string;
    productId: string;
    quantity: number;
  }
  export const confirmProductionDone: (
    header: SalesHeader,
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    extraProduced: ExtraProducedInput[],
  ) => Promise<void>
  ```
  Consumed by Task 4 (modal's prop types) and Task 5 (`OrdersView.tsx`'s submit handler).

- [ ] **Step 1: Remove `markProductionDone`, add the reconciliation types and `confirmProductionDone`**

In `src/services/OrdersService.ts`, find:
```ts
export const markProductionDone = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('sales_header').update({ status: 'DONE_IN_PRODUCTION' }).eq('id', headerId);
  if (error) {
    console.error('markProductionDone', error);
    throw error;
  }
};
```
Replace with:
```ts
export interface MaterialReconciliationInput {
  usageId: string; // production_material_usage.id
  materialId: string;
  plannedQuantity: number;
  actualQuantity: number;
}

export interface LeftoverMaterialInput {
  salesDetailId: string;
  materialId: string;
  quantity: number;
}

export interface ExtraProducedInput {
  salesDetailId: string;
  productId: string;
  quantity: number;
}

// Reconciles actual material usage against the reservation made in
// startProduction, credits any leftover/by-product material and any
// extra finished-goods yield, closes the order's workflow_tasks rows, and
// advances the header to DONE_IN_PRODUCTION.
export const confirmProductionDone = async (
  header: SalesHeader,
  reconciliations: MaterialReconciliationInput[],
  leftovers: LeftoverMaterialInput[],
  extraProduced: ExtraProducedInput[],
): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  for (const r of reconciliations) {
    const diff = r.plannedQuantity - r.actualQuantity;
    if (diff !== 0) {
      await saveInventoryTransaction({
        id: generateId(),
        transactionType: diff > 0 ? 'SALES_RETURN' : 'SALES',
        quantity: diff,
        remark: header.salesNo,
        materialId: r.materialId,
        productionMaterialUsageId: r.usageId,
        transactionDate: today,
      });
    }

    const { error } = await supabase
      .from('production_material_usage')
      .update({ actual_quantity: r.actualQuantity, returned_quantity: Math.max(0, diff) })
      .eq('id', r.usageId);
    if (error) {
      console.error('confirmProductionDone(reconciliation)', error);
      throw error;
    }
  }

  for (const l of leftovers) {
    const { data: inserted, error: insertError } = await supabase
      .from('production_material_usage')
      .insert({
        sales_detail_id: l.salesDetailId,
        material_id: l.materialId,
        planned_quantity: 0,
        actual_quantity: 0,
        returned_quantity: l.quantity,
        remark: 'Leftover from production',
      })
      .select('id')
      .single();
    if (insertError) {
      console.error('confirmProductionDone(leftover)', insertError);
      throw insertError;
    }

    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'SALES_RETURN',
      quantity: l.quantity,
      remark: header.salesNo,
      materialId: l.materialId,
      productionMaterialUsageId: inserted.id,
      transactionDate: today,
    });
  }

  for (const p of extraProduced) {
    if (p.quantity <= 0) continue;
    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'ADJUSTMENT',
      quantity: p.quantity,
      remark: header.salesNo,
      productId: p.productId,
      transactionDate: today,
    });
  }

  const { error: taskError } = await supabase
    .from('workflow_tasks')
    .update({ status: 'DONE', end_date: today })
    .in('sales_detail_id', header.details.map(d => d.detailId));
  if (taskError) {
    console.error('confirmProductionDone(workflow_tasks)', taskError);
    throw taskError;
  }

  const { error } = await supabase.from('sales_header').update({ status: 'DONE_IN_PRODUCTION' }).eq('id', header.id);
  if (error) {
    console.error('confirmProductionDone', error);
    throw error;
  }
};
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no new errors from this file itself (a leftover error will remain about `OrdersView.tsx` importing `markProductionDone`, which no longer exists — expected here, Task 5 fixes it).

- [ ] **Step 3: Commit**

```bash
git add src/services/OrdersService.ts
git commit -m "feat: add confirmProductionDone material reconciliation"
```

---

### Task 4: `ProductionCompletionModal.tsx` — new component

**Files:**
- Create: `src/components/ProductionCompletionModal.tsx`

**Interfaces:**
- Consumes: `SalesHeader`, `Material` (`../types`); `MaterialReconciliationInput`, `LeftoverMaterialInput`, `ExtraProducedInput` (`../services/OrdersService`, Task 3); `Dialog`, `DialogFooter`, `DialogCancelButton`, `DialogSubmitButton` (`./ui`); `ComboBox` (`./ComboBox`).
- Produces:
  ```ts
  interface ProductionCompletionModalProps {
    order: SalesHeader | null;
    isOpen: boolean;
    materials: Material[];
    onClose: () => void;
    onSubmit: (
      reconciliations: MaterialReconciliationInput[],
      leftovers: LeftoverMaterialInput[],
      extraProduced: ExtraProducedInput[],
    ) => Promise<void>;
  }
  export default function ProductionCompletionModal(props: ProductionCompletionModalProps): JSX.Element | null
  ```
  Consumed by Task 5 (`OrdersView.tsx`).

- [ ] **Step 1: Create the component**

Write `src/components/ProductionCompletionModal.tsx`:
```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { SalesHeader, Material } from '../types';
import { MaterialReconciliationInput, LeftoverMaterialInput, ExtraProducedInput } from '../services/OrdersService';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton } from './ui';

interface LeftoverDraft extends LeftoverMaterialInput {
  materialName: string;
}

interface ProductionCompletionModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  materials: Material[];
  onClose: () => void;
  onSubmit: (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    extraProduced: ExtraProducedInput[],
  ) => Promise<void>;
}

export default function ProductionCompletionModal({ order, isOpen, materials, onClose, onSubmit }: ProductionCompletionModalProps) {
  const [actualQuantities, setActualQuantities] = useState<Record<string, number>>({});
  const [extraProduced, setExtraProduced] = useState<Record<string, number>>({});
  const [leftovers, setLeftovers] = useState<LeftoverDraft[]>([]);
  const [tempLeftoverDetailId, setTempLeftoverDetailId] = useState('');
  const [tempLeftoverMaterialId, setTempLeftoverMaterialId] = useState('');
  const [tempLeftoverQty, setTempLeftoverQty] = useState(1);

  // Re-stage actual quantities (defaulted to plannedQuantity) and clear
  // leftover/extra-produced drafts whenever a different order opens in the
  // dialog — without this, a previous order's edits would leak into the next.
  useEffect(() => {
    if (!isOpen || !order) return;
    const initialActuals: Record<string, number> = {};
    order.details.forEach(d => {
      d.materials.forEach(m => {
        initialActuals[m.id] = m.plannedQuantity;
      });
    });
    setActualQuantities(initialActuals);
    setExtraProduced({});
    setLeftovers([]);
    setTempLeftoverDetailId(order.details[0]?.detailId || '');
    setTempLeftoverMaterialId('');
    setTempLeftoverQty(1);
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const handleAddLeftover = () => {
    if (!tempLeftoverDetailId || !tempLeftoverMaterialId || tempLeftoverQty <= 0) return;
    const material = materials.find(m => m.id === tempLeftoverMaterialId);
    if (!material) return;

    setLeftovers([...leftovers, {
      salesDetailId: tempLeftoverDetailId,
      materialId: tempLeftoverMaterialId,
      materialName: material.name,
      quantity: tempLeftoverQty,
    }]);
    setTempLeftoverMaterialId('');
    setTempLeftoverQty(1);
  };

  const handleRemoveLeftover = (index: number) => {
    setLeftovers(leftovers.filter((_, idx) => idx !== index));
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();

    const reconciliations: MaterialReconciliationInput[] = order.details.flatMap(d =>
      d.materials.map(m => ({
        usageId: m.id,
        materialId: m.materialId,
        plannedQuantity: m.plannedQuantity,
        actualQuantity: actualQuantities[m.id] ?? m.plannedQuantity,
      }))
    );

    const leftoverInputs: LeftoverMaterialInput[] = leftovers.map(l => ({
      salesDetailId: l.salesDetailId,
      materialId: l.materialId,
      quantity: l.quantity,
    }));

    const extraProducedInputs: ExtraProducedInput[] = order.details.map(d => ({
      salesDetailId: d.detailId,
      productId: d.productId,
      quantity: extraProduced[d.detailId] || 0,
    }));

    await onSubmit(reconciliations, leftoverInputs, extraProducedInputs);
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={`Confirm Production — ${order.salesNo}`} maxWidth="max-w-3xl">
      <form onSubmit={handleConfirm} className="p-5 space-y-4 text-xs">
        {/* Planned Materials */}
        <div className="border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
          <span className="font-semibold block text-slate-700 text-xs">Planned Materials</span>
          {order.details.map(detail => (
            <div key={detail.detailId} className="space-y-1.5">
              <span className="font-semibold text-slate-600 text-[11px]">{detail.productName}</span>
              {detail.materials.length === 0 ? (
                <div className="text-[10px] text-slate-400 italic pl-2">No planned materials for this line.</div>
              ) : (
                detail.materials.map(m => (
                  <div key={m.id} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1.5">
                    <span className="text-slate-700">{m.materialName} — planned {m.plannedQuantity}</span>
                    <input
                      type="number"
                      min="0"
                      value={actualQuantities[m.id] ?? m.plannedQuantity}
                      onChange={(e) => setActualQuantities({ ...actualQuantities, [m.id]: Number(e.target.value) })}
                      className="w-24 px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                    />
                  </div>
                ))
              )}
            </div>
          ))}
        </div>

        {/* Leftover / by-product items */}
        <div className="border border-emerald-100 rounded-lg p-3 bg-emerald-50/20 space-y-2">
          <span className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Leftover Items Returned to Inventory ({leftovers.length})</span>
          {leftovers.length > 0 && (
            <div className="space-y-1">
              {leftovers.map((l, idx) => (
                <div key={idx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1">
                  <span className="text-[10px] text-slate-700">{l.materialName} — qty {l.quantity}</span>
                  <button type="button" onClick={() => handleRemoveLeftover(idx)} className="text-red-500 hover:text-red-700 p-0.5" title="Remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            {order.details.length > 1 && (
              <div className="sm:col-span-4">
                <ComboBox
                  value={tempLeftoverDetailId}
                  onChange={setTempLeftoverDetailId}
                  noneLabel="-- Product Line --"
                  options={order.details.map(d => ({ value: d.detailId, label: d.productName }))}
                />
              </div>
            )}
            <div className={order.details.length > 1 ? 'sm:col-span-5' : 'sm:col-span-7'}>
              <ComboBox
                value={tempLeftoverMaterialId}
                onChange={setTempLeftoverMaterialId}
                noneLabel="-- Choose Material --"
                options={materials.map(m => ({ value: m.id, label: m.name, sublabel: m.code }))}
              />
            </div>
            <div className="sm:col-span-2">
              <input
                type="number"
                min="1"
                value={tempLeftoverQty}
                onChange={(e) => setTempLeftoverQty(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
              />
            </div>
            <div className="sm:col-span-1">
              <button type="button" onClick={handleAddLeftover} className="w-full px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-[10px]">
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Extra produced quantity */}
        <div className="border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
          <span className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Extra Produced (beyond ordered quantity)</span>
          {order.details.map(detail => (
            <div key={detail.detailId} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1.5">
              <span className="text-slate-700">{detail.productName} <span className="text-slate-400 font-mono text-[10px]">(ordered {detail.quantity})</span></span>
              <input
                type="number"
                min="0"
                value={extraProduced[detail.detailId] || 0}
                onChange={(e) => setExtraProduced({ ...extraProduced, [detail.detailId]: Number(e.target.value) })}
                className="w-24 px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton>Confirm Production Done</DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no errors from this new file (it isn't imported anywhere yet, so it won't be reached by other files' errors, but `tsc` still checks the whole project — its own types must be internally consistent).

- [ ] **Step 3: Commit**

```bash
git add src/components/ProductionCompletionModal.tsx
git commit -m "feat: add ProductionCompletionModal for production-done material reconciliation"
```

---

### Task 5: `OrdersView.tsx` — wire Start Production and the completion modal

**Files:**
- Modify: `src/components/OrdersView.tsx:1-24` (imports)
- Modify: `src/components/OrdersView.tsx:306-349` (`handleStartProduction`, `handleMarkProductionDone`)
- Modify: `src/components/OrdersView.tsx:758-765` (Start Production button)
- Modify: `src/components/OrdersView.tsx:777-784` (Mark Production Done button)
- Modify: `src/components/OrdersView.tsx:837-853` (modal render block)

**Interfaces:**
- Consumes: `startProduction(header: SalesHeader)`, `confirmProductionDone(header, reconciliations, leftovers, extraProduced)`, `MaterialReconciliationInput`, `LeftoverMaterialInput`, `ExtraProducedInput` (Tasks 2/3); `ProductionCompletionModal` (Task 4).

- [ ] **Step 1: Update imports**

In `src/components/OrdersView.tsx`, find:
```ts
import {
  getSalesOrders, createSalesQuotation, updateSalesOrder, convertToSalesOrder,
  startProduction, markProductionDone, markDelivered, cancelSalesOrder, deleteSalesOrder,
  SalesDetailInput, MaterialUsageInput,
} from '../services/OrdersService';
```
Replace with:
```ts
import {
  getSalesOrders, createSalesQuotation, updateSalesOrder, convertToSalesOrder,
  startProduction, confirmProductionDone, markDelivered, cancelSalesOrder, deleteSalesOrder,
  SalesDetailInput, MaterialUsageInput, MaterialReconciliationInput, LeftoverMaterialInput, ExtraProducedInput,
} from '../services/OrdersService';
```

And find:
```ts
import SalesQuotationModal from './SalesQuotationModal';
import InvoiceModal from './InvoiceModal';
```
Replace with:
```ts
import SalesQuotationModal from './SalesQuotationModal';
import InvoiceModal from './InvoiceModal';
import ProductionCompletionModal from './ProductionCompletionModal';
```

- [ ] **Step 2: Add `completingOrder` state**

In `src/components/OrdersView.tsx`, find:
```ts
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
```
Replace with:
```ts
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [completingOrder, setCompletingOrder] = useState<SalesHeader | null>(null);
```

- [ ] **Step 3: Change `handleStartProduction` to take the full order, and replace `handleMarkProductionDone` with an "open modal" handler plus a submit handler**

In `src/components/OrdersView.tsx`, find:
```ts
  const handleStartProduction = async (id: string) => {
    if (transitioningId === id) return;
    setTransitioningId(id);
    await CallAPI(() => startProduction(id), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
      },
    });
  };

  const handleMarkProductionDone = async (id: string) => {
    if (transitioningId === id) return;
    setTransitioningId(id);
    await CallAPI(() => markProductionDone(id), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
      },
    });
  };
```
Replace with:
```ts
  const handleStartProduction = async (order: SalesHeader) => {
    if (transitioningId === order.id) return;
    setTransitioningId(order.id);
    await CallAPI(() => startProduction(order), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
      },
    });
  };

  const openProductionCompletion = (order: SalesHeader) => {
    setCompletingOrder(order);
  };

  const handleConfirmProductionDone = async (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    extraProduced: ExtraProducedInput[],
  ) => {
    if (!completingOrder) return;
    setTransitioningId(completingOrder.id);
    await CallAPI(() => confirmProductionDone(completingOrder, reconciliations, leftovers, extraProduced), {
      onCompleted: () => {
        setTransitioningId(null);
        setCompletingOrder(null);
        loadOrders(activeTab);
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
      },
    });
  };
```

- [ ] **Step 4: Update the Start Production button's `onClick`**

In `src/components/OrdersView.tsx`, find:
```tsx
                            <button
                              onClick={() => handleStartProduction(order.id)}
                              disabled={transitioningId === order.id}
                              title="Proceed to production"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Factory className="w-3.5 h-3.5" />
                            </button>
```
Replace with:
```tsx
                            <button
                              onClick={() => handleStartProduction(order)}
                              disabled={transitioningId === order.id}
                              title="Proceed to production"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Factory className="w-3.5 h-3.5" />
                            </button>
```

- [ ] **Step 5: Update the Mark Production Done button's `onClick`**

In `src/components/OrdersView.tsx`, find:
```tsx
                            <button
                              onClick={() => handleMarkProductionDone(order.id)}
                              disabled={transitioningId === order.id}
                              title="Mark production as done"
                              className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                            </button>
```
Replace with:
```tsx
                            <button
                              onClick={() => openProductionCompletion(order)}
                              disabled={transitioningId === order.id}
                              title="Mark production as done"
                              className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                            </button>
```

- [ ] **Step 6: Render `ProductionCompletionModal`**

In `src/components/OrdersView.tsx`, find:
```tsx
      {/* Tax invoice print modal */}
      <InvoiceModal
        order={selectedInvoiceOrder}
        isOpen={isInvoiceOpen}
        onClose={() => {
          setIsInvoiceOpen(false);
          setSelectedInvoiceOrder(null);
        }}
      />

    </div>
  );
}
```
Replace with:
```tsx
      {/* Tax invoice print modal */}
      <InvoiceModal
        order={selectedInvoiceOrder}
        isOpen={isInvoiceOpen}
        onClose={() => {
          setIsInvoiceOpen(false);
          setSelectedInvoiceOrder(null);
        }}
      />

      {/* Production-done material reconciliation modal */}
      <ProductionCompletionModal
        order={completingOrder}
        isOpen={!!completingOrder}
        materials={rawMaterials}
        onClose={() => setCompletingOrder(null)}
        onSubmit={handleConfirmProductionDone}
      />

    </div>
  );
}
```

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: PASS with no errors. If `markProductionDone` still appears anywhere (e.g. another import), remove it — it no longer exists in `OrdersService.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/components/OrdersView.tsx
git commit -m "feat: wire Start Production reservation and production-done reconciliation modal"
```

- [ ] **Step 9: Manual QA checklist (for the user to run — do not self-test)**

Hand off to the user to verify in the running app:
1. Create a sales quotation with at least one product line that has planned materials, proceed it to a Sales Order.
2. Click "Proceed to production" — confirm: `sales_header.status` becomes `IN_PRODUCTION`; a `workflow_tasks` row now exists per `sales_detail` line (`status='IN_PRODUCTION'`); each planned material's `material.quantity` decreased by its `planned_quantity`, and an `inventory_transaction` row was created for each (`SALES`, negative quantity).
3. Click "Mark production as done" — confirm the `ProductionCompletionModal` opens prefilled with each material's planned quantity as "Actual Used".
4. Change one material's actual quantity below planned, add a leftover item (different material) with some quantity, optionally set an extra-produced quantity on a product line, then confirm.
5. Confirm: `sales_header.status` becomes `DONE_IN_PRODUCTION`; the `workflow_tasks` rows for this order are `status='DONE'`; the reconciled material's stock increased by the planned-minus-actual difference; the leftover material's stock increased by its entered quantity; the product's stock increased by the extra-produced quantity (if any); a `Mark as delivered` button now shows in place of the completed actions.

---

---

### Task 6: `cancelSalesOrder` reverses the production reservation

**Added after the final whole-branch review of Tasks 1-5 found that cancelling an `IN_PRODUCTION` order left its reserved material stock permanently deducted and its `workflow_tasks` rows permanently open** — `Start Production` (Task 2) gave stock movement and task-tracking side effects to entering `IN_PRODUCTION`, but `cancelSalesOrder` (pre-existing, unchanged by Tasks 1-5) still only flipped `status`. This task makes Cancel symmetric with Start Production for orders that have already reserved stock.

**Files:**
- Modify: `src/services/OrdersService.ts` (`cancelSalesOrder`)
- Modify: `src/components/OrdersView.tsx` (`handleCancel` and its two call sites)

**Interfaces:**
- Consumes: `saveInventoryTransaction`, `SalesHeader` (already imported/available in `OrdersService.ts`).
- Produces: `cancelSalesOrder(header: SalesHeader): Promise<void>` — signature changed from `(headerId: string)`. Consumed by `OrdersView.tsx`'s `handleCancel`.

- [ ] **Step 1: Rewrite `cancelSalesOrder` to reverse the reservation when cancelling from `IN_PRODUCTION`**

In `src/services/OrdersService.ts`, find:
```ts
export const cancelSalesOrder = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('sales_header').update({ status: 'CANCELLED' }).eq('id', headerId);
  if (error) {
    console.error('cancelSalesOrder', error);
    throw error;
  }
};
```
Replace with:
```ts
// If the order already reserved material stock (Start Production ran), a
// cancel from IN_PRODUCTION must return that stock and close the order's
// workflow_tasks rows — symmetric with what startProduction reserved/opened.
// Cancelling from ORDERED (before any reservation) is still a plain status flip.
export const cancelSalesOrder = async (header: SalesHeader): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  if (header.status === 'IN_PRODUCTION') {
    for (const detail of header.details) {
      for (const material of detail.materials) {
        await saveInventoryTransaction({
          id: generateId(),
          transactionType: 'SALES_RETURN',
          quantity: material.plannedQuantity,
          remark: header.salesNo,
          materialId: material.materialId,
          productionMaterialUsageId: material.id,
          transactionDate: today,
        });
      }
    }

    const { error: taskError } = await supabase
      .from('workflow_tasks')
      .update({ status: 'CANCELLED', end_date: today })
      .in('sales_detail_id', header.details.map(d => d.detailId));
    if (taskError) {
      console.error('cancelSalesOrder(workflow_tasks)', taskError);
      throw taskError;
    }
  }

  const { error } = await supabase.from('sales_header').update({ status: 'CANCELLED' }).eq('id', header.id);
  if (error) {
    console.error('cancelSalesOrder', error);
    throw error;
  }
};
```

- [ ] **Step 2: Update `handleCancel` in `OrdersView.tsx` to pass the full order**

In `src/components/OrdersView.tsx`, find:
```ts
  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this Sales Order?')) return;
    await CallAPI(() => cancelSalesOrder(id), {
      onCompleted: () => loadOrders(activeTab),
      onError: console.error,
    });
  };
```
Replace with:
```ts
  const handleCancel = async (order: SalesHeader) => {
    if (!confirm('Cancel this Sales Order?')) return;
    await CallAPI(() => cancelSalesOrder(order), {
      onCompleted: () => loadOrders(activeTab),
      onError: console.error,
    });
  };
```

Then find the two Cancel button call sites (one in the `ORDERED` action block, one in the `IN_PRODUCTION` action block) — both currently:
```tsx
                            <button onClick={() => handleCancel(order.id)} className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors text-[10px] font-medium">
                              Cancel
                            </button>
```
Replace **both occurrences** with:
```tsx
                            <button onClick={() => handleCancel(order)} className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors text-[10px] font-medium">
                              Cancel
                            </button>
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: PASS with no errors.

- [ ] **Step 4: Manual QA note (for the user)**

Add to the manual QA checklist: cancel an order that's `IN_PRODUCTION` (after Start Production ran) and confirm the reserved material's stock returns to its pre-reservation level, and its `workflow_tasks` rows show `status='CANCELLED'`. Also confirm cancelling an `ORDERED` order (before Start Production) still works as a plain status flip with no stock movement.

## Task Summary

1. Types — `productionMaterialUsageId` + material actual/returned quantity fields.
2. `OrdersService.ts` — `startProduction` reserves stock and opens workflow tasks.
3. `OrdersService.ts` — `confirmProductionDone` reconciles usage, leftovers, and extra yield.
4. `ProductionCompletionModal.tsx` — new reconciliation dialog.
5. `OrdersView.tsx` — wire both buttons to the new service functions and modal.
6. `cancelSalesOrder` reverses the production reservation when cancelling an `IN_PRODUCTION` order (added after final review).

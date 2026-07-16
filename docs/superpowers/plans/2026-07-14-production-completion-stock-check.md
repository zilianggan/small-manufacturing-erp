# Production Completion Stock Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At Confirm Production Done, show which material is short *before* the user submits, instead of only finding out after the RPC throws over the network.

**Architecture:** New read-only service function `checkProductionCompletionStock()` (mirrors the existing `checkProductionStock()` used by Start Production) computes shortfalls for the two draws that can actually run stock negative at completion — over-planned reconciliation and AUTOMATIC consumables. `ProductionCompletionModal.tsx` gets the same two-step Check → Confirm gate `StartProductionModal.tsx` already has. `OrdersView.tsx` wires the two together.

**Tech Stack:** React 19 + TypeScript, Supabase JS client. No test runner in this repo (`npm run lint` = `tsc --noEmit` is the only automated check) — verification is manual, via `docs/test-cases.md`, per this project's existing convention.

## Global Constraints

- No schema or RPC change. `apply_material_consumption()` / `apply_production_completion()` stay the authoritative, final guard — this is a non-authoritative, earlier warning only.
- No new dependencies. Reuse `MaterialShortfall` (already defined in `OrdersService.ts`) — do not add a new type.
- Follow the existing Start Production pattern exactly (`checkProductionStock()`, `StartProductionModal.tsx`'s `checkedFor`/`isChecked`/`blocked` gate) rather than inventing new UI conventions.
- Do not launch the dev server or drive a browser yourself — the user tests manually.

---

### Task 1: `checkProductionCompletionStock()` in `OrdersService.ts`

**Files:**
- Modify: `src/services/OrdersService.ts:639-643` (insert after the `ProducedLine` interface, before the `confirmProductionDone` comment block)

**Interfaces:**
- Consumes: `SalesHeader`, `ProductionMaterialUsage` (both already imported at the top of the file), `MaterialReconciliationInput` (defined at `OrdersService.ts:626`), `MaterialShortfall` (defined at `OrdersService.ts:328`, fields `materialId: string`, `materialName: string`, `required: number`, `available: number`), `supabase` client (already imported).
- Produces: `export const checkProductionCompletionStock = (header: SalesHeader, reconciliations: MaterialReconciliationInput[]) => Promise<MaterialShortfall[]>` — used by Task 3.

- [ ] **Step 1: Add the function**

Edit `src/services/OrdersService.ts`. Find:

```ts
export interface ProducedLine {
  detailId: string;
  quantity: number;
}

// The whole "Mark Production Done" action in one transaction via apply_production_completion
```

Replace with:

```ts
export interface ProducedLine {
  detailId: string;
  quantity: number;
}

// Pre-flight for Confirm Production Done, mirroring checkProductionStock (Start Production's stock
// gate). Front-runs the same guard apply_material_consumption enforces server-side: a reconciliation
// that uses MORE than the Start Production reservation draws the diff from live stock, and AUTOMATIC
// consumables (fixed earlier by addOrderConsumable, never reserved) draw their full actual_quantity.
// Everything else — actual <= planned, leftovers, MANUAL consumables — never touches live stock and
// is excluded.
export const checkProductionCompletionStock = async (
  header: SalesHeader,
  reconciliations: MaterialReconciliationInput[],
): Promise<MaterialShortfall[]> => {
  const usageById = new Map<string, ProductionMaterialUsage>(
    header.details.flatMap(d => d.materials.map(m => [m.id, m] as const))
  );
  const required = new Map<string, number>();

  for (const r of reconciliations) {
    const usage = usageById.get(r.usageId);
    if (!usage) continue;
    const extra = r.actualQuantity - usage.plannedQuantity;
    if (extra > 0) required.set(usage.materialId, (required.get(usage.materialId) || 0) + extra);
  }

  for (const usage of usageById.values()) {
    if (usage.materialType === 'CONSUMABLE_MATERIAL' && usage.consumptionMode === 'AUTOMATIC' && usage.actualQuantity > 0) {
      required.set(usage.materialId, (required.get(usage.materialId) || 0) + usage.actualQuantity);
    }
  }

  const materialIds = Array.from(required.keys());
  if (materialIds.length === 0) return [];

  const { data, error } = await supabase.from('material').select('id, name, quantity').in('id', materialIds);
  if (error) {
    console.error('checkProductionCompletionStock', error);
    throw error;
  }

  const shortfalls: MaterialShortfall[] = [];
  required.forEach((requiredQty, materialId) => {
    const row = (data || []).find((m: any) => m.id === materialId);
    const available = Number(row?.quantity) || 0;
    if (available < requiredQty) {
      shortfalls.push({ materialId, materialName: row?.name || materialId, required: requiredQty, available });
    }
  });
  return shortfalls;
};

// The whole "Mark Production Done" action in one transaction via apply_production_completion
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: exits with no errors (this project has no automated test runner — `tsc --noEmit` is the full check).

- [ ] **Step 3: Commit**

```bash
git add src/services/OrdersService.ts
git commit -m "feat: add stock pre-check for production completion"
```

---

### Task 2: Two-step gate in `ProductionCompletionModal.tsx`

**Files:**
- Modify: `src/components/ProductionCompletionModal.tsx` (whole file is ~239 lines; edits below are targeted)

**Interfaces:**
- Consumes: `checkProductionCompletionStock`'s signature via the new `onCheck` prop (parent supplies the implementation in Task 3); `MaterialShortfall` type from `../services/OrdersService`.
- Produces: `ProductionCompletionModalProps` gains `shortfalls: MaterialShortfall[]` and `onCheck: (reconciliations: MaterialReconciliationInput[]) => Promise<void>` — Task 3's JSX must supply both.

- [ ] **Step 1: Import `MaterialShortfall` and `AlertTriangle`**

Find:

```tsx
import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { SalesHeader, Material } from '../types';
import { MaterialReconciliationInput, LeftoverMaterialInput, ProducedLine } from '../services/OrdersService';
```

Replace with:

```tsx
import React, { useEffect, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { SalesHeader, Material } from '../types';
import { MaterialReconciliationInput, LeftoverMaterialInput, ProducedLine, MaterialShortfall } from '../services/OrdersService';
```

- [ ] **Step 2: Add `shortfalls`/`onCheck` props, `submitting`/`checkedFor` state**

Find:

```tsx
interface ProductionCompletionModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  materials: Material[];
  onClose: () => void;
  onSubmit: (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    produced: ProducedLine[],
  ) => Promise<void>;
}

export default function ProductionCompletionModal({ order, isOpen, materials, onClose, onSubmit }: ProductionCompletionModalProps) {
  const [actualQuantities, setActualQuantities] = useState<Record<string, number>>({});
  const [actualProduced, setActualProduced] = useState<Record<string, number>>({});
  const [leftovers, setLeftovers] = useState<LeftoverDraft[]>([]);
  const [tempLeftoverDetailId, setTempLeftoverDetailId] = useState('');
  const [tempLeftoverMaterialId, setTempLeftoverMaterialId] = useState('');
  const [tempLeftoverQty, setTempLeftoverQty] = useState(1);
```

Replace with:

```tsx
interface ProductionCompletionModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  materials: Material[];
  shortfalls: MaterialShortfall[];
  onClose: () => void;
  onCheck: (reconciliations: MaterialReconciliationInput[]) => Promise<void>;
  onSubmit: (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    produced: ProducedLine[],
  ) => Promise<void>;
}

export default function ProductionCompletionModal({ order, isOpen, materials, shortfalls, onClose, onCheck, onSubmit }: ProductionCompletionModalProps) {
  const [actualQuantities, setActualQuantities] = useState<Record<string, number>>({});
  const [actualProduced, setActualProduced] = useState<Record<string, number>>({});
  const [leftovers, setLeftovers] = useState<LeftoverDraft[]>([]);
  const [tempLeftoverDetailId, setTempLeftoverDetailId] = useState('');
  const [tempLeftoverMaterialId, setTempLeftoverMaterialId] = useState('');
  const [tempLeftoverQty, setTempLeftoverQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  // Shortfalls are only meaningful for the actual quantities they were computed from, so any edit to
  // them invalidates the check — same pattern as StartProductionModal.
  const [checkedFor, setCheckedFor] = useState('');
```

- [ ] **Step 3: Reset the new state when a different order opens**

Find:

```tsx
    setActualQuantities(initialActuals);
    setActualProduced(initialProduced);
    setLeftovers([]);
    setTempLeftoverDetailId(order.details[0]?.detailId || '');
    setTempLeftoverMaterialId('');
    setTempLeftoverQty(1);
  }, [isOpen, order]);
```

Replace with:

```tsx
    setActualQuantities(initialActuals);
    setActualProduced(initialProduced);
    setLeftovers([]);
    setTempLeftoverDetailId(order.details[0]?.detailId || '');
    setTempLeftoverMaterialId('');
    setTempLeftoverQty(1);
    setCheckedFor('');
    setSubmitting(false);
  }, [isOpen, order]);
```

- [ ] **Step 4: Replace `handleConfirm` with the two-step version**

Find:

```tsx
  const handleLeftoverQtyChange = (index: number, quantity: number) => {
    setLeftovers(leftovers.map((l, idx) => idx === index ? { ...l, quantity } : l));
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();

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

    await onSubmit(reconciliations, leftoverInputs, producedInputs);
  };
```

Replace with:

```tsx
  const handleLeftoverQtyChange = (index: number, quantity: number) => {
    setLeftovers(leftovers.map((l, idx) => idx === index ? { ...l, quantity } : l));
  };

  const handleQuantityChange = (materialUsageId: string, quantity: number) => {
    setActualQuantities({ ...actualQuantities, [materialUsageId]: quantity });
    setCheckedFor('');
  };

  const buildReconciliations = (): MaterialReconciliationInput[] =>
    order.details.flatMap(d =>
      d.materials.filter(isPlanned).map(m => ({
        usageId: m.id,
        actualQuantity: actualQuantities[m.id] ?? m.plannedQuantity,
      }))
    );

  const currentKey = JSON.stringify(actualQuantities);
  const isChecked = checkedFor === currentKey;
  const blocked = shortfalls.length > 0;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Two-step, same as Start Production: the shortfall check is only meaningful for the actual
    // quantities entered, so it must be (re-)run and shown clean before the RPC — which applies the
    // same guard server-side — can be trusted to succeed.
    if (!isChecked) {
      setSubmitting(true);
      try {
        await onCheck(buildReconciliations());
        setCheckedFor(currentKey);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (blocked) return;

    const leftoverInputs: LeftoverMaterialInput[] = leftovers.map(l => ({
      salesDetailId: l.salesDetailId,
      materialId: l.materialId,
      quantity: l.quantity,
    }));

    const producedInputs: ProducedLine[] = order.details.map(d => ({
      detailId: d.detailId,
      quantity: actualProduced[d.detailId] ?? d.produceQuantity,
    }));

    setSubmitting(true);
    try {
      await onSubmit(buildReconciliations(), leftoverInputs, producedInputs);
    } finally {
      setSubmitting(false);
    }
  };
```

- [ ] **Step 5: Route the actual-quantity input through `handleQuantityChange`**

Find (inside the Planned Materials section):

```tsx
                    <input
                      type="number"
                      min="0"
                      value={actualQuantities[m.id] ?? m.plannedQuantity}
                      onChange={(e) => setActualQuantities({ ...actualQuantities, [m.id]: Number(e.target.value) })}
                      className="w-24 px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                    />
```

Replace with:

```tsx
                    <input
                      type="number"
                      min="0"
                      value={actualQuantities[m.id] ?? m.plannedQuantity}
                      onChange={(e) => handleQuantityChange(m.id, Number(e.target.value))}
                      className="w-24 px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                    />
```

- [ ] **Step 6: Add the shortfall/success boxes and flip the submit button**

Find (end of the file):

```tsx
        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton>Confirm Production Done</DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

Replace with:

```tsx
        {isChecked && blocked && (
          <div className="border border-red-200 bg-red-50/60 rounded-lg p-3 space-y-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-red-700 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5" /> Insufficient material — production completion is blocked
            </span>
            {shortfalls.map(s => (
              <div key={s.materialId} className="flex justify-between text-[11px] text-red-700">
                <span>{s.materialName}</span>
                <span className="font-mono">need {s.required}, have {s.available} (short {Math.round((s.required - s.available) * 100) / 100})</span>
              </div>
            ))}
            <p className="text-[10px] text-red-600/80 pt-0.5">
              Lower the actual quantity or top up stock (purchase/adjustment), then check again.
            </p>
          </div>
        )}

        {isChecked && !blocked && (
          <div className="border border-emerald-200 bg-emerald-50/60 rounded-lg px-3 py-2 text-[11px] text-emerald-700">
            Material is sufficient.
          </div>
        )}

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton disabled={submitting || (isChecked && blocked)}>
            {submitting ? 'Working...' : isChecked ? 'Confirm Production Done' : 'Check Material'}
          </DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: exits with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/ProductionCompletionModal.tsx
git commit -m "feat: gate production completion behind a material check"
```

---

### Task 3: Wire it up in `OrdersView.tsx`

**Files:**
- Modify: `src/components/OrdersView.tsx:9` (import), `:181` (state), `:830-832` (open handler), `:1472-1478` (JSX)

**Interfaces:**
- Consumes: `checkProductionCompletionStock` (Task 1), `ProductionCompletionModal`'s new `shortfalls`/`onCheck` props (Task 2).
- Produces: nothing further downstream — this is the top of the call chain for this feature.

- [ ] **Step 1: Import the new service function**

Find:

```tsx
  startProduction, checkProductionStock, confirmProductionDone, markDelivered, cancelSalesOrder, deleteSalesOrder,
```

Replace with:

```tsx
  startProduction, checkProductionStock, checkProductionCompletionStock, confirmProductionDone, markDelivered, cancelSalesOrder, deleteSalesOrder,
```

- [ ] **Step 2: Add `completionShortfalls` state**

Find:

```tsx
  const [productionShortfalls, setProductionShortfalls] = useState<MaterialShortfall[]>([]);
```

Replace with:

```tsx
  const [productionShortfalls, setProductionShortfalls] = useState<MaterialShortfall[]>([]);
  const [completionShortfalls, setCompletionShortfalls] = useState<MaterialShortfall[]>([]);
```

- [ ] **Step 3: Reset shortfalls on open, add the check handler**

Find:

```tsx
  const openProductionCompletion = (order: SalesHeader) => {
    setCompletingOrder(order);
  };

  const handleConfirmProductionDone = async (
```

Replace with:

```tsx
  const openProductionCompletion = (order: SalesHeader) => {
    setCompletionShortfalls([]);
    setCompletingOrder(order);
  };

  const handleCheckProductionCompletion = async (reconciliations: MaterialReconciliationInput[]) => {
    if (!completingOrder) return;
    const shortfalls = await CallAPI(() => checkProductionCompletionStock(completingOrder, reconciliations), {
      onError: (err) => { console.error(err); toast.error('Failed to check material stock.'); },
    });
    setCompletionShortfalls(shortfalls ?? []);
  };

  const handleConfirmProductionDone = async (
```

- [ ] **Step 4: Pass the new props into `ProductionCompletionModal`**

Find:

```tsx
      {/* Production-done: actual produced (credits finished goods) + material reconciliation */}
      <ProductionCompletionModal
        order={completingOrder}
        isOpen={!!completingOrder}
        materials={rawMaterials}
        onClose={() => setCompletingOrder(null)}
        onSubmit={handleConfirmProductionDone}
      />
```

Replace with:

```tsx
      {/* Production-done: actual produced (credits finished goods) + material reconciliation, gated
          by the same Check-then-Confirm stock check as Start Production */}
      <ProductionCompletionModal
        order={completingOrder}
        isOpen={!!completingOrder}
        materials={rawMaterials}
        shortfalls={completionShortfalls}
        onClose={() => { setCompletingOrder(null); setCompletionShortfalls([]); }}
        onCheck={handleCheckProductionCompletion}
        onSubmit={handleConfirmProductionDone}
      />
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: exits with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/OrdersView.tsx
git commit -m "feat: wire material check into production completion modal"
```

---

### Task 4: Docs — `flows.md` and `test-cases.md`

**Files:**
- Modify: `docs/flows.md:205-206` (Sales flow table)
- Modify: `docs/test-cases.md:82` (Sales test cases)

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing (docs only) — this task has no downstream dependents.

- [ ] **Step 1: Add the stock-gate row to `flows.md`**

Find:

```
| Add consumable | `addOrderConsumable()` | `production_material_usage` row (`actual_quantity` set, planned 0) | **none at this point** |
| Confirm Done | `confirmProductionDone(header, recon, leftovers, produced)` | single call to `apply_production_completion()` (Postgres RPC, `function_trigger.sql`) — see below | several, including **product +actual produced** — see below |
```

Replace with:

```
| Add consumable | `addOrderConsumable()` | `production_material_usage` row (`actual_quantity` set, planned 0) | **none at this point** |
| Stock gate (completion) | `checkProductionCompletionStock(header, reconciliations)` | read-only | returns shortfalls for reconciliation rows using MORE than the Start Production reservation, plus AUTOMATIC consumables' fixed `actual_quantity`; **blocks** Confirm Production Done. Mirrors the Start Production stock gate above — front-runs the same guard `apply_material_consumption()` enforces server-side, instead of surfacing it only after the RPC throws |
| Confirm Done | `confirmProductionDone(header, recon, leftovers, produced)` | single call to `apply_production_completion()` (Postgres RPC, `function_trigger.sql`) — see below | several, including **product +actual produced** — see below |
```

- [ ] **Step 2: Add test cases to `test-cases.md`**

Find:

```
| TC-S-31 | Delete gating is `QUOTATION`-only | Check the action menu on a `QUOTATION`, an `ORDERED`, a `CANCELLED` (cancelled from `ORDERED`), and a `CANCELLED` (cancelled from `IN_PRODUCTION`). | **Delete** offered only on `QUOTATION`. Every other status — including both `Cancelled` orders, regardless of ledger history — shows no Delete button; a Sales Order is a business document from `ORDERED` onward and stays on record forever. `flows.md` known gaps #1/#4 (fixed). |

---
```

Replace with:

```
| TC-S-31 | Delete gating is `QUOTATION`-only | Check the action menu on a `QUOTATION`, an `ORDERED`, a `CANCELLED` (cancelled from `ORDERED`), and a `CANCELLED` (cancelled from `IN_PRODUCTION`). | **Delete** offered only on `QUOTATION`. Every other status — including both `Cancelled` orders, regardless of ledger history — shows no Delete button; a Sales Order is a business document from `ORDERED` onward and stays on record forever. `flows.md` known gaps #1/#4 (fixed). |
| TC-S-32 | **Complete — stock gate blocks over-usage before submit** | On the TC-S-10 order (`M1` reserved 40, `M1` = 60 on hand) → Mark Production Done. Set Actual `M1` = 200. Click Check Material. | Shortfall listed (need 160, have 60) in red, **Confirm Production Done stays disabled** — button still reads "Check Material". No RPC call made: status stays `IN_PRODUCTION`, `M1` unchanged. Editing Actual `M1` back down clears the check (button reverts to "Check Material"); entering a value with enough stock and re-checking shows the green "Material is sufficient" bar and unlocks Confirm. |
| TC-S-33 | **Complete — stock gate blocks a short AUTOMATIC consumable** | Add consumable `M2` (AUTOMATIC) × 100 to an order where `M2` = 50 on hand, then Mark Production Done → Check Material. | Shortfall listed for `M2` (need 100, have 50) — the consumable's fixed `actual_quantity` from Add Consumable, not something typed in this modal. `M3` (MANUAL) at any quantity never appears here — MANUAL consumables don't draw stock. |

---
```

- [ ] **Step 3: Commit**

```bash
git add docs/flows.md docs/test-cases.md
git commit -m "docs: document the production completion stock check"
```

---

### Task 5: Manual verification (user-run)

No automated test runner exists in this repo. After Tasks 1-4 are committed, the user runs `npm run dev`, opens a sales order already `IN_PRODUCTION` (or creates/starts one), and walks through **TC-S-32** and **TC-S-33** from `docs/test-cases.md` by hand:

- [ ] **Step 1: Confirm TC-S-32** (over-usage shortfall blocks, editing re-arms the check, a clean check unlocks Confirm)
- [ ] **Step 2: Confirm TC-S-33** (short AUTOMATIC consumable is caught; MANUAL consumables are never checked)
- [ ] **Step 3: Confirm the happy path still works** — an order with sufficient stock: Check Material shows the green bar, Confirm Production Done submits and reaches `DONE_IN_PRODUCTION` exactly as before this change (TC-S-13/14/15 still hold)

No commit for this task — it's verification only, done by the user per their standing preference (no self-testing/dev-server-launching by the assistant).

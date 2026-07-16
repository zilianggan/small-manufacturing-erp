# Production Completion — Pre-flight Stock Check

## Problem

At Confirm Production Done, insufficient material is only discovered when the RPC
(`apply_production_completion` → `apply_material_consumption`) throws after the network round trip.
User has no visibility into which material is short until the submit fails.

This affects two paths inside `apply_production_completion`, both routed through
`apply_material_consumption` (which throws on insufficient stock):

1. Reconciliation where `actual_quantity > planned_quantity` (used more than the Start Production
   reservation) — the diff draws down live `material.quantity`.
2. `AUTOMATIC` consumables (`materialType = CONSUMABLE_MATERIAL`, `consumptionMode = AUTOMATIC`) —
   their `actual_quantity`, fixed earlier by `addOrderConsumable()` on the Kanban, draws down live
   `material.quantity` in full (never reserved at Start Production).

`MANUAL` consumables and any reconciliation row with `actual ≤ planned` don't draw stock (they're
history-only or a safe return) and are out of scope.

## Design

Mirrors the existing Start Production pre-flight check (`checkProductionStock()` /
`StartProductionModal.tsx`'s two-step Check → Confirm gate) rather than inventing a new pattern.

### `OrdersService.ts` — `checkProductionCompletionStock()`

```ts
checkProductionCompletionStock(order: SalesHeader, reconciliations: MaterialReconciliationInput[]): Promise<MaterialShortfall[]>
```

- Build a per-material required map:
  - For each reconciliation input: look up the matching `production_material_usage` row (by
    `usageId`) off `order.details[].materials` for its `plannedQuantity` and `materialId`. If
    `actualQuantity > plannedQuantity`, add `actualQuantity - plannedQuantity` to
    `required[materialId]`.
  - For each `order.details[].materials` row where `materialType === 'CONSUMABLE_MATERIAL' &&
    consumptionMode === 'AUTOMATIC' && actualQuantity > 0`, add `actualQuantity` to
    `required[materialId]`.
- Query `material` table (`id, name, quantity`) for the ids in the map (skip the query if the map is
  empty, matching `checkProductionStock`'s early return).
- Return `MaterialShortfall[]` (existing type, reused as-is) for every material where
  `available < required`.

No new types. No RPC/schema change — this only front-runs a check the server already enforces;
`apply_material_consumption` stays the real, authoritative gate.

### `ProductionCompletionModal.tsx`

Add the same two-step gate `StartProductionModal.tsx` already uses:

- New props: `shortfalls: MaterialShortfall[]`, `onCheck: (reconciliations: MaterialReconciliationInput[]) => Promise<void>`.
  `onSubmit` stays as-is for the final confirm.
- New state: `checkedFor: string` (JSON of `actualQuantities`, mirroring `StartProductionModal`).
  Any edit to an actual-material-quantity input clears it. Edits to `actualProduced` or leftovers do
  **not** clear it — they don't affect material stock.
- Submit button: `isChecked = checkedFor === JSON.stringify(actualQuantities)`.
  - Not checked yet → button reads "Check Material", `handleConfirm` calls `onCheck(reconciliations)`
    and sets `checkedFor` instead of submitting.
  - Checked and `shortfalls.length > 0` → red box (same styling as `StartProductionModal`'s: header
    "Insufficient material — production completion is blocked", one line per shortfall
    `need X, have Y (short Z)`), submit disabled.
  - Checked and clean → green "Material is sufficient" bar, button reads "Confirm Production Done",
    submits for real.

### `OrdersView.tsx`

Same wiring shape as `productionShortfalls` / `handleCheckProduction`:

- New state `completionShortfalls: MaterialShortfall[]`, reset to `[]` in `openProductionCompletion`.
- New handler `handleCheckProductionCompletion(reconciliations)` calling
  `checkProductionCompletionStock(completingOrder, reconciliations)`, same `CallAPI` error-toast
  pattern as `handleCheckProduction`.
- Pass `shortfalls={completionShortfalls}` and `onCheck={handleCheckProductionCompletion}` into
  `ProductionCompletionModal`.

## Out of scope

- Leftover/by-product entries — they add stock, never a shortfall source.
- Actual-produced quantity — unrelated to material stock.
- Changing the RPC's own guard — it stays the authoritative, final check (race-safe against
  concurrent completions); this is purely an earlier, non-authoritative warning.

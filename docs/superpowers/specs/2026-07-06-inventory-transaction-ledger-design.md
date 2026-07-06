# Inventory Transaction Ledger — Design (Restructure Step 5)

## Context

The ERP is mid-restructure from a single `inventory_items` catalog to separate `material` / `product` catalogs (already done — `MaterialView`/`ProductView`/`MaterialService`/`ProductService` are live, pattern A). The old `INVENTORY` tab (`InventoryView.tsx` + `InventoryService.ts`) is now dead code: it queries `inventory_items`, a table that no longer exists in `schema.sql`.

This step repurposes the `INVENTORY` tab into a **stock movement ledger** backed by the existing `inventory_transaction` table, rather than an item catalog (catalogs are now Material/Product's job).

Restructure order: **Step 5 (this doc) → Step 6 Purchase → Step 7 Sales.** Purchase/Sales are separate specs; this ledger's manual-entry form covers all 5 transaction types independently of whether those later modules exist yet.

## Decisions made during brainstorming

1. **Sign convention (standard accounting)**: Purchase `+`, Sales `-`, Purchase Return `-`, Sales Return `+`, Adjustment `±` (user picks direction explicitly). This matches the existing `update_material_stock()` trigger, which does `quantity = quantity + NEW.quantity` on insert.
2. **Product stock tracking is new**: `product` has no `quantity` column today, and `inventory_transaction.material_id` only references `material`. Sales/Sales Return transactions need to move product stock, so both get added (see Schema Changes).
3. **All 5 transaction types are manually creatable** from this tab, independent of the future Purchase/Sales modules (which may later auto-generate their own transactions — out of scope here).
4. **Insert-only ledger**: no edit/delete UI. The DB trigger only reacts to `INSERT`, so deletes wouldn't reverse stock anyway. Mistakes are corrected with an offsetting Adjustment entry.

## Schema Changes

Applied to `supabase/schema.sql` and `supabase/function_trigger.sql` (source-of-truth for fresh installs), **plus** run by hand against the live Supabase project (no migration runner in this repo — same as prior schema changes):

```sql
-- product: add trigger-maintained stock quantity (mirrors material.quantity)
ALTER TABLE product ADD COLUMN quantity NUMERIC DEFAULT 0;

-- inventory_transaction: add product side of the ledger
ALTER TABLE inventory_transaction ADD COLUMN product_id UUID REFERENCES product(id) ON DELETE SET NULL;

CREATE INDEX idx_inventory_product ON inventory_transaction(product_id);

-- exactly one of material_id / product_id must be set per row
ALTER TABLE inventory_transaction
ADD CONSTRAINT chk_inventory_transaction_target
CHECK ((material_id IS NOT NULL) <> (product_id IS NOT NULL));

-- extend the existing stock trigger function to also handle product_id
CREATE OR REPLACE FUNCTION update_material_stock()
RETURNS TRIGGER AS
$$
BEGIN
    IF NEW.material_id IS NOT NULL THEN
        UPDATE material
        SET quantity = quantity + NEW.quantity
        WHERE id = NEW.material_id;
    END IF;

    IF NEW.product_id IS NOT NULL THEN
        UPDATE product
        SET quantity = quantity + NEW.quantity
        WHERE id = NEW.product_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

The trigger name (`trg_inventory_update_stock`) and firing condition (`AFTER INSERT ON inventory_transaction`) are unchanged.

`transaction_type` values used by the app (stored as free text, per existing column comment): `PURCHASE`, `SALES`, `PURCHASE_RETURN`, `SALES_RETURN`, `ADJUSTMENT`.

## Service Layer — `src/services/InventoryTransactionService.ts` (new, pattern A)

Mirrors `MaterialService.ts` / `ProductService.ts`: direct Supabase reads, `helper.ts`'s `upsertRecord` for the (insert-only) write path. Needs a new `helper.ts` entry: `erp_inventory_transaction` → table `inventory_transaction`, with a serializer mapping camelCase → snake_case (`materialId`→`material_id`, `productId`→`product_id`, `transactionType`→`transaction_type`, `unitCost`→`unit_cost`, `transactionDate`→`transaction_date`, `remark`, `quantity`).

Exports:
- `generateId()` — same pattern as other services.
- `getInventoryTransactions(params: { search?: string; typeFilter?: string; offset: number; limit: number }): Promise<{ rows: InventoryTransaction[]; hasMore: boolean }>` — reads `inventory_transaction` joined to `material(name, code)` and `product(name, code)` for display, ordered by `transaction_date desc`. `search` filters on the joined material/product name. `typeFilter` filters `transaction_type` when not `'ALL'`.
- `saveInventoryTransaction(tx: InventoryTransaction): Promise<void>` — inserts one row via `upsertRecord('erp_inventory_transaction', tx)`. No update/delete export — insert-only per the design decision.

New type in `types.ts`:
```ts
export interface InventoryTransaction {
  id: string;
  transactionType: 'PURCHASE' | 'SALES' | 'PURCHASE_RETURN' | 'SALES_RETURN' | 'ADJUSTMENT';
  quantity: number; // signed
  unitCost?: number;
  remark?: string;
  materialId?: string;
  materialName?: string; // joined, display only
  productId?: string;
  productName?: string; // joined, display only
  transactionDate: string;
  createdAt?: string;
}
```

## UI — `src/components/InventoryView.tsx` (rewritten in place, same `INVENTORY` tab)

**List**: paginated table (reuse `InfiniteScrollSentinel`, offset/limit like the old `useTableData` pagination but driven by the new service instead of the hook). Columns: Date, Type (colored badge — Purchase blue, Sales emerald, Purchase Return amber, Sales Return teal, Adjustment slate), Item (name + a small Material/Product kind tag), Quantity (signed, green if positive / red if negative), Unit Cost (`RM x.xx`, dash if empty), Remark. Top bar: search input (item name) + type filter dropdown (`ALL` + 5 types) + "Add Transaction" button.

**Add Transaction dialog** (mirrors `MaterialFormFields`-style form, not a full page):
- Transaction Type — combobox of the 5 types.
- Item picker — combobox whose source list depends on type: Purchase/Purchase Return → `getMaterials(search)` (from `MaterialService`); Sales/Sales Return → `getProducts(search)` (from `ProductService`); Adjustment → a small segmented Material/Product toggle above the combobox, switching its source list.
- Quantity — numeric input, magnitude only (always positive), `min=1`.
- Direction toggle (Adjustment only) — Increase/Decrease, determines the sign applied.
- Unit Cost — optional numeric input, shown only for Purchase/Purchase Return.
- Transaction Date — date input, defaults to today.
- Remark — optional textarea.
- Submit computes the signed `quantity` from type (+direction for Adjustment) before calling `saveInventoryTransaction`, then closes the dialog and refetches the first page of the list.

No detail/drill-down page (nothing to drill into — insert-only ledger, no edit).

## Cleanup

- Delete `src/services/InventoryService.ts` — confirmed its only importer is the old `InventoryView.tsx`, which this step rewrites.
- `InventoryItem` (in `types.ts`) and `inventory_items` references stay for now — still used by `OrdersView.tsx`, `PurchasesView.tsx` (both dead pending steps 6/7), `DashboardView.tsx`, `ImportExportModal.tsx`, and `db.ts`. Out of scope for this step; not touched.

## Out of scope

- Auto-generating `PURCHASE`/`SALES` transactions from the future Purchase/Sales modules (steps 6/7) — those will be designed separately and may call `saveInventoryTransaction` directly once built.
- `production_material_usage` (raw-material-consumed-during-production) — separate table, not part of this ledger view.

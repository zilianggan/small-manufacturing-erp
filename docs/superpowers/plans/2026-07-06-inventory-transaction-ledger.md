# Inventory Transaction Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose the `INVENTORY` tab from a dead item-catalog view (points at a dropped `inventory_items` table) into a stock-movement ledger backed by `inventory_transaction`, with manual entry for all 5 transaction types and Purchase/Sales driving material vs. product stock through the existing trigger-based quantity mechanism.

**Architecture:** Pattern-A module (mirrors `MaterialService.ts`/`ProductService.ts`): a new `InventoryTransactionService.ts` reads/writes Supabase directly; `InventoryView.tsx` is rewritten in place to render a paginated, filterable ledger table plus an "Add Transaction" dialog. `product` gains a trigger-maintained `quantity` column (mirroring `material.quantity`) and `inventory_transaction` gains a `product_id` FK, so the same `AFTER INSERT` trigger adjusts either table depending on which FK is set.

**Tech Stack:** React 19 + TypeScript, Supabase (`@supabase/supabase-js`), Tailwind v4, no test framework in this repo — verification is `npm run lint` (`tsc --noEmit`) plus the user's own manual check in the running app (per project convention: this agent does not launch the dev server or browser automation).

## Global Constraints

- Pattern A only: no `db.ts`, no `server.ts` REST hop, no `useTableData` hook for any new code in this plan.
- Sign convention: Purchase `+`, Sales `-`, Purchase Return `-`, Sales Return `+`, Adjustment `±` (user-selected direction). The form always collects a positive magnitude; the sign is computed before insert.
- `inventory_transaction` rows are insert-only — no edit/delete UI, no update/delete service exports.
- Exactly one of `material_id`/`product_id` is set per transaction row (DB-enforced via CHECK constraint).
- `generateId()` in the new service is `crypto.randomUUID()` directly — no manual regex fallback, no new npm dependency.
- Full design context: `docs/superpowers/specs/2026-07-06-inventory-transaction-ledger-design.md`.

---

### Task 1: Database schema — product stock + inventory_transaction.product_id

**Files:**
- Modify: `supabase/schema.sql` (product table definition, inventory_transaction table definition)
- Modify: `supabase/function_trigger.sql` (index section, `update_material_stock()` function)

**Interfaces:**
- Produces: `product.quantity` column (trigger-maintained, same shape as `material.quantity`); `inventory_transaction.product_id` column; CHECK constraint `chk_inventory_transaction_target`; updated `update_material_stock()` function body that later tasks' services rely on for stock to actually move on insert.

- [ ] **Step 1: Update `supabase/schema.sql`'s `product` table to add the `quantity` column**

Find the `CREATE TABLE product (` block and add `quantity` right after `code TEXT,` (mirroring `material`'s placement):

```sql
CREATE TABLE product (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  dimension TEXT,
  quantity NUMERIC DEFAULT 0,
  description TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  status TEXT,
  selling_price NUMERIC DEFAULT 0,
  product_category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_name_code UNIQUE(name, code, dimension)
);
```

- [ ] **Step 2: Update `supabase/schema.sql`'s `inventory_transaction` table to add `product_id` and the exactly-one-target constraint**

```sql
CREATE TABLE inventory_transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES material(id) ON DELETE SET NULL,
  product_id UUID REFERENCES product(id) ON DELETE SET NULL,
  transaction_type TEXT, -- PURCHASE, SALES, PURCHASE_RETURN, SALES_RETURN, ADJUSTMENT
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  remark TEXT,
  purchase_detail_id UUID REFERENCES purchase_detail(detail_id),
  production_material_usage_id UUID REFERENCES production_material_usage(id),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_inventory_transaction_target CHECK ((material_id IS NOT NULL) <> (product_id IS NOT NULL))
);
```

(Note: also fixes the pre-existing `PURCAHSE` typo in the column comment while touching this block.)

- [ ] **Step 3: Update `supabase/function_trigger.sql`'s index section to add the product index**

Add right after `idx_inventory_material`:

```sql
CREATE INDEX idx_inventory_material
ON inventory_transaction(material_id);

CREATE INDEX idx_inventory_product
ON inventory_transaction(product_id);
```

- [ ] **Step 4: Update `supabase/function_trigger.sql`'s `update_material_stock()` function to also move product stock**

Replace the existing function body:

```sql
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

The trigger definition itself (`trg_inventory_update_stock`, `AFTER INSERT ON inventory_transaction`) is unchanged — only the function body changes, and `CREATE OR REPLACE FUNCTION` handles that in place.

- [ ] **Step 5: Run the equivalent migration against your live Supabase project**

This repo has no migration runner — `schema.sql`/`function_trigger.sql` are the "current full schema" reference, applied by hand. Run this against your Supabase project's SQL editor (safe to run on the existing DB: additive only, and every existing `inventory_transaction` row already has `material_id` set and `product_id` NULL, so the new CHECK constraint holds for all current data):

```sql
ALTER TABLE product ADD COLUMN quantity NUMERIC DEFAULT 0;

ALTER TABLE inventory_transaction ADD COLUMN product_id UUID REFERENCES product(id) ON DELETE SET NULL;

CREATE INDEX idx_inventory_product ON inventory_transaction(product_id);

ALTER TABLE inventory_transaction
ADD CONSTRAINT chk_inventory_transaction_target
CHECK ((material_id IS NOT NULL) <> (product_id IS NOT NULL));

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

Confirm in the Supabase table editor that `product` has a `quantity` column and `inventory_transaction` has a `product_id` column before moving to Task 4 (the service layer depends on both existing).

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql supabase/function_trigger.sql
git commit -m "feat(db): add product stock tracking and inventory_transaction.product_id"
```

---

### Task 2: Add `InventoryTransaction` type

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `InventoryTransaction` interface, consumed by Task 4's service and Task 5's view.

- [ ] **Step 1: Add the type**

Add after `ProductSalesHistoryItem` (before `SystemAdminData`):

```ts
export type InventoryTransactionType = 'PURCHASE' | 'SALES' | 'PURCHASE_RETURN' | 'SALES_RETURN' | 'ADJUSTMENT';

// A single stock movement row (inventory_transaction). Insert-only — the
// update_material_stock() DB trigger applies `quantity` (signed) to
// material.quantity or product.quantity on INSERT, so there is no
// update/delete path for this type.
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
  transactionDate: string;
  createdAt?: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run lint`
Expected: no new errors (this is an additive interface with no other file referencing it yet).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add InventoryTransaction type"
```

---

### Task 3: Wire `inventory_transaction` into `helper.ts`

**Files:**
- Modify: `src/helper.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `LS_TO_TABLE['erp_inventory_transaction'] = 'inventory_transaction'`, `ROW_MAPPERS['erp_inventory_transaction']`, both consumed by Task 4's `saveInventoryTransaction` via `upsertRecord('erp_inventory_transaction', tx)`.

- [ ] **Step 1: Add the table mapping**

In `LS_TO_TABLE`, add after `erp_product: 'product',`:

```ts
    erp_product: 'product',
    erp_inventory_transaction: 'inventory_transaction',
};
```

- [ ] **Step 2: Add the row serializer**

In `ROW_MAPPERS`, add after the `erp_product` entry (before the closing `erp_sales_orders` block — i.e. right after the `erp_product: (p) => ({...})` entry):

```ts
    erp_product: (p) => ({
        id: p.id, name: p.name, code: p.code || null, dimension: p.dimension || null,
        description: p.description || '', attachments: p.attachments || [],
        status: p.status || null, selling_price: p.sellingPrice ?? 0,
        product_category_id: p.productCategoryId || null
        // NOTE: quantity deliberately omitted here too — same reason as material:
        // owned by the update_material_stock() DB trigger.
    }),
    erp_inventory_transaction: (t) => ({
        id: t.id,
        transaction_type: t.transactionType,
        quantity: t.quantity,
        unit_cost: t.unitCost ?? null,
        remark: t.remark || null,
        material_id: t.materialId || null,
        product_id: t.productId || null,
        transaction_date: t.transactionDate
    }),
```

- [ ] **Step 3: Verify types compile**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/helper.ts
git commit -m "feat: add inventory_transaction row mapper to helper.ts"
```

---

### Task 4: `InventoryTransactionService.ts`

**Files:**
- Create: `src/services/InventoryTransactionService.ts`

**Interfaces:**
- Consumes: `Material` + `getMaterials(search: string): Promise<Material[]>` from `./MaterialService`; `Product` + `getProducts(search: string): Promise<Product[]>` from `./ProductService`; `upsertRecord` from `../helper`; `InventoryTransaction` from `../types`.
- Produces: `generateId(): string`; `getInventoryTransactions(params: { search?: string; typeFilter?: string; offset: number; limit: number }): Promise<{ rows: InventoryTransaction[]; hasMore: boolean }>`; `saveInventoryTransaction(tx: InventoryTransaction): Promise<void>`. Consumed by Task 5's `InventoryView.tsx`.

- [ ] **Step 1: Create the service file**

```ts
/**
 * Inventory Transaction module service layer (stock movement ledger).
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * MaterialService.ts / ProductService.ts: no db.ts full-list localStorage
 * cache, no server.ts REST hop, no useTableData hook. Insert-only — no
 * update/delete export, since stock is trigger-maintained on INSERT only.
 */
import { supabase } from "./supabase";
import { upsertRecord } from "../helper";
import { InventoryTransaction } from "../types";
import { getMaterials } from "./MaterialService";
import { getProducts } from "./ProductService";

export const generateId = (): string => crypto.randomUUID();

const mapTransactionRow = (row: any): InventoryTransaction => ({
  id: row.id,
  transactionType: row.transaction_type,
  quantity: Number(row.quantity) || 0,
  unitCost: row.unit_cost != null ? Number(row.unit_cost) : undefined,
  remark: row.remark || undefined,
  materialId: row.material_id || undefined,
  materialName: row.material?.name,
  productId: row.product_id || undefined,
  productName: row.product?.name,
  transactionDate: row.transaction_date,
  createdAt: row.created_at,
});

export const getInventoryTransactions = async (params: {
  search?: string;
  typeFilter?: string; // 'ALL' or one of InventoryTransactionType
  offset: number;
  limit: number;
}): Promise<{ rows: InventoryTransaction[]; hasMore: boolean }> => {
  const { search = '', typeFilter = 'ALL', offset, limit } = params;

  let query = supabase
    .from('inventory_transaction')
    .select('*, material(name), product(name)', { count: 'exact' })
    .order('transaction_date', { ascending: false });

  if (typeFilter !== 'ALL') {
    query = query.eq('transaction_type', typeFilter);
  }

  const q = search.trim();
  if (q) {
    // inventory_transaction has no denormalized name column, so search is
    // done by first resolving matching material/product ids via their own
    // services, then filtering the ledger by those ids.
    const [matchedMaterials, matchedProducts] = await Promise.all([
      getMaterials(q),
      getProducts(q),
    ]);
    const materialIds = matchedMaterials.map(m => m.id);
    const productIds = matchedProducts.map(p => p.id);

    if (materialIds.length === 0 && productIds.length === 0) {
      return { rows: [], hasMore: false };
    }

    const orParts: string[] = [];
    if (materialIds.length > 0) orParts.push(`material_id.in.(${materialIds.join(',')})`);
    if (productIds.length > 0) orParts.push(`product_id.in.(${productIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error('getInventoryTransactions', error);
    return { rows: [], hasMore: false };
  }

  const rows = (data || []).map(mapTransactionRow);
  const hasMore = count != null ? offset + rows.length < count : rows.length === limit;
  return { rows, hasMore };
};

export const saveInventoryTransaction = (tx: InventoryTransaction): Promise<void> =>
  upsertRecord('erp_inventory_transaction', tx);
```

- [ ] **Step 2: Verify types compile**

Run: `npm run lint`
Expected: no new errors. If you see an error about `getMaterials`/`getProducts` signatures, check `src/services/MaterialService.ts`/`src/services/ProductService.ts` — both already export `getMaterials(search = ''): Promise<Material[]>` / `getProducts(search = ''): Promise<Product[]>`, no changes needed there.

- [ ] **Step 3: Commit**

```bash
git add src/services/InventoryTransactionService.ts
git commit -m "feat: add InventoryTransactionService"
```

---

### Task 5: Rewrite `InventoryView.tsx`, delete `InventoryService.ts`, update `App.tsx`

**Files:**
- Modify: `src/components/InventoryView.tsx` (full rewrite)
- Delete: `src/services/InventoryService.ts` (dead — its only importer is the file being rewritten; confirmed via repo-wide search)
- Modify: `src/App.tsx` (drop `onQuickProcure` prop on the `INVENTORY` tab render; remove the now-orphaned quick-procure plumbing, since `InventoryView` was its only trigger)

**Interfaces:**
- Consumes: `generateId`, `getInventoryTransactions`, `saveInventoryTransaction` from `../services/InventoryTransactionService` (Task 4); `getMaterials` from `../services/MaterialService`; `getProducts` from `../services/ProductService`; `InventoryTransaction`, `Material`, `Product` from `../types`; `ComboBox`, `SegmentedControl`, `InfiniteScrollSentinel`, `LoadingSpinner`, `Dialog`/`DialogFooter`/`DialogCancelButton`/`DialogSubmitButton`/`Card`/`FormField`/`fieldInputClassName`/`SearchInput` from existing `./ui`/sibling components; `CallAPI` from `./UIHelper`.
- Produces: `InventoryView` — a zero-prop component (previously took `{ onQuickProcure }`), rendered at the `INVENTORY` tab.

- [ ] **Step 1: Delete the dead service**

```bash
git rm src/services/InventoryService.ts
```

- [ ] **Step 2: Replace `src/components/InventoryView.tsx` in full**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  generateId, getInventoryTransactions, saveInventoryTransaction
} from '../services/InventoryTransactionService';
import { getMaterials } from '../services/MaterialService';
import { getProducts } from '../services/ProductService';
import { InventoryTransaction, InventoryTransactionType, Material, Product } from '../types';
import { Plus, Calendar } from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import SegmentedControl from './SegmentedControl';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, fieldInputClassName, SearchInput } from './ui';
import { CallAPI } from './UIHelper';

const PAGE_SIZE = 20;

const TRANSACTION_TYPES: { value: InventoryTransactionType; label: string }[] = [
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'SALES', label: 'Sales' },
  { value: 'PURCHASE_RETURN', label: 'Purchase Return' },
  { value: 'SALES_RETURN', label: 'Sales Return' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
];

const TYPE_BADGE_CLASSNAME: Record<InventoryTransactionType, string> = {
  PURCHASE: 'bg-blue-50 text-blue-700 border-blue-100',
  SALES: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  PURCHASE_RETURN: 'bg-amber-50 text-amber-800 border-amber-200',
  SALES_RETURN: 'bg-teal-50 text-teal-700 border-teal-100',
  ADJUSTMENT: 'bg-slate-50 text-slate-700 border-slate-200',
};

const today = (): string => new Date().toISOString().split('T')[0];

export default function InventoryView() {
  // ─── Ledger list ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | InventoryTransactionType>('ALL');
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const loadTransactions = (nextOffset: number, append: boolean) => {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    CallAPI(() => getInventoryTransactions({ search: searchQuery, typeFilter, offset: nextOffset, limit: PAGE_SIZE }), {
      onCompleted: ({ rows, hasMore: more }) => {
        setTransactions(prev => append ? [...prev, ...rows] : rows);
        setHasMore(more);
        setOffset(nextOffset + rows.length);
        setBusy(false);
      },
      onError: (err) => { console.error(err); setBusy(false); },
    });
  };

  useEffect(() => { loadTransactions(0, false); }, []);

  // Debounced: search text or type filter changing both restart from page 1
  useEffect(() => {
    const t = setTimeout(() => loadTransactions(0, false), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, typeFilter]);

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    loadTransactions(offset, true);
  };

  // ─── Add Transaction form ────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [formType, setFormType] = useState<InventoryTransactionType>('PURCHASE');
  const [formAdjustmentTarget, setFormAdjustmentTarget] = useState<'MATERIAL' | 'PRODUCT'>('MATERIAL');
  const [formItemId, setFormItemId] = useState('');
  const [formQuantity, setFormQuantity] = useState(1);
  const [formDirection, setFormDirection] = useState<'INCREASE' | 'DECREASE'>('INCREASE');
  const [formUnitCost, setFormUnitCost] = useState(0);
  const [formDate, setFormDate] = useState(today());
  const [formRemark, setFormRemark] = useState('');

  const [materialQuery, setMaterialQuery] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const usesMaterialList = formType === 'PURCHASE' || formType === 'PURCHASE_RETURN'
    || (formType === 'ADJUSTMENT' && formAdjustmentTarget === 'MATERIAL');

  useEffect(() => {
    if (!usesMaterialList) return;
    setMaterialsLoading(true);
    CallAPI(() => getMaterials(materialQuery), {
      onCompleted: (data) => { setMaterials(data); setMaterialsLoading(false); },
      onError: (err) => { console.error(err); setMaterialsLoading(false); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialQuery, usesMaterialList]);

  useEffect(() => {
    if (usesMaterialList) return;
    setProductsLoading(true);
    CallAPI(() => getProducts(productQuery), {
      onCompleted: (data) => { setProducts(data); setProductsLoading(false); },
      onError: (err) => { console.error(err); setProductsLoading(false); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQuery, usesMaterialList]);

  const showsUnitCost = formType === 'PURCHASE' || formType === 'PURCHASE_RETURN';
  const showsDirectionToggle = formType === 'ADJUSTMENT';

  const resetForm = () => {
    setFormType('PURCHASE');
    setFormAdjustmentTarget('MATERIAL');
    setFormItemId('');
    setFormQuantity(1);
    setFormDirection('INCREASE');
    setFormUnitCost(0);
    setFormDate(today());
    setFormRemark('');
    setMaterialQuery('');
    setProductQuery('');
  };

  const openAddForm = () => {
    resetForm();
    setShowAddForm(true);
  };

  const computeSignedQuantity = (): number => {
    switch (formType) {
      case 'PURCHASE': return formQuantity;
      case 'SALES': return -formQuantity;
      case 'PURCHASE_RETURN': return -formQuantity;
      case 'SALES_RETURN': return formQuantity;
      case 'ADJUSTMENT': return formDirection === 'INCREASE' ? formQuantity : -formQuantity;
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formItemId || formQuantity <= 0) return;

    const record: InventoryTransaction = {
      id: generateId(),
      transactionType: formType,
      quantity: computeSignedQuantity(),
      unitCost: showsUnitCost ? formUnitCost : undefined,
      remark: formRemark.trim() || undefined,
      materialId: usesMaterialList ? formItemId : undefined,
      productId: usesMaterialList ? undefined : formItemId,
      transactionDate: formDate,
    };

    await CallAPI(() => saveInventoryTransaction(record), {
      onCompleted: () => loadTransactions(0, false),
      onError: console.error,
    });

    setShowAddForm(false);
    resetForm();
  };

  if (loading) {
    return <LoadingSpinner message="Loading inventory ledger..." subtitle="INVENTORY_LEDGER" />;
  }

  return (
    <div className="space-y-6" id="inventory-view">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by material or product name..."
        />

        <div className="flex items-center space-x-2">
          <ComboBox
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as 'ALL' | InventoryTransactionType)}
            options={[{ value: 'ALL', label: 'All Types' }, ...TRANSACTION_TYPES]}
            className="w-44"
          />

          <button
            onClick={openAddForm}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Transaction</span>
          </button>
        </div>
      </div>

      {/* Add Transaction Dialog */}
      <Dialog open={showAddForm} onClose={() => setShowAddForm(false)} title="Add Inventory Transaction">
        <form onSubmit={handleAddTransaction} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

            <FormField label="Transaction Type *" colSpan="sm:col-span-2">
              <ComboBox
                required
                value={formType}
                onChange={(v) => {
                  setFormType(v as InventoryTransactionType);
                  setFormItemId('');
                }}
                options={TRANSACTION_TYPES}
              />
            </FormField>

            {showsDirectionToggle && (
              <FormField label="Direction">
                <SegmentedControl
                  options={[{ value: 'INCREASE', label: 'Increase (+)' }, { value: 'DECREASE', label: 'Decrease (-)' }]}
                  active={formDirection}
                  onChange={setFormDirection}
                />
              </FormField>
            )}

            {formType === 'ADJUSTMENT' && (
              <FormField label="Adjust Stock For">
                <SegmentedControl
                  options={[{ value: 'MATERIAL', label: 'Material' }, { value: 'PRODUCT', label: 'Product' }]}
                  active={formAdjustmentTarget}
                  onChange={(v) => { setFormAdjustmentTarget(v); setFormItemId(''); }}
                />
              </FormField>
            )}

            <FormField label={usesMaterialList ? 'Material *' : 'Product *'} colSpan="sm:col-span-2">
              <ComboBox
                required
                value={formItemId}
                onChange={setFormItemId}
                noneLabel={usesMaterialList ? '-- Select Material --' : '-- Select Product --'}
                options={usesMaterialList
                  ? materials.map(m => ({ value: m.id, label: m.name, sublabel: m.code }))
                  : products.map(p => ({ value: p.id, label: p.name, sublabel: p.code }))}
                onSearch={usesMaterialList ? setMaterialQuery : setProductQuery}
                searchLoading={usesMaterialList ? materialsLoading : productsLoading}
              />
            </FormField>

            <FormField label="Quantity *">
              <input
                type="number"
                required
                min="1"
                value={formQuantity}
                onChange={(e) => setFormQuantity(Number(e.target.value))}
                className={fieldInputClassName}
              />
            </FormField>

            {showsUnitCost && (
              <FormField label="Unit Cost (RM)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formUnitCost}
                  onChange={(e) => setFormUnitCost(Number(e.target.value))}
                  className={fieldInputClassName}
                />
              </FormField>
            )}

            <FormField label="Transaction Date *">
              <input
                type="date"
                required
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className={fieldInputClassName}
              />
            </FormField>

            <FormField label="Remark" colSpan="sm:col-span-2">
              <textarea
                value={formRemark}
                onChange={(e) => setFormRemark(e.target.value)}
                rows={2}
                placeholder="Optional note..."
                className={fieldInputClassName}
              />
            </FormField>

          </div>
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowAddForm(false)} />
            <DialogSubmitButton>Save Transaction</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Ledger table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <th className="p-4">Date</th>
                <th className="p-4">Type</th>
                <th className="p-4">Item</th>
                <th className="p-4 text-right">Quantity</th>
                <th className="p-4 text-right">Unit Cost</th>
                <th className="p-4">Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No inventory transactions match your filters or search.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-950 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center space-x-1.5 text-slate-600 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{tx.transactionDate}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-medium border ${TYPE_BADGE_CLASSNAME[tx.transactionType]}`}>
                        {TRANSACTION_TYPES.find(t => t.value === tx.transactionType)?.label ?? tx.transactionType}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900">{tx.materialName || tx.productName || '—'}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{tx.materialId ? 'Material' : 'Product'}</div>
                      </div>
                    </td>
                    <td className={`p-4 text-right font-mono font-semibold ${tx.quantity < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                    </td>
                    <td className="p-4 font-mono text-slate-900 text-right">
                      {tx.unitCost != null ? `RM ${tx.unitCost.toFixed(2)}` : '—'}
                    </td>
                    <td className="p-4 text-slate-500">{tx.remark || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <InfiniteScrollSentinel onLoadMore={handleLoadMore} hasMore={hasMore} loading={loadingMore} />
    </div>
  );
}
```

- [ ] **Step 3: Update `src/App.tsx` — drop the `onQuickProcure` prop and the now-orphaned quick-procure plumbing**

`InventoryView` no longer accepts props, and it was the only trigger for the cross-tab "quick procure" flow — so `quickProcureItem`/`handleQuickProcure`/`clearQuickProcure` become dead once it's gone. Remove them; `PurchasesView`'s `quickProcureState`/`clearQuickProcure` props are optional, so it still compiles fine with nothing passed in (that view is out of scope — it gets its own rewrite in the Purchase step).

Remove this block (around line 77-79):
```ts
  // Cross-component quick-procure state
  // If user clicks "Procure" on inventory, we pass it down to Purchase orders and switch the tab
  const [quickProcureItem, setQuickProcureItem] = useState<{ itemId: string; itemName: string; vendorId: string } | null>(null);
```

Remove this block (around line 173-180):
```ts
  const handleQuickProcure = (itemId: string, itemName: string, vendorId: string) => {
    setQuickProcureItem({ itemId, itemName, vendorId });
    setActiveTab('PURCHASES');
  };

  const clearQuickProcure = () => {
    setQuickProcureItem(null);
  };
```

Change (around line 492):
```tsx
          {activeTab === 'INVENTORY' && <InventoryView key={refreshKey} onQuickProcure={handleQuickProcure} />}
```
to:
```tsx
          {activeTab === 'INVENTORY' && <InventoryView key={refreshKey} />}
```

Change (around line 498-504):
```tsx
          {activeTab === 'PURCHASES' && (
            <PurchasesView
              key={refreshKey}
              quickProcureState={quickProcureItem}
              clearQuickProcure={clearQuickProcure}
            />
          )}
```
to:
```tsx
          {activeTab === 'PURCHASES' && <PurchasesView key={refreshKey} />}
```

- [ ] **Step 4: Verify types compile**

Run: `npm run lint`
Expected: no errors. If `ShoppingCart` (icon import) shows an "unused import" warning from the old `InventoryView.tsx` content — it won't, since the file was fully replaced in Step 2, which doesn't import it.

- [ ] **Step 5: Manual check (user)**

Per project convention, this agent does not launch the dev server. Ask the user to run `npm run dev` (or their usual flow) and confirm on the `INVENTORY` tab: the ledger list loads, "Add Transaction" opens the dialog, each of the 5 transaction types shows the right item picker (material vs. product) and the right optional fields (unit cost, direction toggle), and a saved transaction appears in the list with the correct sign/color.

- [ ] **Step 6: Commit**

```bash
git add src/components/InventoryView.tsx src/App.tsx
git commit -m "feat: rewrite Inventory tab as a stock transaction ledger"
```

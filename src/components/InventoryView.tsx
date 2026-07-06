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
                  onChange={(v) => setFormDirection(v as 'INCREASE' | 'DECREASE')}
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

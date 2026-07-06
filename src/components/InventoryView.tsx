/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  generateId,
  getMaterialCategories,
  getProductCategories,
  saveInventory
} from '../services/InventoryService';
import { useTableData } from '../hooks/useTableData';
import { InventoryItem, MaterialCategory, ProductCategory, Vendor, Attachment } from '../types';
import { Plus, AlertTriangle, ShoppingCart, Paperclip, Trash2 } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import SegmentedControl from './SegmentedControl';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, fieldInputClassName, SearchInput } from './ui';
import { CallAPI } from './UIHelper';

interface InventoryViewProps {
  onQuickProcure?: (itemId: string, itemName: string, vendorId: string) => void;
}

export default function InventoryView({ onQuickProcure }: InventoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'RAW_MATERIAL' | 'FINISHED_GOOD'>('ALL');
  const { data: inventoryData, loading, loadMore, hasMore, loadingMore, refetch } = useTableData<InventoryItem>('inventory_items', {
    search: searchQuery,
    filters: activeFilter === 'ALL' ? undefined : { type: activeFilter }
  });

  // Vendor supplier picker — search-as-you-type instead of a full vendor fetch
  const [supplierQuery, setSupplierQuery] = useState('');
  const { data: vendors, loading: vendorsSearchLoading } = useTableData<Vendor>('vendors', { search: supplierQuery });

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  useEffect(() => { setInventory(inventoryData); }, [inventoryData]);

  // UI state
  const [showAddForm, setShowAddForm] = useState(false);

  // Form states
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formType, setFormType] = useState<InventoryItem['type']>('RAW_MATERIAL');
  const [formMaterialCategoryId, setFormMaterialCategoryId] = useState('');
  const [formProductCategoryId, setFormProductCategoryId] = useState('');
  const [formQuantity, setFormQuantity] = useState(0);
  const [formUnit, setFormUnit] = useState('pcs');
  const [formUnitCost, setFormUnitCost] = useState(0);
  const [formReorderPoint, setFormReorderPoint] = useState(0);
  const [formSupplierId, setFormSupplierId] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);

  const loadCategories = async () => {
    await CallAPI(getMaterialCategories, {
      onCompleted: setMaterialCategories,
      onError: console.error,
    });
    await CallAPI(getProductCategories, {
      onCompleted: setProductCategories,
      onError: console.error,
    });
  };

  useEffect(() => {
    loadCategories();
  }, []);

  // Handle addition
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formSku) return;

    const newItem: InventoryItem = {
      id: generateId(),
      name: formName,
      sku: formSku,
      type: formType,
      materialCategoryId: formType === 'RAW_MATERIAL' ? formMaterialCategoryId || undefined : undefined,
      productCategoryId: formType === 'FINISHED_GOOD' ? formProductCategoryId || undefined : undefined,
      quantity: formQuantity,
      unit: formUnit,
      unitCost: formUnitCost,
      reorderPoint: formReorderPoint,
      supplierId: formSupplierId || undefined,
      description: formDescription || undefined,
      attachments: formAttachment ? [formAttachment] : []
    };

    const previous = inventory;
    const updated = [...inventory, newItem];
    setInventory(updated);

    await CallAPI(() => saveInventory(updated, newItem), {
      onCompleted: refetch,
      onError: (err) => {
        console.error(err);
        setInventory(previous);
      },
    });

    // Reset fields
    setFormName('');
    setFormSku('');
    setFormMaterialCategoryId('');
    setFormProductCategoryId('');
    setFormQuantity(0);
    setFormUnit('pcs');
    setFormUnitCost(0);
    setFormReorderPoint(0);
    setFormSupplierId('');
    setFormDescription('');
    setFormAttachment(undefined);
    setShowAddForm(false);
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    const previous = inventory;
    const updated = inventory.filter(item => item.id !== id);
    setInventory(updated);

    await CallAPI(() => saveInventory(updated, undefined, id), {
      onCompleted: refetch,
      onError: (err) => {
        console.error(err);
        setInventory(previous);
      },
    });
  };

  // Server already applied search + type filter; use the loaded rows as-is.
  const filteredInventory = inventory;

  // Vendor Lookup Map
  const vendorMap = useMemo(() => {
    return new Map(vendors.map(v => [v.id, v.companyName]));
  }, [vendors]);

  const materialCategoryMap = useMemo(() => {
    return new Map(materialCategories.map(category => [category.id, category.name]));
  }, [materialCategories]);

  const productCategoryMap = useMemo(() => {
    return new Map(productCategories.map(category => [category.id, category.name]));
  }, [productCategories]);

  const activeMaterialCategories = materialCategories.filter(category => category.is_active);
  const activeProductCategories = productCategories.filter(category => category.is_active);

  if (loading) {
    return <LoadingSpinner message="Auditing inventory levels..." subtitle="STOCK_METRICS" />;
  }

  return (
    <div className="space-y-6" id="inventory-view">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search items by name or SKU..."
        />

        <div className="flex items-center space-x-2">
          {/* Segmented control for filtering */}
          <SegmentedControl
            options={[
              { value: 'ALL', label: 'All Items' },
              { value: 'RAW_MATERIAL', label: 'Raw Materials' },
              { value: 'FINISHED_GOOD', label: 'Finished Goods' }
            ]}
            active={activeFilter}
            onChange={(value) => setActiveFilter(value as any)}
            getActiveClassName={(value) => {
              if (value === 'RAW_MATERIAL') return 'bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400';
              if (value === 'FINISHED_GOOD') return 'bg-white text-emerald-600 shadow-sm dark:bg-slate-800 dark:text-emerald-400';
              return 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100';
            }}
          />

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Item</span>
          </button>
        </div>
      </div>

      {/* Add Item Form as Dialog Modal */}
      <Dialog open={showAddForm} onClose={() => setShowAddForm(false)} title="Add New Inventory Item">
        <form onSubmit={handleAddItem} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

            <FormField label="Item Name *">
              <input
                type="text"
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. High-Tensile Bolts"
                className={fieldInputClassName}
              />
            </FormField>

            <FormField label="SKU / Code *">
              <input
                type="text"
                required
                value={formSku}
                onChange={(e) => setFormSku(e.target.value.toUpperCase())}
                placeholder="e.g. RM-BLT-04"
                className={`${fieldInputClassName} uppercase font-mono`}
              />
            </FormField>

            <FormField label="Item Type">
              <ComboBox
                value={formType}
                onChange={(v) => {
                  setFormType(v as InventoryItem['type']);
                }}
                options={[
                  { value: 'RAW_MATERIAL', label: 'Raw Material (Ingredient)' },
                  { value: 'FINISHED_GOOD', label: 'Finished Good (End Product)' },
                ]}
              />
            </FormField>

            {formType === 'RAW_MATERIAL' ? (
              <FormField label="Material Category">
                <ComboBox
                  value={formMaterialCategoryId}
                  onChange={setFormMaterialCategoryId}
                  noneLabel="-- Select Material Category --"
                  options={activeMaterialCategories.map(category => ({
                    value: category.id,
                    label: category.name
                  }))}
                />
              </FormField>
            ) : (
              <FormField label="Product Category">
                <ComboBox
                  value={formProductCategoryId}
                  onChange={setFormProductCategoryId}
                  noneLabel="-- Select Product Category --"
                  options={activeProductCategories.map(category => ({
                    value: category.id,
                    label: category.name
                  }))}
                />
              </FormField>
            )}

            <FormField label="Initial Stock Quantity">
              <input
                type="number"
                min="0"
                value={formQuantity}
                onChange={(e) => setFormQuantity(Number(e.target.value))}
                className={fieldInputClassName}
              />
            </FormField>

            <FormField label="Measurement Unit">
              <input
                type="text"
                placeholder="e.g. tons, pcs, liters"
                value={formUnit}
                onChange={(e) => setFormUnit(e.target.value)}
                className={fieldInputClassName}
              />
            </FormField>

            <FormField label="Unit Cost (RM)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formUnitCost}
                onChange={(e) => setFormUnitCost(Number(e.target.value))}
                className={fieldInputClassName}
              />
            </FormField>

            <FormField label="Reorder Alert Level (Threshold)">
              <input
                type="number"
                min="0"
                value={formReorderPoint}
                onChange={(e) => setFormReorderPoint(Number(e.target.value))}
                className={fieldInputClassName}
              />
            </FormField>

            {formType === 'RAW_MATERIAL' && (
              <FormField label="Preferred Supplier">
                <ComboBox
                  value={formSupplierId}
                  onChange={setFormSupplierId}
                  noneLabel="-- Select Preferred Supplier --"
                  options={vendors.map(v => ({ value: v.id, label: v.companyName }))}
                  onSearch={setSupplierQuery}
                  searchLoading={vendorsSearchLoading}
                />
              </FormField>
            )}

            <FormField label="Description" colSpan="sm:col-span-2">
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={2}
                placeholder="Brief item description..."
                className={fieldInputClassName}
              />
            </FormField>

            <div className="sm:col-span-2">
              <AttachmentSection
                attachment={formAttachment}
                onAttachmentChange={setFormAttachment}
                label="Item Document or Blueprint (Optional)"
                helperText="Upload any technical blueprint, sheet, or manual (Max 1MB)"
              />
            </div>

          </div>
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowAddForm(false)} />
            <DialogSubmitButton>Save Item</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Inventory Table Card */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <th className="p-4">Item Details</th>
                <th className="p-4">SKU</th>
                <th className="p-4">Type</th>
                <th className="p-4 text-center">Stock Level</th>
                <th className="p-4">Unit Cost</th>
                <th className="p-4">Valuation</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No items match your filters or search. Add an item or clear search query.
                  </td>
                </tr>
              ) : (
                filteredInventory.map((item) => {
                  const isLow = item.quantity <= item.reorderPoint;
                  const supplierName = item.supplierId ? vendorMap.get(item.supplierId) : null;

                  // Compute reorder scale percent (max 100)
                  const percent = Math.min(100, Math.max(5, (item.quantity / (item.reorderPoint || 10)) * 50));

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-950 transition-colors">
                      {/* Name / Description */}
                      <td className="p-4 max-w-sm">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900 flex items-center space-x-1.5">
                            <span>{item.name}</span>
                            {isLow && (
                              <span className="inline-flex items-center space-x-0.5 text-[9px] font-mono font-medium px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded-full border border-amber-200">
                                <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                                <span>Low</span>
                              </span>
                            )}
                          </div>
                          {item.description && <p className="text-[11px] text-slate-400 line-clamp-1">{item.description}</p>}
                          {supplierName && (
                            <div className="text-[10px] text-slate-500 flex items-center space-x-1">
                              <span className="font-mono text-slate-400">Supplier:</span>
                              <span>{supplierName}</span>
                            </div>
                          )}
                          {(item.materialCategoryId || item.productCategoryId) && (
                            <div className="text-[10px] text-slate-500 flex items-center space-x-1">
                              <span className="font-mono text-slate-400">Category:</span>
                              <span>
                                {item.type === 'RAW_MATERIAL'
                                  ? materialCategoryMap.get(item.materialCategoryId || '') || 'Unassigned'
                                  : productCategoryMap.get(item.productCategoryId || '') || 'Unassigned'}
                              </span>
                            </div>
                          )}
                          {item.attachments?.[0] && (
                            <div className="mt-1.5 flex items-center">
                              <a
                                href={item.attachments[0].dataUrl}
                                download={item.attachments[0].name}
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                                title="Download / view attachment"
                              >
                                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                                <span className="truncate max-w-[150px]">{item.attachments[0].name}</span>
                              </a>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* SKU */}
                      <td className="p-4 font-mono text-slate-500 font-medium">{item.sku}</td>

                      {/* Type Badge */}
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-medium border ${item.type === 'RAW_MATERIAL'
                          ? 'bg-blue-50 text-blue-700 border-blue-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          }`}>
                          {item.type === 'RAW_MATERIAL' ? 'Raw Material' : 'Finished'}
                        </span>
                      </td>

                      {/* Quantity Progress Bar */}
                      <td className="p-4 max-w-[150px]">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between font-mono font-semibold text-slate-900">
                            <span>{item.quantity} {item.unit}</span>
                            <span className="text-[10px] text-slate-400">min: {item.reorderPoint}</span>
                          </div>
                          {/* Progress indicator */}
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isLow ? 'bg-amber-500' : item.type === 'RAW_MATERIAL' ? 'bg-blue-500' : 'bg-emerald-500'}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Unit Cost */}
                      <td className="p-4 font-mono text-slate-900">
                        RM {item.unitCost.toFixed(2)}
                      </td>

                      {/* Valuation */}
                      <td className="p-4 font-mono font-medium text-slate-900">
                        RM {(item.quantity * item.unitCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Actions */}
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {item.type === 'RAW_MATERIAL' && item.supplierId && onQuickProcure && (
                            <button
                              onClick={() => onQuickProcure(item.id, item.name, item.supplierId!)}
                              title="Procure more raw materials"
                              className="p-1 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                            >
                              <ShoppingCart className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <InfiniteScrollSentinel onLoadMore={loadMore} hasMore={hasMore} loading={loadingMore} />
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { getInventory, saveInventory, getVendors } from '../services/db';
import { InventoryItem, Vendor, Attachment } from '../types';
import { Search, Plus, Filter, AlertTriangle, ArrowUpRight, CheckCircle2, ShoppingCart, Paperclip } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import SegmentedControl from './SegmentedControl';

interface InventoryViewProps {
  onQuickProcure?: (itemId: string, itemName: string, vendorId: string) => void;
}

export default function InventoryView({ onQuickProcure }: InventoryViewProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>(() => getInventory());
  const vendors = useMemo(() => getVendors(), []);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'RAW_MATERIAL' | 'FINISHED_GOOD'>('ALL');
  const [showAddForm, setShowAddForm] = useState(false);

  // Form states
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formType, setFormType] = useState<InventoryItem['type']>('RAW_MATERIAL');
  const [formQuantity, setFormQuantity] = useState(0);
  const [formUnit, setFormUnit] = useState('pcs');
  const [formUnitCost, setFormUnitCost] = useState(0);
  const [formReorderPoint, setFormReorderPoint] = useState(0);
  const [formSupplierId, setFormSupplierId] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);

  // Handle addition
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formSku) return;

    const newItem: InventoryItem = {
      id: `${formType === 'RAW_MATERIAL' ? 'rm' : 'fg'}-${Date.now()}`,
      name: formName,
      sku: formSku,
      type: formType,
      quantity: formQuantity,
      unit: formUnit,
      unitCost: formUnitCost,
      reorderPoint: formReorderPoint,
      supplierId: formSupplierId || undefined,
      description: formDescription || undefined,
      attachment: formAttachment
    };

    const updated = [...inventory, newItem];
    setInventory(updated);
    saveInventory(updated);

    // Reset fields
    setFormName('');
    setFormSku('');
    setFormQuantity(0);
    setFormUnit('pcs');
    setFormUnitCost(0);
    setFormReorderPoint(0);
    setFormSupplierId('');
    setFormDescription('');
    setFormAttachment(undefined);
    setShowAddForm(false);
  };

  const handleDeleteItem = (id: string) => {
    if (confirm('Are you sure you want to delete this item?')) {
      const updated = inventory.filter(item => item.id !== id);
      setInventory(updated);
      saveInventory(updated);
    }
  };

  // Filtered Inventory
  const filteredInventory = useMemo(() => {
    return inventory.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            item.sku.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = activeFilter === 'ALL' || item.type === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [inventory, searchQuery, activeFilter]);

  // Vendor Lookup Map
  const vendorMap = useMemo(() => {
    return new Map(vendors.map(v => [v.id, v.name]));
  }, [vendors]);

  return (
    <div className="space-y-6" id="inventory-view">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search items by name or SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 font-sans dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

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
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-sans font-semibold text-slate-900 text-sm">Add New Inventory Item</h3>
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-base p-1 leading-none animate-hover"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddItem} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
                
                <div className="space-y-1">
                  <label className="font-semibold block">Item Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. High-Tensile Bolts"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold block">SKU / Code *</label>
                  <input
                    type="text"
                    required
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value.toUpperCase())}
                    placeholder="e.g. RM-BLT-04"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 uppercase font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold block">Item Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as InventoryItem['type'])}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="RAW_MATERIAL">Raw Material (Ingredient)</option>
                    <option value="FINISHED_GOOD">Finished Good (End Product)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold block">Initial Stock Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold block">Measurement Unit</label>
                  <input
                    type="text"
                    placeholder="e.g. tons, pcs, liters"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold block">Unit Cost (RM)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formUnitCost}
                    onChange={(e) => setFormUnitCost(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold block">Reorder Alert Level (Threshold)</label>
                  <input
                    type="number"
                    min="0"
                    value={formReorderPoint}
                    onChange={(e) => setFormReorderPoint(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                {formType === 'RAW_MATERIAL' && (
                  <div className="space-y-1">
                    <label className="font-semibold block">Preferred Supplier</label>
                    <select
                      value={formSupplierId}
                      onChange={(e) => setFormSupplierId(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                      <option value="">-- Select Preferred Supplier --</option>
                      {vendors.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1 sm:col-span-2">
                  <label className="font-semibold block">Description</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={2}
                    placeholder="Brief item description..."
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <AttachmentSection 
                    attachment={formAttachment} 
                    onAttachmentChange={setFormAttachment} 
                    label="Item Document or Blueprint (Optional)"
                    helperText="Upload any technical blueprint, sheet, or manual (Max 1MB)"
                  />
                </div>

              </div>
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 text-xs mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inventory Table Card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
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
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
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
                          {item.attachment && (
                            <div className="mt-1.5 flex items-center">
                              <a
                                href={item.attachment.dataUrl}
                                download={item.attachment.name}
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                                title="Download / view attachment"
                              >
                                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                                <span className="truncate max-w-[150px]">{item.attachment.name}</span>
                              </a>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* SKU */}
                      <td className="p-4 font-mono text-slate-500 font-medium">{item.sku}</td>

                      {/* Type Badge */}
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-medium border ${
                          item.type === 'RAW_MATERIAL'
                            ? 'bg-blue-50/50 text-blue-700 border-blue-100'
                            : 'bg-emerald-50/50 text-emerald-700 border-emerald-100'
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
                              className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            >
                              <ShoppingCart className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <span className="text-xs">Delete</span>
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
      </div>
    </div>
  );
}

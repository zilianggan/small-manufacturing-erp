/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { getPurchaseOrders, addPurchaseOrder, updatePurchaseOrderStatus, getVendors, getInventory } from '../services/db';
import { PurchaseOrder, Vendor, InventoryItem, Attachment } from '../types';
import { Search, Plus, Calendar, PackageCheck, AlertCircle, ShoppingBag, ClipboardList, Check, Paperclip, Trash2, Edit } from 'lucide-react';
import AttachmentSection from './AttachmentSection';

interface PurchasesViewProps {
  quickProcureState?: { itemId: string; itemName: string; vendorId: string } | null;
  clearQuickProcure?: () => void;
}

export default function PurchasesView({ quickProcureState, clearQuickProcure }: PurchasesViewProps) {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() => getPurchaseOrders());
  const vendors = useMemo(() => getVendors(), []);
  const inventory = useMemo(() => getInventory(), []);

  const rawMaterials = useMemo(() => {
    return inventory.filter(item => item.type === 'RAW_MATERIAL');
  }, [inventory]);

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editPOId, setEditPOId] = useState<string | null>(null);

  // Form states
  const [formVendorId, setFormVendorId] = useState('');
  const [formItems, setFormItems] = useState<{ itemId: string; itemName: string; quantity: number; unitCost: number; totalCost: number }[]>([]);
  const [tempItemId, setTempItemId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(10);
  const [tempUnitCost, setTempUnitCost] = useState(0);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);

  const resetForm = () => {
    setEditPOId(null);
    setFormVendorId('');
    setFormItems([]);
    setTempItemId('');
    setTempQuantity(10);
    setTempUnitCost(0);
    setFormAttachment(undefined);
  };

  const handleEditPO = (po: PurchaseOrder) => {
    setEditPOId(po.id);
    setFormVendorId(po.vendorId);
    setFormAttachment(po.attachment);
    
    if (po.items && po.items.length > 0) {
      setFormItems(po.items);
    } else {
      setFormItems([{
        itemId: po.itemId,
        itemName: po.itemName,
        quantity: po.quantity,
        unitCost: po.unitCost,
        totalCost: po.totalCost
      }]);
    }
    
    setShowAddForm(true);
  };

  // Intercept quick procure trigger from InventoryView
  useEffect(() => {
    if (quickProcureState) {
      setFormVendorId(quickProcureState.vendorId);
      setShowAddForm(true);

      const material = rawMaterials.find(m => m.id === quickProcureState.itemId);
      if (material) {
        const suggestQty = material.reorderPoint * 2 || 20;
        setFormItems([{
          itemId: material.id,
          itemName: material.name,
          quantity: suggestQty,
          unitCost: material.unitCost,
          totalCost: suggestQty * material.unitCost
        }]);
      }
      
      // Clear parent trigger state
      if (clearQuickProcure) {
        clearQuickProcure();
      }
    }
  }, [quickProcureState]);

  // Vendor raw material lists
  const filteredMaterialsForVendor = useMemo(() => {
    if (!formVendorId) return rawMaterials;
    const vendor = vendors.find(v => v.id === formVendorId);
    if (!vendor) return rawMaterials;
    return rawMaterials.filter(m => vendor.materialsSupplied.includes(m.id) || m.supplierId === vendor.id);
  }, [formVendorId, rawMaterials, vendors]);

  const handleVendorSelect = (vendorId: string) => {
    setFormVendorId(vendorId);
    setFormItems([]);
    setTempItemId('');
    setTempUnitCost(0);
  };

  const handleMaterialSelect = (itemId: string) => {
    setTempItemId(itemId);
    const material = rawMaterials.find(m => m.id === itemId);
    if (material) {
      setTempUnitCost(material.unitCost);
    }
  };

  const handleAddTempItem = () => {
    if (!tempItemId || tempQuantity <= 0) return;
    const material = rawMaterials.find(m => m.id === tempItemId);
    if (!material) return;

    const existingIdx = formItems.findIndex(i => i.itemId === tempItemId);
    if (existingIdx !== -1) {
      const updated = [...formItems];
      updated[existingIdx].quantity += tempQuantity;
      updated[existingIdx].totalCost = updated[existingIdx].quantity * updated[existingIdx].unitCost;
      setFormItems(updated);
    } else {
      setFormItems([...formItems, {
        itemId: tempItemId,
        itemName: material.name,
        quantity: tempQuantity,
        unitCost: tempUnitCost,
        totalCost: tempQuantity * tempUnitCost
      }]);
    }

    setTempItemId('');
    setTempQuantity(10);
    setTempUnitCost(0);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormItems(formItems.filter((_, idx) => idx !== index));
  };

  const handleCreatePO = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formVendorId) return;

    // Check if there's a temp item selected but not added yet, and automatically add it
    let finalItems = [...formItems];
    if (tempItemId && tempQuantity > 0) {
      const material = rawMaterials.find(m => m.id === tempItemId);
      if (material) {
        const existingIdx = finalItems.findIndex(i => i.itemId === tempItemId);
        if (existingIdx !== -1) {
          finalItems[existingIdx].quantity += tempQuantity;
          finalItems[existingIdx].totalCost = finalItems[existingIdx].quantity * finalItems[existingIdx].unitCost;
        } else {
          finalItems.push({
            itemId: tempItemId,
            itemName: material.name,
            quantity: tempQuantity,
            unitCost: tempUnitCost,
            totalCost: tempQuantity * tempUnitCost
          });
        }
      }
    }

    if (finalItems.length === 0) {
      alert('Please add at least one material item to this purchase order.');
      return;
    }

    const vendor = vendors.find(v => v.id === formVendorId);
    if (!vendor) return;

    const overallQty = finalItems.reduce((sum, item) => sum + item.quantity, 0);

    const newPOPayload = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      itemId: finalItems[0].itemId,
      itemName: finalItems[0].itemName,
      quantity: overallQty,
      unitCost: finalItems[0].unitCost,
      status: 'ORDERED' as PurchaseOrder['status'],
      attachment: formAttachment,
      items: finalItems
    };

    if (editPOId) {
      const allPOs = getPurchaseOrders();
      const poIndex = allPOs.findIndex(po => po.id === editPOId);
      if (poIndex !== -1) {
        allPOs[poIndex] = {
          ...allPOs[poIndex],
          ...newPOPayload
        };
        localStorage.setItem('erp_purchase_orders', JSON.stringify(allPOs));
      }
    } else {
      addPurchaseOrder(newPOPayload);
    }

    setPurchaseOrders(getPurchaseOrders()); // refresh list
    setShowAddForm(false);

    // Reset
    resetForm();
  };

  const handleReceiveStock = (id: string) => {
    updatePurchaseOrderStatus(id, 'RECEIVED');
    setPurchaseOrders(getPurchaseOrders()); // refresh list
  };

  const handleCancelPO = (id: string) => {
    if (confirm('Cancel this Purchase Order?')) {
      updatePurchaseOrderStatus(id, 'CANCELLED');
      setPurchaseOrders(getPurchaseOrders()); // refresh list
    }
  };

  const handleDeletePO = (id: string) => {
    if (confirm('Are you sure you want to delete this Purchase Order?')) {
      const updated = getPurchaseOrders().filter(po => po.id !== id);
      localStorage.setItem('erp_purchase_orders', JSON.stringify(updated));
      setPurchaseOrders(updated);
    }
  };

  const filteredPOs = useMemo(() => {
    return purchaseOrders.filter(po =>
      po.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      po.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      po.id.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [purchaseOrders, searchQuery]);

  return (
    <div className="space-y-6" id="purchases-view">
      
      {/* Top filter/search actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search POs by supplier or material..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 font-sans"
          />
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Procure Raw Materials</span>
        </button>
      </div>

      {/* Creation PO form as Dialog Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-sans font-semibold text-slate-900 text-sm">
                {editPOId ? 'Edit Material Purchase Order (PO)' : 'Issue Material Purchase Order (PO)'}
              </h3>
              <button 
                type="button" 
                onClick={() => { setShowAddForm(false); if (clearQuickProcure) clearQuickProcure(); }}
                className="text-slate-400 hover:text-slate-600 font-bold text-base p-1 leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleCreatePO} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
                
                <div className="space-y-1 sm:col-span-2">
                  <label className="font-semibold block text-slate-700">Select Vendor *</label>
                  <select
                    required
                    value={formVendorId}
                    onChange={(e) => handleVendorSelect(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 font-medium"
                  >
                    <option value="">-- Select Vendor --</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name} (Rating: {v.rating})</option>
                    ))}
                  </select>
                </div>

                {/* List of Added Purchase Items */}
                <div className="sm:col-span-2 border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
                  <span className="font-semibold block text-slate-700 text-xs">Materials to Procure ({formItems.length})</span>
                  {formItems.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white text-[11px]">
                      No materials added yet. Specify material details below to add items to this PO.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                            <th className="p-2">Material Name</th>
                            <th className="p-2 text-right">Quantity</th>
                            <th className="p-2 text-right">Unit Cost</th>
                            <th className="p-2 text-right">Total (RM)</th>
                            <th className="p-2 text-center" style={{ width: '40px' }}></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-slate-700">
                          {formItems.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-2 font-semibold text-slate-800">{item.itemName}</td>
                              <td className="p-2 text-right font-mono">{item.quantity}</td>
                              <td className="p-2 text-right font-mono">RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-2 text-right font-mono font-semibold">RM {item.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFormItem(idx)}
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove item"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Inline Add Material Panel */}
                <div className="sm:col-span-2 border border-blue-100 rounded-lg p-4 bg-blue-50/20 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-6 space-y-1">
                    <label className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Material Selection</label>
                    <select
                      value={tempItemId}
                      onChange={(e) => handleMaterialSelect(e.target.value)}
                      disabled={!formVendorId}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">-- Choose Material --</option>
                      {filteredMaterialsForVendor.map(m => (
                        <option key={m.id} value={m.id}>{m.name} (Stock: {m.quantity})</option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2 space-y-1">
                    <label className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={tempQuantity}
                      onChange={(e) => setTempQuantity(Number(e.target.value))}
                      disabled={!formVendorId}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800 disabled:bg-slate-50"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1">
                    <label className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Unit Cost (RM)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tempUnitCost}
                      onChange={(e) => setTempUnitCost(Number(e.target.value))}
                      disabled={!formVendorId}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800 disabled:bg-slate-50"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddTempItem}
                      disabled={!formVendorId || !tempItemId || tempQuantity <= 0}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                    >
                      + Add Item
                    </button>
                  </div>
                </div>

                {/* Subtotals Block */}
                <div className="bg-amber-50 rounded-lg p-3 sm:col-span-2 flex items-center justify-between border border-amber-100">
                  <div>
                    <span className="font-semibold block text-[11px] text-amber-900">Total Purchase Cost:</span>
                    <span className="text-[10px] text-amber-700 font-sans">Payment will be logged under company material costs.</span>
                  </div>
                  <div className="font-mono text-base font-bold text-amber-950">
                    RM {Math.max(0, formItems.reduce((sum, item) => sum + item.totalCost, 0) + (tempItemId && tempQuantity > 0 ? tempQuantity * tempUnitCost : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <AttachmentSection 
                    attachment={formAttachment} 
                    onAttachmentChange={setFormAttachment} 
                    label="Quotation or Invoice Document (Optional)"
                    helperText="Upload any supplier quotation, invoice, specification, or receipt (Max 1MB)"
                  />
                </div>

              </div>
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 text-xs mt-4">
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); if (clearQuickProcure) clearQuickProcure(); }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  {editPOId ? 'Update Purchase Order' : 'Issue Purchase Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Listing Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <th className="p-4">PO Code</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">Material Details</th>
                <th className="p-4">Order Date</th>
                <th className="p-4">Total Cost</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredPOs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No purchase orders logged yet.
                  </td>
                </tr>
              ) : (
                filteredPOs.map((po) => (
                  <tr key={po.id} className="group hover:bg-slate-50/50 transition-colors">
                    
                    {/* PO Code */}
                    <td className="p-4 font-mono font-semibold text-slate-900">
                      PO-#{po.id.split('-')[1] || po.id}
                    </td>

                    {/* Vendor Name */}
                    <td className="p-4 font-semibold text-slate-900">
                      {po.vendorName}
                    </td>

                    {/* Material Details */}
                    <td className="p-4">
                      <div className="space-y-1">
                        {po.items && po.items.length > 0 ? (
                          <div className="space-y-1 max-w-xs">
                            {po.items.map((item, idx) => (
                              <div key={idx} className="flex flex-col border-b border-slate-100 last:border-none pb-1 last:pb-0">
                                <span className="font-semibold text-slate-800">{item.itemName}</span>
                                <span className="text-[10px] text-slate-400 font-mono text-slate-500">
                                  Qty: {item.quantity} @ RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-800">{po.itemName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">Qty: {po.quantity} units</div>
                          </div>
                        )}
                        {po.attachment && (
                          <div className="pt-1.5 flex items-center">
                            <a
                              href={po.attachment.dataUrl}
                              download={po.attachment.name}
                              className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                              title="Download attachment"
                            >
                              <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                              <span className="truncate max-w-[120px]">{po.attachment.name}</span>
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Order Date */}
                    <td className="p-4">
                      <div className="flex items-center space-x-1.5 text-slate-600 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{po.orderDate}</span>
                      </div>
                    </td>

                    {/* Total Cost */}
                    <td className="p-4 font-mono font-semibold text-slate-900">
                      RM {po.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {/* Status Badge */}
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-medium border ${
                        po.status === 'DRAFT' ? 'bg-slate-50 text-slate-800 border-slate-200' :
                        po.status === 'ORDERED' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                        po.status === 'RECEIVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                        'bg-red-50 text-red-800 border-red-200'
                      }`}>
                        {po.status === 'ORDERED' ? 'Pending Stock' : po.status}
                      </span>
                    </td>

                    {/* Receive Actions */}
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <button
                          onClick={() => handleEditPO(po)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleDeletePO(po.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        
                        {po.status === 'ORDERED' && (
                          <>
                            <button
                              onClick={() => handleReceiveStock(po.id)}
                              title="Mark material package as received"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleCancelPO(po.id)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors text-[10px] font-medium"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {po.status === 'RECEIVED' && (
                          <div className="text-[10px] text-emerald-600 font-semibold flex items-center space-x-0.5 font-mono px-1.5">
                            <span className="px-2 py-0.5 bg-emerald-50 rounded">Replenished ✓</span>
                          </div>
                        )}
                        {po.status === 'CANCELLED' && (
                          <span className="text-[10px] text-slate-400 font-mono italic px-1.5">Cancelled</span>
                        )}
                      </div>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

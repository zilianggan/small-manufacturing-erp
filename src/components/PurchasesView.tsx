/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  getPurchases, createPurchaseQuotation, updatePurchase, convertToPurchaseOrder,
  receivePurchaseOrder, cancelPurchaseOrder, deletePurchase, getMaterialCategories,
  getPurchaseById,
  PurchaseDetailInput,
} from '../services/PurchasesService';
import { getMaterials } from '../services/MaterialService';
import { getVendors } from '../services/ContactsService';
import { getSalesOrdersForLinking, SalesOrderLinkOption, getSalesOrderMaterialRequirements, SalesOrderMaterialRequirement } from '../services/OrdersService';
import { PurchaseHeader, Vendor, Material, Attachment, MaterialCategory } from '../types';
import { Plus, Calendar, Check, Paperclip, Trash2, Edit, FileText, ArrowRightCircle, Eye } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import QuotationModal from './QuotationModal';
import InvoiceModal from './InvoiceModal';
import PurchaseOrderDetailView from './PurchaseOrderDetailView';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, SearchInput, useToast, useConfirm } from './ui';
import { CallAPI } from './UIHelper';
import { debounce } from 'lodash'

type PurchaseTab = 'QUOTATION' | 'PO';
type FormMode = 'CREATE' | 'EDIT' | 'CONVERT';

interface PurchasesViewProps {
  // Cross-tab drill-in: MaterialDetailView.tsx's purchase history links here
  // via App.tsx passing a pending purchase header id, since Purchases/Material
  // are separate top-level tabs with no shared router.
  initialPurchaseId?: string | null;
  onInitialPurchaseHandled?: () => void;
  // Called instead of closing locally when the currently open detail page
  // was reached via that cross-tab drill-in — lets App.tsx send the user
  // back to the originating Material detail page rather than this list.
  onReturnToOrigin?: () => void;
}

export default function PurchasesView({ initialPurchaseId, onInitialPurchaseHandled, onReturnToOrigin }: PurchasesViewProps = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<PurchaseTab>('QUOTATION');
  const [searchQuery, setSearchQuery] = useState([{ search: '' }, { search: '' }]);
  const [purchases, setPurchases] = useState<PurchaseHeader[]>([]);
  const [loading, setLoading] = useState(true);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [salesLinkOptions, setSalesLinkOptions] = useState<SalesOrderLinkOption[]>([]);
  const [receivingId, setReceivingId] = useState<string | null>(null);

  // Drill-down: selected purchase (shows PurchaseOrderDetailView instead of the table)
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseHeader | null>(null);
  // Tracks whether the open detail page was reached via the cross-tab
  // initialPurchaseId drill-in (Back should return to that origin) or a
  // plain click on a row in this view's own list (Back should just close).
  const [detailOpenedExternally, setDetailOpenedExternally] = useState(false);
  const refreshSelectedPurchase = (id: string) => {
    getPurchaseById(id).then((purchase) => { if (purchase) setSelectedPurchase(purchase); }).catch(console.error);
  };

  const openPurchaseDetail = (purchase: PurchaseHeader) => {
    setDetailOpenedExternally(false);
    setSelectedPurchase(purchase);
  };

  const handlePurchaseDetailBack = () => {
    if (detailOpenedExternally && onReturnToOrigin) {
      onReturnToOrigin();
    } else {
      setSelectedPurchase(null);
    }
  };

  // Cross-tab drill-in: fetch and open the purchase directly by id
  // (independent of whatever tab/search filter is currently active), then
  // tell the parent it's been handled so switching tabs again doesn't
  // re-trigger it.
  useEffect(() => {
    if (!initialPurchaseId) return;
    CallAPI(() => getPurchaseById(initialPurchaseId), {
      onCompleted: (purchase) => {
        if (purchase) {
          setSelectedPurchase(purchase);
          setDetailOpenedExternally(true);
        }
        onInitialPurchaseHandled?.();
      },
      onError: (err) => { console.error(err); onInitialPurchaseHandled?.(); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPurchaseId]);

  useEffect(() => {
    getVendors().then(setVendors).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
    getSalesOrdersForLinking().then(setSalesLinkOptions).catch(console.error);
  }, []);

  const rawMaterials = useMemo(
    () => materials.filter(m => m.materialType === 'RAW_MATERIAL' && m.status !== 'INACTIVE'),
    [materials]
  );

  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c])),
    [materialCategories]
  );

  const loadPurchases = (tab: PurchaseTab, search: string = '') => {
    setLoading(true);
    CallAPI(() => getPurchases(tab === 'QUOTATION' ? 'QUOTATION' : 'PO', search), {
      onCompleted: (data) => { setPurchases(data); setLoading(false); },
      onError: (err) => { console.error(err); setLoading(false); },
    });
  };

  useEffect(() => {
    loadPurchases(activeTab, searchQuery[activeTab === 'QUOTATION' ? 0 : 1]?.search);
  }, [activeTab]);

  // Debounced search-as-you-type
  const search = useMemo(
    () =>
      debounce((text: string) => {
        loadPurchases(activeTab, text);
      }, 500),
    [activeTab]
  );

  // Quotation print modal
  const [selectedQuotation, setSelectedQuotation] = useState<PurchaseHeader | null>(null);
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);

  // Form dialog state
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('CREATE');
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [formVendorId, setFormVendorId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState('');
  const [formSalesHeaderId, setFormSalesHeaderId] = useState('');
  const [formDetails, setFormDetails] = useState<PurchaseDetailInput[]>([]);
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(10);
  const [tempUnitCost, setTempUnitCost] = useState(0);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);
  const [requiredMaterials, setRequiredMaterials] = useState<SalesOrderMaterialRequirement[]>([]);

  useEffect(() => {
    if (!formSalesHeaderId) { setRequiredMaterials([]); return; }
    getSalesOrderMaterialRequirements(formSalesHeaderId).then(setRequiredMaterials).catch(console.error);
  }, [formSalesHeaderId]);

  const resetForm = () => {
    setEditHeaderId(null);
    setFormVendorId('');
    setFormOrderDate('');
    setFormSalesHeaderId('');
    setFormDetails([]);
    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
    setFormAttachment(undefined);
  };

  const clearTempMaterials = () => {
    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
  };

  const todayStr = () => new Date().toISOString().split('T')[0];

  const openCreateForm = () => {
    resetForm();
    setFormMode('CREATE');
    setShowFormDialog(true);
  };

  const detailsFromHeader = (purchase: PurchaseHeader): PurchaseDetailInput[] =>
    purchase.details.map(d => ({
      materialId: d.materialId,
      materialName: d.materialName,
      materialCode: d.materialCode,
      quantity: d.quantity,
      unitCost: d.unitCost,
      totalPrice: d.totalPrice,
    }));

  const openEditForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('EDIT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormSalesHeaderId(purchase.salesHeaderId || '');
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setShowFormDialog(true);
  };

  const openConvertForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('CONVERT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormSalesHeaderId(purchase.salesHeaderId || '');
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setFormOrderDate(todayStr());
    setShowFormDialog(true);
  };

  // Material catalog rows carry no per-vendor unit cost, so selecting a
  // material doesn't prefill a price — the buyer types the quoted cost.
  const handleMaterialSelect = (materialId: string) => setTempMaterialId(materialId);

  const handleAddTempItem = () => {
    if (!tempMaterialId || tempQuantity <= 0) return;
    const material = rawMaterials.find(m => m.id === tempMaterialId);
    if (!material) return;

    const existingIdx = formDetails.findIndex(d => d.materialId === tempMaterialId);
    if (existingIdx !== -1) {
      const updated = [...formDetails];
      updated[existingIdx].quantity += tempQuantity;
      updated[existingIdx].totalPrice = updated[existingIdx].quantity * updated[existingIdx].unitCost;
      setFormDetails(updated);
    } else {
      setFormDetails([...formDetails, {
        materialId: tempMaterialId,
        materialName: material.name,
        materialCode: material.code,
        quantity: tempQuantity,
        unitCost: tempUnitCost,
        totalPrice: tempQuantity * tempUnitCost,
      }]);
    }

    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormDetails(formDetails.filter((_, idx) => idx !== index));
  };

  const handleUpdateFormItemQuantity = (index: number, quantity: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, quantity, totalPrice: quantity * d.unitCost } : d));
  };

  const handleUpdateFormItemUnitCost = (index: number, unitCost: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, unitCost, totalPrice: d.quantity * unitCost } : d));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formVendorId) return;

    let finalDetails = [...formDetails];
    if (tempMaterialId && tempQuantity > 0) {
      const material = rawMaterials.find(m => m.id === tempMaterialId);
      if (material) {
        const existingIdx = finalDetails.findIndex(d => d.materialId === tempMaterialId);
        if (existingIdx !== -1) {
          finalDetails[existingIdx].quantity += tempQuantity;
          finalDetails[existingIdx].totalPrice = finalDetails[existingIdx].quantity * finalDetails[existingIdx].unitCost;
        } else {
          finalDetails.push({
            materialId: tempMaterialId,
            materialName: material.name,
            materialCode: material.code,
            quantity: tempQuantity,
            unitCost: tempUnitCost,
            totalPrice: tempQuantity * tempUnitCost,
          });
        }
      }
    }

    if (finalDetails.length === 0) {
      toast.warning('Please add at least one material item to this purchase.');
      return;
    }

    const input = {
      vendorId: formVendorId,
      salesHeaderId: formSalesHeaderId || undefined,
      attachments: formAttachment ? [formAttachment] : [],
      details: finalDetails,
    };

    if (formMode === 'CREATE') {
      await CallAPI(() => createPurchaseQuotation(input), {
        onCompleted: () => { loadPurchases(activeTab); toast.success('Purchase quotation created.'); },
        onError: (err) => { console.error(err); toast.error('Failed to create purchase quotation.'); },
      });
    } else if (formMode === 'EDIT' && editHeaderId) {
      await CallAPI(() => updatePurchase(editHeaderId, input), {
        onCompleted: () => { loadPurchases(activeTab); refreshSelectedPurchase(editHeaderId); toast.success('Purchase updated.'); },
        onError: (err) => { console.error(err); toast.error('Failed to update purchase.'); },
      });
    } else if (formMode === 'CONVERT' && editHeaderId) {
      await CallAPI(() => convertToPurchaseOrder(editHeaderId, input, formOrderDate || todayStr()), {
        onCompleted: () => { loadPurchases(activeTab); refreshSelectedPurchase(editHeaderId); toast.success('Purchase order confirmed.'); },
        onError: (err) => { console.error(err); toast.error('Failed to confirm purchase order.'); },
      });
    }

    setShowFormDialog(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm('Are you sure you want to delete this purchase?'))) return;
    await CallAPI(() => deletePurchase(id), {
      onCompleted: () => {
        loadPurchases(activeTab);
        setSelectedPurchase((prev) => (prev?.id === id ? null : prev));
        toast.success('Purchase deleted.');
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete purchase.'); },
    });
  };

  const handleReceive = async (purchase: PurchaseHeader) => {
    if (receivingId === purchase.id) return;
    setReceivingId(purchase.id);
    await CallAPI(() => receivePurchaseOrder(purchase), {
      onCompleted: () => {
        setReceivingId(null);
        loadPurchases(activeTab);
        refreshSelectedPurchase(purchase.id);
        toast.success('Material package marked as received.');
      },
      onError: (err) => {
        setReceivingId(null);
        console.error(err);
        toast.error('Failed to mark purchase as received.');
      },
    });
  };

  const handleCancel = async (id: string) => {
    if (!(await confirm('Cancel this Purchase Order?', { title: 'Cancel Purchase Order' }))) return;
    await CallAPI(() => cancelPurchaseOrder(id), {
      onCompleted: () => { loadPurchases(activeTab); refreshSelectedPurchase(id); toast.success('Purchase order cancelled.'); },
      onError: (err) => { console.error(err); toast.error('Failed to cancel purchase order.'); },
    });
  };

  const openQuotationDoc = (purchase: PurchaseHeader) => {
    setSelectedQuotation(purchase);
    setIsQuotationModalOpen(true);
  };

  const dialogTitle = formMode === 'CREATE' ? 'Create Material Purchase Quotation'
    : formMode === 'EDIT' ? 'Edit Material Purchase Quotation'
      : 'Confirm Purchase Order';

  const submitLabel = formMode === 'CREATE' ? 'Save Quotation'
    : formMode === 'EDIT' ? 'Update Quotation'
      : 'Confirm Purchase Order';

  return (
    <div className="space-y-6" id="purchases-view">
      {loading && <LoadingSpinner message="Verifying supply orders..." subtitle="PURCHASE_ORDERS" />}

      {selectedPurchase ? (
        <PurchaseOrderDetailView
          purchase={selectedPurchase}
          onBack={handlePurchaseDetailBack}
          backLabel={detailOpenedExternally ? 'Back to Material' : 'Back to Purchases'}
          receivingId={receivingId}
          onEdit={openEditForm}
          onConvert={openConvertForm}
          onDelete={handleDelete}
          onReceive={handleReceive}
          onCancel={handleCancel}
          onOpenQuotationDoc={openQuotationDoc}
        />
      ) : (
      <>
      {/* Tab toggle + search + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex space-x-1 p-1 bg-slate-100 rounded-lg border border-slate-200/50 self-start">
          <button
            onClick={() => setActiveTab('QUOTATION')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'QUOTATION' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Quotation
          </button>
          <button
            onClick={() => setActiveTab('PO')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'PO' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Purchase Order
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <SearchInput
            value={searchQuery?.[activeTab === 'QUOTATION' ? 0 : 1]?.search}
            onChange={(e: any) => {
              setSearchQuery((prev) => {
                const updated = [...prev];
                const index = activeTab === "QUOTATION" ? 0 : 1;

                updated[index] = {
                  ...updated[index],
                  search: e,
                };

                return updated;
              });
              search(e)
            }}
            placeholder="Search by supplier or reference no..."
          />
          {activeTab === 'QUOTATION' && (
            <button
              onClick={openCreateForm}
              className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New Quotation</span>
            </button>
          )}
        </div>
      </div>

      {/* Creation/Edit/Convert form as Dialog Modal */}
      <Dialog
        open={showFormDialog}
        onClose={() => { clearTempMaterials(); setShowFormDialog(false); }}
        title={dialogTitle}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

            <FormField label="Select Vendor *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <ComboBox
                required
                value={formVendorId}
                onChange={setFormVendorId}
                noneLabel="-- Select Vendor --"
                options={vendors.map(v => ({ value: v.id, label: v.companyName, sublabel: v.officeNo || v.email }))}
              />
            </FormField>

            <FormField label="Linked Sales Order (Optional)" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <ComboBox
                value={formSalesHeaderId}
                onChange={setFormSalesHeaderId}
                noneLabel="-- No Linked Sales Order --"
                options={salesLinkOptions.map(s => ({ value: s.id, label: s.salesNo, sublabel: s.clientName }))}
              />
            </FormField>

            {formSalesHeaderId && requiredMaterials.length > 0 && (
              <div className="sm:col-span-2 border border-indigo-100 rounded-lg p-3 bg-indigo-50/40 space-y-1.5">
                <span className="font-semibold block text-[11px] text-indigo-900">Required Materials for Linked Sales Order</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                  {requiredMaterials.map(r => (
                    <div key={r.materialId} className="flex justify-between text-[11px] text-indigo-800 font-mono bg-white/60 rounded px-2 py-1">
                      <span>{r.materialName}</span>
                      <span>{r.requiredQuantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {formMode === 'CONVERT' && (
              <FormField label="Order Date *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
                <input
                  type="date"
                  required
                  value={formOrderDate}
                  onChange={(e) => setFormOrderDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                />
              </FormField>
            )}

            <div className="sm:col-span-2 border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
              <span className="font-semibold block text-slate-700 text-xs">Materials to Procure ({formDetails.length})</span>
              {formDetails.length === 0 ? (
                <div className="text-center py-4 text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white text-[11px]">
                  No materials added yet. Specify material details below to add items.
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
                      {formDetails.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 font-semibold text-slate-800">{item.materialName}</td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleUpdateFormItemQuantity(idx, Number(e.target.value))}
                              className="w-20 px-1.5 py-1 bg-white border border-slate-200 rounded text-right font-mono text-[11px] focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitCost}
                              onChange={(e) => handleUpdateFormItemUnitCost(idx, Number(e.target.value))}
                              className="w-24 px-1.5 py-1 bg-white border border-slate-200 rounded text-right font-mono text-[11px] focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="p-2 text-right font-mono font-semibold">RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-2 text-center">
                            <button type="button" onClick={() => handleRemoveFormItem(idx)} className="text-red-500 hover:text-red-700 p-1" title="Remove item">
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

            <div className="sm:col-span-2 border border-blue-100 rounded-lg p-4 bg-blue-50/20 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <FormField label="Material Selection" labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider" colSpan="sm:col-span-6">
                <ComboBox
                  value={tempMaterialId}
                  onChange={handleMaterialSelect}
                  noneLabel="-- Choose Material --"
                  options={rawMaterials.map(m => {
                    const category = materialCategoryMap.get(m.materialCategoryId || '');
                    return { value: m.id, label: m.name, sublabel: category ? category.name : `Stock: ${m.quantity}` };
                  })}
                />
              </FormField>

              <FormField label="Quantity" labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                <input
                  type="number"
                  min="1"
                  value={tempQuantity}
                  onChange={(e) => setTempQuantity(Number(e.target.value))}
                  disabled={!formVendorId}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800 disabled:bg-slate-50"
                />
              </FormField>

              <FormField label="Unit Cost (RM)" labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tempUnitCost}
                  onChange={(e) => setTempUnitCost(Number(e.target.value))}
                  disabled={!formVendorId}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800 disabled:bg-slate-50"
                />
              </FormField>

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddTempItem}
                  disabled={!formVendorId || !tempMaterialId || tempQuantity <= 0}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  + Add Item
                </button>
              </div>
            </div>

            <div className="bg-amber-50 rounded-lg p-3 sm:col-span-2 flex items-center justify-between border border-amber-100">
              <div>
                <span className="font-semibold block text-[11px] text-amber-900">Total Purchase Cost:</span>
                <span className="text-[10px] text-amber-700 font-sans">Payment will be logged under company material costs.</span>
              </div>
              <div className="font-mono text-base font-bold text-amber-950">
                RM {Math.max(0, formDetails.reduce((sum, item) => sum + item.totalPrice, 0) + (tempMaterialId && tempQuantity > 0 ? tempQuantity * tempUnitCost : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          <DialogFooter>
            <DialogCancelButton onClick={() => { clearTempMaterials(); setShowFormDialog(false); }} />
            <DialogSubmitButton>{submitLabel}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Listing table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <th className="p-4">Reference</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">Material Details</th>
                <th className="p-4">{activeTab === 'QUOTATION' ? 'Quotation Date' : 'Order Date'}</th>
                <th className="p-4">Total Cost</th>
                {activeTab === 'PO' && <th className="p-4">Status</th>}
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'PO' ? 7 : 6} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No {activeTab === 'QUOTATION' ? 'quotations' : 'purchase orders'} logged yet.
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id} className="group hover:bg-slate-50/50 transition-colors">

                    <td className="p-4 font-mono font-semibold text-slate-900">{p.purchaseNo}</td>
                    <td className="p-4 font-semibold text-slate-900">{p.vendorName}</td>

                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="space-y-1 max-w-xs">
                          {p.details.map((item, idx) => (
                            <div key={item.detailId || idx} className="flex flex-col border-b border-slate-100 last:border-none pb-1 last:pb-0">
                              <span className="font-semibold text-slate-800">{item.materialName}</span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                Qty: {item.quantity} @ RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                        </div>
                        {p.attachments?.[0] && (
                          <div className="pt-1.5 flex items-center">
                            <a
                              href={p.attachments[0].dataUrl}
                              download={p.attachments[0].name}
                              className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                              title="Download attachment"
                            >
                              <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                              <span className="truncate max-w-[120px]">{p.attachments[0].name}</span>
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center space-x-1.5 text-slate-600 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{activeTab === 'QUOTATION' ? p.quotationDate : p.orderDate}</span>
                      </div>
                    </td>

                    <td className="p-4 font-mono font-semibold text-slate-900">
                      RM {p.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {activeTab === 'PO' && (
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-medium border ${p.status === 'ORDERED' ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : p.status === 'RECEIVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-red-50 text-red-800 border-red-200'
                          }`}>
                          {p.status === 'ORDERED' ? 'Pending Stock' : p.status}
                        </span>
                      </td>
                    )}

                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <button onClick={() => openPurchaseDetail(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="View">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {p.status === 'QUOTATION' && (
                          <>
                            <button onClick={() => openEditForm(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openQuotationDoc(p)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors" title="Generate Quotation">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openConvertForm(p)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="Proceed to Purchase Order">
                              <ArrowRightCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {p.status === 'ORDERED' && (
                          <>
                            <button onClick={() => openEditForm(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleReceive(p)}
                              disabled={receivingId === p.id}
                              title="Mark material package as received"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleCancel(p.id)} className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors text-[10px] font-medium">
                              Cancel
                            </button>
                          </>
                        )}

                        {p.status === 'RECEIVED' && (
                          <div className="text-[10px] text-emerald-600 font-semibold flex items-center space-x-0.5 font-mono px-1.5">
                            <span className="px-2 py-0.5 bg-emerald-50 rounded">Replenished ✓</span>
                          </div>
                        )}

                        {p.status === 'CANCELLED' && (
                          <>
                            <span className="text-[10px] text-slate-400 font-mono italic px-1.5">Cancelled</span>
                            <button onClick={() => handleDelete(p.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      )}

      <QuotationModal
        purchase={selectedQuotation}
        isOpen={isQuotationModalOpen}
        onClose={() => { setIsQuotationModalOpen(false); setSelectedQuotation(null); }}
      />

    </div>
  );
}

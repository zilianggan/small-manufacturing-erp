/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  getSalesOrders, createSalesQuotation, updateSalesOrder, convertToSalesOrder,
  startProduction, confirmProductionDone, markDelivered, cancelSalesOrder, deleteSalesOrder,
  getSalesOrderById,
  SalesDetailInput, MaterialUsageInput, MaterialReconciliationInput, LeftoverMaterialInput, ExtraProducedInput,
  SalesFilters, SalesSortField, SortDir,
} from '../services/OrdersService';
import { getProducts } from '../services/ProductService';
import { getMaterials } from '../services/MaterialService';
import { getMaterialCategories } from '../services/SystemAdminService';
import { getClients } from '../services/ContactsService';
import { SalesHeader, Client, Product, Material, MaterialCategory, Attachment } from '../types';
import { Plus, Calendar, Check, CheckCheck, Factory, Paperclip, Trash2, Edit, FileText, ArrowRightCircle, Eye, Filter } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import SalesQuotationModal from './SalesQuotationModal';
import InvoiceModal from './InvoiceModal';
import ProductionCompletionModal from './ProductionCompletionModal';
import SalesOrderDetailView from './SalesOrderDetailView';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import FilterDialog from './FilterDialog';
import SortableTh from './SortableTh';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, SearchInput, useToast, useConfirm, ActionsMenu } from './ui';
import { CallAPI } from './UIHelper';
import { debounce } from 'lodash'

type OrderTab = 'QUOTATION' | 'SO';
type FormMode = 'CREATE' | 'EDIT' | 'CONVERT';

interface OrdersViewProps {
  // Cross-tab drill-in: ProductDetailView.tsx's/MaterialDetailView.tsx's
  // inventory list links here via App.tsx passing a pending sales header id,
  // since Orders/Product/Material are separate top-level tabs with no shared
  // router.
  initialOrderId?: string | null;
  onInitialOrderHandled?: () => void;
  // Which detail page the cross-tab drill-in came from — a material row can
  // link here too (production consumption against this sale) — used only to
  // word the detail page's Back button correctly.
  initialOrderOrigin?: 'PRODUCT' | 'MATERIAL' | 'INVENTORY';
  // Called instead of closing locally when the currently open detail page
  // was reached via that cross-tab drill-in — lets App.tsx send the user
  // back to the originating Product/Material detail page rather than this list.
  onReturnToOrigin?: () => void;
}

export default function OrdersView({ initialOrderId, onInitialOrderHandled, initialOrderOrigin, onReturnToOrigin }: OrdersViewProps = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<OrderTab>('QUOTATION');
  const [searchQuery, setSearchQuery] = useState([{ search: '' }, { search: '' }]);
  const [orders, setOrders] = useState<SalesHeader[]>([]);
  const [loading, setLoading] = useState(true);

  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [completingOrder, setCompletingOrder] = useState<SalesHeader | null>(null);

  // Drill-down: selected order (shows SalesOrderDetailView instead of the table)
  const [selectedOrder, setSelectedOrder] = useState<SalesHeader | null>(null);
  // Tracks whether the open detail page was reached via the cross-tab
  // initialOrderId drill-in (Back should return to that origin) or a plain
  // click on a row in this view's own list (Back should just close locally).
  const [detailOpenedExternally, setDetailOpenedExternally] = useState(false);

  const openOrderDetail = (order: SalesHeader) => {
    setDetailOpenedExternally(false);
    setSelectedOrder(order);
  };

  const handleDetailBack = () => {
    if (detailOpenedExternally && onReturnToOrigin) {
      onReturnToOrigin();
    } else {
      setSelectedOrder(null);
    }
  };

  useEffect(() => {
    getClients().then(setClients).catch(console.error);
    getProducts().then(setProducts).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
  }, []);

  // Cross-tab drill-in: fetch and open the order directly by id (independent
  // of whatever tab/search filter is currently active), then tell the parent
  // it's been handled so switching tabs again doesn't re-trigger it.
  useEffect(() => {
    if (!initialOrderId) return;
    CallAPI(() => getSalesOrderById(initialOrderId), {
      onCompleted: (order) => {
        if (order) {
          setSelectedOrder(order);
          setDetailOpenedExternally(true);
        }
        onInitialOrderHandled?.();
      },
      onError: (err) => { console.error(err); onInitialOrderHandled?.(); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderId]);

  const activeProducts = useMemo(
    () => products.filter(p => p.status !== 'INACTIVE'),
    [products]
  );

  const rawMaterials = useMemo(
    () => materials.filter(m => m.materialType === 'RAW_MATERIAL' && m.status !== 'INACTIVE'),
    [materials]
  );

  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c])),
    [materialCategories]
  );

  // ─── Filter dialog: client + product record pickers, date range ─────────
  const [appliedFilters, setAppliedFilters] = useState<SalesFilters>({});
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftClientIds, setFilterDraftClientIds] = useState<string[]>([]);
  const [filterDraftProductIds, setFilterDraftProductIds] = useState<string[]>([]);
  const [filterDraftDateFrom, setFilterDraftDateFrom] = useState('');
  const [filterDraftDateTo, setFilterDraftDateTo] = useState('');
  const [filterClientSearch, setFilterClientSearch] = useState('');
  const [filterProductSearch, setFilterProductSearch] = useState('');

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SalesSortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const loadOrders = (tab: OrderTab, search: string = '') => {
    setLoading(true);
    CallAPI(() => getSalesOrders(tab === 'QUOTATION' ? 'QUOTATION' : 'SO', search, { filters: appliedFilters, sortField, sortDir }), {
      onCompleted: (data) => { setOrders(data); setLoading(false); },
      onError: (err) => { console.error(err); setLoading(false); },
    });
  };

  useEffect(() => {
    loadOrders(activeTab, searchQuery[activeTab === 'QUOTATION' ? 0 : 1]?.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, appliedFilters, sortField, sortDir]);

  // Keeps the open detail page's data in sync after an edit/transition —
  // loadOrders() only refreshes the list underneath it.
  const refreshSelectedOrder = (id: string) => {
    getSalesOrderById(id).then((order) => { if (order) setSelectedOrder(order); }).catch(console.error);
  };

  const search = useMemo(
    () =>
      debounce((text: string) => {
        loadOrders(activeTab, text);
      }, 500),
    [activeTab, appliedFilters, sortField, sortDir]
  );

  const openFilterDialog = () => {
    setFilterDraftClientIds(appliedFilters.clientIds || []);
    setFilterDraftProductIds(appliedFilters.productIds || []);
    setFilterDraftDateFrom(appliedFilters.dateFrom || '');
    setFilterDraftDateTo(appliedFilters.dateTo || '');
    setFilterClientSearch('');
    setFilterProductSearch('');
    setShowFilterDialog(true);
  };

  const toggleFilterDraftClient = (id: string) => {
    setFilterDraftClientIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  const toggleFilterDraftProduct = (id: string) => {
    setFilterDraftProductIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const filterClientItems = useMemo(() => {
    const q = filterClientSearch.trim().toLowerCase();
    return clients
      .filter(c => !q || c.companyName.toLowerCase().includes(q))
      .map(c => ({ id: c.id, label: c.companyName }));
  }, [clients, filterClientSearch]);

  const filterProductItems = useMemo(() => {
    const q = filterProductSearch.trim().toLowerCase();
    return products
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
      .map(p => ({ id: p.id, label: p.name, sublabel: p.code }));
  }, [products, filterProductSearch]);

  const hasActiveFilters = !!(appliedFilters.clientIds?.length || appliedFilters.productIds?.length || appliedFilters.dateFrom || appliedFilters.dateTo);

  const toggleSort = (key: SalesSortField) => {
    if (key === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(key); setSortDir('asc'); }
  };

  // Quotation print modal
  const [selectedQuotation, setSelectedQuotation] = useState<SalesHeader | null>(null);
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);

  // Tax invoice print modal
  const [selectedInvoiceOrder, setSelectedInvoiceOrder] = useState<SalesHeader | null>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);

  // Form dialog state
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('CREATE');
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [formClientId, setFormClientId] = useState('');
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formDetails, setFormDetails] = useState<SalesDetailInput[]>([]);
  const [tempProductId, setTempProductId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);
  const [tempUnitPrice, setTempUnitPrice] = useState(0);
  const [tempMaterials, setTempMaterials] = useState<MaterialUsageInput[]>([]);
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempMaterialQty, setTempMaterialQty] = useState(1);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);

  // Clears the pending (not-yet-committed) product+material staging fields.
  // Mirrors PurchasesView.tsx's clearTempMaterials — without this, values
  // typed into the "add item" panel leak into the next form open.
  const clearTempStaging = () => {
    setTempProductId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
    setTempMaterials([]);
    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const resetForm = () => {
    setEditHeaderId(null);
    setFormClientId('');
    setFormDeliveryDate('');
    setFormRemark('');
    setFormDetails([]);
    setFormAttachment(undefined);
    clearTempStaging();
  };

  const todayStr = () => new Date().toISOString().split('T')[0];
  const defaultDeliveryDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  };

  const openCreateForm = () => {
    resetForm();
    setFormMode('CREATE');
    setShowFormDialog(true);
  };

  const detailsFromHeader = (order: SalesHeader): SalesDetailInput[] =>
    order.details.map(d => ({
      productId: d.productId,
      productName: d.productName,
      productCode: d.productCode,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      product: d.product,
      totalPrice: d.totalPrice,
      materials: d.materials.map(m => ({
        materialId: m.materialId,
        materialName: m.materialName,
        materialCode: m.materialCode,
        plannedQuantity: m.plannedQuantity,
      })),
    }));

  const openEditForm = (order: SalesHeader) => {
    clearTempStaging();
    setFormMode('EDIT');
    setEditHeaderId(order.id);
    setFormClientId(order.clientId);
    setFormRemark(order.remark || '');
    setFormAttachment(order.attachments?.[0]);
    setFormDetails(detailsFromHeader(order));
    setShowFormDialog(true);
  };

  const openConvertForm = (order: SalesHeader) => {
    clearTempStaging();
    setFormMode('CONVERT');
    setEditHeaderId(order.id);
    setFormClientId(order.clientId);
    setFormRemark(order.remark || '');
    setFormAttachment(order.attachments?.[0]);
    setFormDetails(detailsFromHeader(order));
    setFormDeliveryDate(defaultDeliveryDate());
    setShowFormDialog(true);
  };

  // Product catalog rows carry a sellingPrice, so selecting a product
  // prefills the quoted unit price — the seller can still override it.
  const handleProductSelect = (productId: string) => {
    setTempProductId(productId);
    const product = activeProducts.find(p => p.id === productId);
    if (product) setTempUnitPrice(product.sellingPrice);
  };

  const handleAddTempMaterial = () => {
    if (!tempMaterialId || tempMaterialQty <= 0) return;
    const material = rawMaterials.find(m => m.id === tempMaterialId);
    if (!material) return;

    const existingIdx = tempMaterials.findIndex(m => m.materialId === tempMaterialId);
    if (existingIdx !== -1) {
      const updated = [...tempMaterials];
      updated[existingIdx].plannedQuantity += tempMaterialQty;
      setTempMaterials(updated);
    } else {
      setTempMaterials([...tempMaterials, {
        materialId: tempMaterialId,
        materialName: material.name,
        materialCode: material.code,
        plannedQuantity: tempMaterialQty,
      }]);
    }

    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const handleRemoveTempMaterial = (index: number) => {
    setTempMaterials(tempMaterials.filter((_, idx) => idx !== index));
  };

  const handleAddTempItem = () => {
    if (!tempProductId || tempQuantity <= 0) return;
    const product = activeProducts.find(p => p.id === tempProductId);
    if (!product) return;

    setFormDetails([...formDetails, {
      productId: tempProductId,
      productName: product.name,
      productCode: product.code,
      quantity: tempQuantity,
      unitPrice: tempUnitPrice,
      totalPrice: tempQuantity * tempUnitPrice,
      materials: tempMaterials,
    }]);

    setTempProductId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
    setTempMaterials([]);
    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormDetails(formDetails.filter((_, idx) => idx !== index));
  };

  const handleUpdateFormItemQuantity = (index: number, quantity: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, quantity, totalPrice: quantity * d.unitPrice } : d));
  };

  const handleUpdateFormItemUnitPrice = (index: number, unitPrice: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, unitPrice, totalPrice: d.quantity * unitPrice } : d));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId) return;

    // Check if there's a pending product line selected but not added yet, and
    // automatically add it (same convention as the material-add panel in
    // PurchasesView.tsx).
    let finalDetails = [...formDetails];
    if (tempProductId && tempQuantity > 0) {
      const product = activeProducts.find(p => p.id === tempProductId);
      if (product) {
        finalDetails.push({
          productId: tempProductId,
          productName: product.name,
          productCode: product.code,
          quantity: tempQuantity,
          unitPrice: tempUnitPrice,
          totalPrice: tempQuantity * tempUnitPrice,
          materials: tempMaterials,
        });
      }
    }

    if (finalDetails.length === 0) {
      toast.warning('Please add at least one product item to this sales contract.');
      return;
    }

    const input = {
      clientId: formClientId,
      remark: formRemark || undefined,
      attachments: formAttachment ? [formAttachment] : [],
      details: finalDetails,
    };

    if (formMode === 'CREATE') {
      await CallAPI(() => createSalesQuotation(input), {
        onCompleted: () => { loadOrders(activeTab); toast.success('Sales quotation created.'); },
        onError: (err) => { console.error(err); toast.error('Failed to create sales quotation.'); },
      });
    } else if (formMode === 'EDIT' && editHeaderId) {
      await CallAPI(() => updateSalesOrder(editHeaderId, input), {
        onCompleted: () => { loadOrders(activeTab); refreshSelectedOrder(editHeaderId); toast.success('Sales order updated.'); },
        onError: (err) => { console.error(err); toast.error('Failed to update sales order.'); },
      });
    } else if (formMode === 'CONVERT' && editHeaderId) {
      await CallAPI(() => convertToSalesOrder(editHeaderId, input, formDeliveryDate || defaultDeliveryDate()), {
        onCompleted: () => { loadOrders(activeTab); setSelectedOrder(null); toast.success('Sales order confirmed.'); },
        onError: (err) => { console.error(err); toast.error('Failed to confirm sales order.'); },
      });
    }

    setShowFormDialog(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm('Are you sure you want to delete this sales order?'))) return;
    await CallAPI(() => deleteSalesOrder(id), {
      onCompleted: () => {
        loadOrders(activeTab);
        setSelectedOrder((prev) => (prev?.id === id ? null : prev));
        toast.success('Sales order deleted.');
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete sales order.'); },
    });
  };

  const handleStartProduction = async (order: SalesHeader) => {
    if (transitioningId === order.id) return;
    setTransitioningId(order.id);
    await CallAPI(() => startProduction(order), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
        setSelectedOrder(null);
        toast.success('Production started.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to start production.');
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
        loadOrders(activeTab);
        setSelectedOrder(null);
        setCompletingOrder(null);
        toast.success('Production marked as done.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to complete production.');
      },
    });
  };

  const handleMarkDelivered = async (id: string) => {
    if (transitioningId === id) return;
    setTransitioningId(id);
    await CallAPI(() => markDelivered(id), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
        setSelectedOrder(null);
        toast.success('Order marked as delivered.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to mark order as delivered.');
      },
    });
  };

  const handleCancel = async (order: SalesHeader) => {
    if (!(await confirm('Cancel this Sales Order?', { title: 'Cancel Sales Order' }))) return;
    await CallAPI(() => cancelSalesOrder(order), {
      onCompleted: () => { loadOrders(activeTab); refreshSelectedOrder(order.id); toast.success('Sales order cancelled.'); },
      onError: (err) => { console.error(err); toast.error('Failed to cancel sales order.'); },
    });
  };

  const openQuotationDoc = (order: SalesHeader) => {
    setSelectedQuotation(order);
    setIsQuotationModalOpen(true);
  };

  const openInvoiceDoc = (order: SalesHeader) => {
    setSelectedInvoiceOrder(order);
    setIsInvoiceOpen(true);
  };

  const dialogTitle = formMode === 'CREATE' ? 'Create Sales Quotation'
    : formMode === 'EDIT' ? 'Edit Sales Quotation'
      : 'Confirm Sales Order';

  const submitLabel = formMode === 'CREATE' ? 'Save Quotation'
    : formMode === 'EDIT' ? 'Update Quotation'
      : 'Confirm Sales Order';

  return (
    <div className="space-y-6" id="orders-view">
      {loading && <LoadingSpinner message="Processing sales contracts..." subtitle="SALES_CONTRACTS" />}

      {selectedOrder ? (
        <SalesOrderDetailView
          order={selectedOrder}
          onBack={handleDetailBack}
          backLabel={detailOpenedExternally ? (initialOrderOrigin === 'MATERIAL' ? 'Back to Material' : initialOrderOrigin === 'INVENTORY' ? 'Back to Inventory' : 'Back to Product') : 'Back to Sales Contracts'}
          transitioningId={transitioningId}
          onEdit={openEditForm}
          onConvert={openConvertForm}
          onDelete={handleDelete}
          onStartProduction={handleStartProduction}
          onProductionCompletion={openProductionCompletion}
          onMarkDelivered={handleMarkDelivered}
          onCancel={handleCancel}
          onOpenQuotationDoc={openQuotationDoc}
          onOpenInvoiceDoc={openInvoiceDoc}
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
            onClick={() => setActiveTab('SO')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'SO' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Sales Order
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
            placeholder="Search by client or reference no..."
          />
          <button
            onClick={openFilterDialog}
            className={`relative flex items-center space-x-1.5 px-3 py-2 border rounded-lg text-xs font-medium transition-colors ${hasActiveFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter</span>
            {hasActiveFilters && <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-600 rounded-full" />}
          </button>
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

      {/* Filter dialog */}
      <FilterDialog
        open={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        title="Filter Sales Contracts"
        sections={[
          {
            type: 'checklist',
            key: 'clients',
            label: 'Client',
            searchPlaceholder: 'Search clients...',
            searchQuery: filterClientSearch,
            onSearchChange: setFilterClientSearch,
            items: filterClientItems,
            selectedIds: filterDraftClientIds,
            onToggle: toggleFilterDraftClient,
          },
          {
            type: 'checklist',
            key: 'products',
            label: 'Product',
            searchPlaceholder: 'Search products...',
            searchQuery: filterProductSearch,
            onSearchChange: setFilterProductSearch,
            items: filterProductItems,
            selectedIds: filterDraftProductIds,
            onToggle: toggleFilterDraftProduct,
          },
          {
            type: 'dateRange',
            key: 'dateRange',
            label: activeTab === 'QUOTATION' ? 'Order Date Range' : 'Delivery Date Range',
            from: filterDraftDateFrom,
            to: filterDraftDateTo,
            onFromChange: setFilterDraftDateFrom,
            onToChange: setFilterDraftDateTo,
          },
        ]}
        onApply={() => setAppliedFilters({
          clientIds: filterDraftClientIds,
          productIds: filterDraftProductIds,
          dateFrom: filterDraftDateFrom || undefined,
          dateTo: filterDraftDateTo || undefined,
        })}
        onClear={() => {
          setFilterDraftClientIds([]); setFilterDraftProductIds([]);
          setFilterDraftDateFrom(''); setFilterDraftDateTo('');
          setAppliedFilters({});
        }}
      />

      {/* Creation/Edit/Convert form as Dialog Modal */}
      <Dialog
        open={showFormDialog}
        onClose={() => { clearTempStaging(); setShowFormDialog(false); }}
        title={dialogTitle}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

            <FormField label="Client Company *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <ComboBox
                required
                value={formClientId}
                onChange={setFormClientId}
                noneLabel="-- Select Client --"
                options={clients.map(c => ({ value: c.id, label: c.companyName, sublabel: c.officeNo || c.email }))}
              />
            </FormField>

            {formMode === 'CONVERT' && (
              <FormField label="Delivery Date *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
                <input
                  type="date"
                  required
                  value={formDeliveryDate}
                  onChange={(e) => setFormDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                />
              </FormField>
            )}

            {/* Contract Line Items (products, each with its own nested material list) */}
            <div className="sm:col-span-2 border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
              <span className="font-semibold block text-slate-700 text-xs">Contract Line Items ({formDetails.length})</span>
              {formDetails.length === 0 ? (
                <div className="text-center py-4 text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white text-[11px]">
                  No items added yet. Specify product details below to add items to this contract.
                </div>
              ) : (
                <div className="space-y-2">
                  {formDetails.map((item, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg bg-white p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-slate-800 text-[11px] flex-1">{item.productName}</span>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                          <span>Qty:</span>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleUpdateFormItemQuantity(idx, Number(e.target.value))}
                            className="w-14 px-1.5 py-1 bg-white border border-slate-200 rounded text-right font-mono text-[11px] focus:outline-none focus:border-blue-500"
                          />
                          <span>@ RM</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => handleUpdateFormItemUnitPrice(idx, Number(e.target.value))}
                            className="w-20 px-1.5 py-1 bg-white border border-slate-200 rounded text-right font-mono text-[11px] focus:outline-none focus:border-blue-500"
                          />
                          <span>= RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <button type="button" onClick={() => handleRemoveFormItem(idx)} className="text-red-500 hover:text-red-700 p-1 shrink-0" title="Remove line item">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {item.materials.length > 0 && (
                        <div className="mt-2 pl-3 border-l-2 border-slate-100 space-y-0.5">
                          {item.materials.map((m, midx) => (
                            <div key={midx} className="text-[10px] text-slate-500 font-mono">
                              {m.materialName} — planned {m.plannedQuantity}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inline Add Product Panel */}
            <div className="sm:col-span-2 border border-blue-100 rounded-lg p-4 bg-blue-50/20 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <FormField
                label="Product Selection"
                labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider"
                colSpan="sm:col-span-6"
              >
                <ComboBox
                  value={tempProductId}
                  onChange={handleProductSelect}
                  noneLabel="-- Choose Product --"
                  options={activeProducts.map(p => ({ value: p.id, label: p.name, sublabel: `RM ${p.sellingPrice.toLocaleString('en-US')}` }))}
                />
              </FormField>

              <FormField
                label="Quantity"
                labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider"
                colSpan="sm:col-span-2"
              >
                <input
                  type="number"
                  min="1"
                  value={tempQuantity}
                  onChange={(e) => setTempQuantity(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
                />
              </FormField>

              <FormField
                label="Unit Price (RM)"
                labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider"
                colSpan="sm:col-span-2"
              >
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={tempUnitPrice}
                  onChange={(e) => setTempUnitPrice(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
                />
              </FormField>

              {/* Materials for this line — staged until "+ Add Item" commits the whole line */}
              <div className="sm:col-span-12 border border-emerald-100 rounded-lg p-3 bg-emerald-50/20 space-y-2">
                <span className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Materials for this line ({tempMaterials.length})</span>
                {tempMaterials.length > 0 && (
                  <div className="space-y-1">
                    {tempMaterials.map((m, midx) => (
                      <div key={midx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1">
                        <span className="text-[10px] text-slate-700">{m.materialName} — planned {m.plannedQuantity}</span>
                        <button type="button" onClick={() => handleRemoveTempMaterial(midx)} className="text-red-500 hover:text-red-700 p-0.5" title="Remove material">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                  <div className="sm:col-span-7">
                    <ComboBox
                      value={tempMaterialId}
                      onChange={setTempMaterialId}
                      noneLabel="-- Choose Material --"
                      options={rawMaterials.map(m => {
                        const category = materialCategoryMap.get(m.materialCategoryId || '');
                        return { value: m.id, label: m.name, sublabel: category ? category.name : `Stock: ${m.quantity}` };
                      })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <input
                      type="number"
                      min="1"
                      value={tempMaterialQty}
                      onChange={(e) => setTempMaterialQty(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddTempMaterial}
                      disabled={!tempMaterialId || tempMaterialQty <= 0}
                      className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-semibold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              <div className="sm:col-span-12">
                <button
                  type="button"
                  onClick={handleAddTempItem}
                  disabled={!tempProductId || tempQuantity <= 0}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  + Add Item
                </button>
              </div>
            </div>

            {/* Subtotals Block */}
            <div className="bg-blue-50/70 border border-blue-100 rounded-lg p-3 sm:col-span-2 flex items-center justify-between">
              <div>
                <span className="font-semibold block text-[11px] text-blue-900">Projected Sales Contract Value:</span>
                <span className="text-[10px] text-blue-700">Calculated sum of all added items on this sales contract.</span>
              </div>
              <div className="font-mono text-base font-bold text-blue-900">
                RM {Math.max(0, formDetails.reduce((sum, item) => sum + item.totalPrice, 0) + (tempProductId && tempQuantity > 0 ? tempQuantity * tempUnitPrice : 0)).toLocaleString('en-US')}
              </div>
            </div>

            <FormField label="Remark (Optional)" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <textarea
                value={formRemark}
                onChange={(e) => setFormRemark(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
              />
            </FormField>

            <div className="sm:col-span-2">
              <AttachmentSection
                attachment={formAttachment}
                onAttachmentChange={setFormAttachment}
                label="Signed Contract or Specifications Doc (Optional)"
                helperText="Upload any business contract, product details, or custom design spec (Max 1MB)"
              />
            </div>

          </div>
          <DialogFooter>
            <DialogCancelButton onClick={() => { clearTempStaging(); setShowFormDialog(false); }} />
            <DialogSubmitButton>{submitLabel}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Orders Listing Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <SortableTh label="Contract ID" sortKey="reference" activeKey={sortField} dir={sortDir} onClick={toggleSort} thClassName="p-4" />
                <SortableTh label="Client" sortKey="client" activeKey={sortField} dir={sortDir} onClick={toggleSort} thClassName="p-4" />
                <th className="p-4">Product & Quantity</th>
                <SortableTh label={activeTab === 'QUOTATION' ? 'Order Date' : 'Delivery Due'} sortKey="date" activeKey={sortField} dir={sortDir} onClick={toggleSort} thClassName="p-4" />
                <SortableTh label="Contract Total" sortKey="totalAmount" activeKey={sortField} dir={sortDir} onClick={toggleSort} thClassName="p-4" />
                {activeTab === 'SO' && <th className="p-4">Status</th>}
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'SO' ? 7 : 6} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No {activeTab === 'QUOTATION' ? 'quotations' : 'sales orders'} found matching your search.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="group hover:bg-slate-50/50 transition-colors">

                    {/* Contract ID */}
                    <td className="p-4 font-mono font-semibold text-slate-900">{order.salesNo}</td>

                    {/* Client Company */}
                    <td className="p-4 font-semibold text-slate-900">{order.clientName}</td>

                    {/* Product & Qty */}
                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="space-y-1 max-w-xs">
                          {order.details.map((item, idx) => (
                            <div key={item.detailId || idx} className="flex flex-col border-b border-slate-100 last:border-none pb-1 last:pb-0">
                              <span className="font-semibold text-slate-800">{item.productName}</span>
                              <span className="text-[10px] text-slate-400 font-mono text-slate-500">
                                Qty: {item.quantity} {item.quantity > 1 ? 'units' : 'unit'} @ RM {item.unitPrice}
                              </span>
                            </div>
                          ))}
                        </div>
                        {order.attachments?.[0] && (
                          <div className="pt-1.5 flex items-center">
                            <a
                              href={order.attachments[0].dataUrl}
                              download={order.attachments[0].name}
                              className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                              title="Download attachment"
                            >
                              <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                              <span className="truncate max-w-[120px]">{order.attachments[0].name}</span>
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="p-4">
                      <div className="flex items-center space-x-1.5 text-slate-600 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{activeTab === 'QUOTATION' ? order.orderDate : order.deliveryDate}</span>
                      </div>
                    </td>

                    {/* Contract Value */}
                    <td className="p-4 font-mono font-semibold text-slate-900">
                      RM {order.totalAmount.toLocaleString('en-US')}
                    </td>

                    {/* Status Badge */}
                    {activeTab === 'SO' && (
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-medium border ${order.status === 'ORDERED' ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : order.status === 'IN_PRODUCTION' ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : order.status === 'DONE_IN_PRODUCTION' ? 'bg-violet-50 text-violet-800 border-violet-200'
                              : order.status === 'DELIVERED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-red-50 text-red-800 border-red-200'
                          }`}>
                          {order.status === 'ORDERED' ? 'Pending Production'
                            : order.status === 'IN_PRODUCTION' ? 'In Production'
                              : order.status === 'DONE_IN_PRODUCTION' ? 'Done in Production'
                                : order.status}
                        </span>
                      </td>
                    )}

                    {/* Transition actions */}
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {order.status === 'DELIVERED' && (
                          <span className="text-[10px] text-emerald-600 font-semibold font-mono px-1.5">✓ Delivered</span>
                        )}
                        {order.status === 'CANCELLED' && (
                          <span className="text-[10px] text-slate-400 font-mono italic px-1.5">Cancelled</span>
                        )}
                        <ActionsMenu items={[
                          { label: 'View', icon: <Eye className="w-3.5 h-3.5" />, onClick: () => openOrderDetail(order) },
                          { label: 'Edit', icon: <Edit className="w-3.5 h-3.5" />, onClick: () => openEditForm(order), hidden: !['QUOTATION', 'ORDERED'].includes(order.status) },
                          { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDelete(order.id), danger: true, hidden: !['QUOTATION', 'CANCELLED'].includes(order.status) },
                          { label: 'Generate Quotation', icon: <FileText className="w-3.5 h-3.5" />, onClick: () => openQuotationDoc(order), hidden: order.status !== 'QUOTATION' },
                          { label: 'Proceed to Sales Order', icon: <ArrowRightCircle className="w-3.5 h-3.5" />, onClick: () => openConvertForm(order), hidden: order.status !== 'QUOTATION' },
                          { label: 'Generate Tax Invoice', icon: <FileText className="w-3.5 h-3.5" />, onClick: () => openInvoiceDoc(order), hidden: !['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION', 'DELIVERED'].includes(order.status) },
                          { label: 'Proceed to Production', icon: <Factory className="w-3.5 h-3.5" />, onClick: () => handleStartProduction(order), disabled: transitioningId === order.id, hidden: order.status !== 'ORDERED' },
                          { label: 'Mark Production Done', icon: <CheckCheck className="w-3.5 h-3.5" />, onClick: () => openProductionCompletion(order), disabled: transitioningId === order.id, hidden: order.status !== 'IN_PRODUCTION' },
                          { label: 'Mark as Delivered', icon: <Check className="w-3.5 h-3.5" />, onClick: () => handleMarkDelivered(order.id), disabled: transitioningId === order.id, hidden: order.status !== 'DONE_IN_PRODUCTION' },
                          { label: 'Cancel Order', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleCancel(order), danger: true, hidden: !['ORDERED', 'IN_PRODUCTION'].includes(order.status) },
                        ]} />
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

      {/* Quotation print modal */}
      <SalesQuotationModal
        order={selectedQuotation}
        isOpen={isQuotationModalOpen}
        onClose={() => { setIsQuotationModalOpen(false); setSelectedQuotation(null); }}
      />

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

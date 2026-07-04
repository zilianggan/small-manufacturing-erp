/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { addSalesOrder, getSalesOrders, saveSalesOrders, updateSalesOrderStatus } from '../services/db';
import { useTableData } from '../hooks/useTableData';
import { SalesOrder, Client, InventoryItem, Attachment } from '../types';
import { Plus, Calendar, Check, Play, FileText, Paperclip, Trash2, Edit } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import InvoiceModal from './InvoiceModal';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, SearchInput } from './ui';

export default function OrdersView() {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: ordersData, loading, loadMore, hasMore, loadingMore } = useTableData<SalesOrder>('sales_orders', { search: searchQuery });

  // Client picker — search-as-you-type
  const [clientQuery, setClientQuery] = useState('');
  const { data: clients, loading: clientsSearchLoading } = useTableData<Client>('clients', { search: clientQuery });

  // Finished-goods product picker — search-as-you-type
  const [productQuery, setProductQuery] = useState('');
  const { data: finishedGoods, loading: productsSearchLoading } = useTableData<InventoryItem>('inventory_items', { search: productQuery, filters: { type: 'FINISHED_GOOD' } });

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  useEffect(() => { setOrders(ordersData); }, [ordersData]);

  // Invoice state
  const [selectedInvoiceOrder, setSelectedInvoiceOrder] = useState<SalesOrder | null>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);

  // Form states
  const [formClientId, setFormClientId] = useState('');
  const [formItems, setFormItems] = useState<{ itemId: string; itemName: string; quantity: number; unitPrice: number; totalPrice: number }[]>([]);
  const [tempItemId, setTempItemId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);
  const [tempUnitPrice, setTempUnitPrice] = useState(0);
  const [formDeliveryDays, setFormDeliveryDays] = useState(14); // default 2 weeks
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);

  const resetForm = () => {
    setEditOrderId(null);
    setFormClientId('');
    setFormItems([]);
    setTempItemId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
    setFormDeliveryDays(14);
    setFormAttachment(undefined);
  };

  const handleEditOrder = (order: SalesOrder) => {
    setEditOrderId(order.id);
    setFormClientId(order.clientId);
    setFormAttachment(order.attachments?.[0]);

    // Check if it's the old single item format or new multi-item format
    if (order.items && order.items.length > 0) {
      setFormItems(order.items);
    } else {
      setFormItems([{
        itemId: order.itemId,
        itemName: order.itemName,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        totalPrice: order.totalPrice
      }]);
    }

    // Attempt to reverse calculate delivery days
    const createdDateStr = order.createdAt ? order.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
    const createdDate = new Date(createdDateStr);
    const deliveryDate = new Date(order.deliveryDate);
    const diffTime = Math.abs(deliveryDate.getTime() - createdDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setFormDeliveryDays(diffDays > 0 ? diffDays : 14);

    setShowAddForm(true);
  };

  const handleDeleteOrder = (id: string) => {
    if (confirm("Are you sure you want to delete this order?")) {
      const updated = getSalesOrders().filter(o => o.id !== id);
      saveSalesOrders(updated, undefined, id);
      setOrders(updated);
    }
  };

  // Handle item selection to prefill pricing
  const handleItemSelect = (itemId: string) => {
    setTempItemId(itemId);
    const item = finishedGoods.find(g => g.id === itemId);
    if (item) {
      // Suggest retail price (e.g. 2x cost)
      setTempUnitPrice(item.unitCost * 2);
    }
  };

  const handleAddTempItem = () => {
    if (!tempItemId || tempQuantity <= 0) return;
    const item = finishedGoods.find(g => g.id === tempItemId);
    if (!item) return;

    const existingIdx = formItems.findIndex(i => i.itemId === tempItemId);
    if (existingIdx !== -1) {
      const updated = [...formItems];
      updated[existingIdx].quantity += tempQuantity;
      updated[existingIdx].totalPrice = updated[existingIdx].quantity * updated[existingIdx].unitPrice;
      setFormItems(updated);
    } else {
      setFormItems([...formItems, {
        itemId: tempItemId,
        itemName: item.name,
        quantity: tempQuantity,
        unitPrice: tempUnitPrice,
        totalPrice: tempQuantity * tempUnitPrice
      }]);
    }

    // Reset temp item inputs
    setTempItemId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormItems(formItems.filter((_, idx) => idx !== index));
  };

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId) return;

    // Check if there's a temp item selected but not added yet, and automatically add it
    let finalItems = [...formItems];
    if (tempItemId && tempQuantity > 0) {
      const item = finishedGoods.find(g => g.id === tempItemId);
      if (item) {
        const existingIdx = finalItems.findIndex(i => i.itemId === tempItemId);
        if (existingIdx !== -1) {
          finalItems[existingIdx].quantity += tempQuantity;
          finalItems[existingIdx].totalPrice = finalItems[existingIdx].quantity * finalItems[existingIdx].unitPrice;
        } else {
          finalItems.push({
            itemId: tempItemId,
            itemName: item.name,
            quantity: tempQuantity,
            unitPrice: tempUnitPrice,
            totalPrice: tempQuantity * tempUnitPrice
          });
        }
      }
    }

    if (finalItems.length === 0) {
      alert('Please add at least one product item to this sales contract.');
      return;
    }

    const client = clients.find(c => c.id === formClientId);
    if (!client) return;

    // Calculate delivery date
    const delivery = new Date();
    delivery.setDate(delivery.getDate() + formDeliveryDays);

    const overallQty = finalItems.reduce((sum, item) => sum + item.quantity, 0);

    const newOrderPayload = {
      clientId: client.id,
      clientName: client.companyName,
      itemId: finalItems[0].itemId,
      itemName: finalItems[0].itemName,
      quantity: overallQty,
      unitPrice: finalItems[0].unitPrice,
      deliveryDate: delivery.toISOString().split('T')[0],
      status: 'PENDING' as SalesOrder['status'],
      attachments: formAttachment ? [formAttachment] : [],
      items: finalItems
    };

    if (editOrderId) {
      const allOrders = getSalesOrders();
      const orderIndex = allOrders.findIndex(o => o.id === editOrderId);
      if (orderIndex !== -1) {
        allOrders[orderIndex] = { ...allOrders[orderIndex], ...newOrderPayload };
        saveSalesOrders(allOrders, allOrders[orderIndex]);
      }
    } else {
      addSalesOrder(newOrderPayload);
    }

    setOrders(getSalesOrders()); // refresh list
    setShowAddForm(false);

    // Reset
    resetForm();
  };

  const handleUpdateStatus = (id: string, status: SalesOrder['status']) => {
    updateSalesOrderStatus(id, status);
    setOrders(getSalesOrders()); // refresh list
  };

  // Server already applied search; use loaded rows as-is.
  const filteredOrders = orders;

  if (loading) {
    return <LoadingSpinner message="Processing sales contracts..." subtitle="SALES_CONTRACTS" />;
  }

  return (
    <div className="space-y-6" id="orders-view">

      {/* Top action row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search orders by customer or product..."
        />

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Sales Contract</span>
        </button>
      </div>

      {/* Creation form as Dialog Modal */}
      <Dialog
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title={editOrderId ? 'Edit Customer Sales Contract' : 'Create Customer Sales Contract'}
      >
        <form onSubmit={handleCreateOrder} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

            <FormField label="Client Company *" labelClassName="font-semibold block text-slate-700">
              <ComboBox
                required
                value={formClientId}
                onChange={setFormClientId}
                noneLabel="-- Select Client --"
                options={clients.map(c => ({ value: c.id, label: c.companyName, sublabel: `Rep: ${c.name}` }))}
                onSearch={setClientQuery}
                searchLoading={clientsSearchLoading}
              />
            </FormField>

            <FormField label="Estimated Delivery Lead Time (Days)" labelClassName="font-semibold block text-slate-700">
              <input
                type="number"
                min="1"
                value={formDeliveryDays}
                onChange={(e) => setFormDeliveryDays(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
              />
            </FormField>

            {/* List of Added Contract Items */}
            <div className="sm:col-span-2 border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
              <span className="font-semibold block text-slate-700 text-xs">Contract Line Items ({formItems.length})</span>
              {formItems.length === 0 ? (
                <div className="text-center py-4 text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white text-[11px]">
                  No items added yet. Specify product details below to add items to this contract.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                        <th className="p-2">Product Name</th>
                        <th className="p-2 text-right">Quantity</th>
                        <th className="p-2 text-right">Unit Price</th>
                        <th className="p-2 text-right">Total (RM)</th>
                        <th className="p-2 text-center" style={{ width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-700">
                      {formItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 font-semibold text-slate-800">{item.itemName}</td>
                          <td className="p-2 text-right font-mono">{item.quantity}</td>
                          <td className="p-2 text-right font-mono">RM {item.unitPrice.toLocaleString('en-US')}</td>
                          <td className="p-2 text-right font-mono font-semibold">RM {item.totalPrice.toLocaleString('en-US')}</td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveFormItem(idx)}
                              className="text-red-500 hover:text-red-700 p-1"
                              title="Remove line item"
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

            {/* Inline Add Item Panel */}
            <div className="sm:col-span-2 border border-blue-100 rounded-lg p-4 bg-blue-50/20 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <FormField
                label="Product Selection"
                labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider"
                colSpan="sm:col-span-6"
              >
                <ComboBox
                  value={tempItemId}
                  onChange={(v) => handleItemSelect(v)}
                  noneLabel="-- Choose Product --"
                  options={finishedGoods.map(g => ({ value: g.id, label: g.name, sublabel: `Stock: ${g.quantity}` }))}
                  onSearch={setProductQuery}
                  searchLoading={productsSearchLoading}
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

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddTempItem}
                  disabled={!tempItemId || tempQuantity <= 0}
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
                RM {Math.max(0, formItems.reduce((sum, item) => sum + item.totalPrice, 0) + (tempItemId && tempQuantity > 0 ? tempQuantity * tempUnitPrice : 0)).toLocaleString('en-US')}
              </div>
            </div>

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
            <DialogCancelButton onClick={() => setShowAddForm(false)} />
            <DialogSubmitButton>{editOrderId ? 'Update Contract' : 'Sign Contract'}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Orders Listing Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <th className="p-4">Contract ID</th>
                <th className="p-4">Client</th>
                <th className="p-4">Product & Quantity</th>
                <th className="p-4">Delivery Due</th>
                <th className="p-4">Contract Total</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No sales orders found matching your search.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={order.id} className="group hover:bg-slate-50/50 transition-colors">

                    {/* Contract ID */}
                    <td className="p-4 font-mono font-semibold text-slate-900">
                      #{order.id.split('-')[1] || order.id}
                    </td>

                    {/* Client Company */}
                    <td className="p-4 font-semibold text-slate-900">
                      {order.clientName}
                    </td>

                    {/* Product & Qty */}
                    <td className="p-4">
                      <div className="space-y-1">
                        {order.items && order.items.length > 0 ? (
                          <div className="space-y-1 max-w-xs">
                            {order.items.map((item, idx) => (
                              <div key={idx} className="flex flex-col border-b border-slate-100 last:border-none pb-1 last:pb-0">
                                <span className="font-semibold text-slate-800">{item.itemName}</span>
                                <span className="text-[10px] text-slate-400 font-mono text-slate-500">
                                  Qty: {item.quantity} {item.quantity > 1 ? 'units' : 'unit'} @ RM {item.unitPrice}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-800">{order.itemName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">Qty: {order.quantity} units</div>
                          </div>
                        )}
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

                    {/* Delivery Date */}
                    <td className="p-4">
                      <div className="flex items-center space-x-1.5 text-slate-600 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{order.deliveryDate}</span>
                      </div>
                    </td>

                    {/* Contract Value */}
                    <td className="p-4 font-mono font-semibold text-slate-900">
                      RM {order.totalPrice.toLocaleString('en-US')}
                    </td>

                    {/* Status Badge */}
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-medium border ${order.status === 'PENDING' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                          order.status === 'IN_PRODUCTION' ? 'bg-sky-50 text-sky-800 border-sky-200' :
                            order.status === 'SHIPPED' ? 'bg-blue-50 text-blue-800 border-blue-200' :
                              order.status === 'DELIVERED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                'bg-slate-50 text-slate-800 border-slate-200'
                        }`}>
                        {order.status === 'IN_PRODUCTION' ? 'In Factory Queue' : order.status}
                      </span>
                    </td>

                    {/* Transition actions */}
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleEditOrder(order)}
                          title="Edit Sales Contract"
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteOrder(order.id)}
                          title="Delete Sales Contract"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedInvoiceOrder(order);
                            setIsInvoiceOpen(true);
                          }}
                          title="Generate Tax Invoice"
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>

                        {order.status === 'PENDING' && (
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'IN_PRODUCTION')}
                            title="Queue production run"
                            className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {order.status === 'IN_PRODUCTION' && (
                          <span className="text-[10px] text-slate-400 italic px-1.5">Tracking in factory floor</span>
                        )}
                        {order.status === 'SHIPPED' && (
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'DELIVERED')}
                            title="Mark delivered to site"
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {order.status === 'DELIVERED' && (
                          <span className="text-[10px] text-emerald-600 font-semibold flex items-center space-x-0.5 font-mono px-1.5">
                            <span>✓ Completed</span>
                          </span>
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
      <InfiniteScrollSentinel onLoadMore={loadMore} hasMore={hasMore} loading={loadingMore} />

      {/* Invoice Generator Modal */}
      <InvoiceModal
        order={selectedInvoiceOrder}
        isOpen={isInvoiceOpen}
        onClose={() => {
          setIsInvoiceOpen(false);
          setSelectedInvoiceOrder(null);
        }}
      />

    </div>
  );
}

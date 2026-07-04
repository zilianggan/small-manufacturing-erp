/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { saveVendors, saveClients } from '../services/db';
import { useTableData } from '../hooks/useTableData';
import { Vendor, Client, Attachment } from '../types';
import { Plus, Star, Mail, Phone, MapPin, Briefcase, User, Paperclip, Edit, Trash2 } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, fieldInputClassName, SearchInput } from './ui';

export default function ContactsView() {
  const [activeTab, setActiveTab] = useState<'VENDORS' | 'CLIENTS'>('VENDORS');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: vendorsData, loading: vendorsLoading, loadMore: loadMoreVendors, hasMore: hasMoreVendors, loadingMore: vendorsLoadingMore } =
    useTableData<Vendor>('vendors', { search: activeTab === 'VENDORS' ? searchQuery : '' });
  const { data: clientsData, loading: clientsLoading, loadMore: loadMoreClients, hasMore: hasMoreClients, loadingMore: clientsLoadingMore } =
    useTableData<Client>('clients', { search: activeTab === 'CLIENTS' ? searchQuery : '' });

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => { setVendors(vendorsData); }, [vendorsData]);
  useEffect(() => { setClients(clientsData); }, [clientsData]);
  const loading = vendorsLoading || clientsLoading;

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form states for Vendor
  const [vendorName, setVendorName] = useState('');
  const [vendorContact, setVendorContact] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorMaterials, setVendorMaterials] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [vendorRating, setVendorRating] = useState(5);

  // Form states for Client
  const [clientName, setClientName] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientAddress, setClientAddress] = useState('');

  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);

  const resetForm = () => {
    setEditId(null);
    setVendorName('');
    setVendorContact('');
    setVendorEmail('');
    setVendorPhone('');
    setVendorMaterials('');
    setVendorAddress('');
    setVendorRating(5);
    setClientName('');
    setClientContact('');
    setClientEmail('');
    setClientPhone('');
    setClientCompany('');
    setClientAddress('');
    setFormAttachment(undefined);
  };

  const handleEditContact = (item: Vendor | Client, type: 'VENDORS' | 'CLIENTS') => {
    setActiveTab(type);
    setEditId(item.id);
    if (type === 'VENDORS') {
      const v = item as Vendor;
      setVendorName(v.name);
      setVendorContact(v.contactName || '');
      setVendorEmail(v.email || '');
      setVendorPhone(v.phone || '');
      setVendorMaterials(v.materialsSupplied.join(', '));
      setVendorAddress(v.address || '');
      setVendorRating(v.rating || 5);
      setFormAttachment(v.attachments?.[0]);
    } else {
      const c = item as Client;
      setClientName(c.name);
      setClientContact(c.contactName || '');
      setClientEmail(c.email || '');
      setClientPhone(c.phone || '');
      setClientCompany(c.companyName || '');
      setClientAddress(c.address || '');
      setFormAttachment(c.attachments?.[0]);
    }
    setShowForm(true);
  };

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();

    if (activeTab === 'VENDORS') {
      if (!vendorName) return;
      const newVendor: Vendor = {
        id: editId || `v-${Date.now()}`,
        name: vendorName,
        contactName: vendorContact,
        email: vendorEmail,
        phone: vendorPhone,
        materialsSupplied: vendorMaterials.split(',').map(m => m.trim()).filter(Boolean),
        address: vendorAddress,
        rating: Number(vendorRating),
        attachments: formAttachment ? [formAttachment] : []
      };

      const updated = editId
        ? vendors.map(v => v.id === editId ? newVendor : v)
        : [...vendors, newVendor];

      setVendors(updated);
      saveVendors(updated, newVendor);
    } else {
      if (!clientName || !clientCompany) return;
      const newClient: Client = {
        id: editId || `c-${Date.now()}`,
        name: clientName,
        contactName: clientContact,
        email: clientEmail,
        phone: clientPhone,
        companyName: clientCompany,
        address: clientAddress,
        totalOrdersValue: editId ? (clients.find(c => c.id === editId)?.totalOrdersValue || 0) : 0,
        attachments: formAttachment ? [formAttachment] : []
      };

      const updated = editId
        ? clients.map(c => c.id === editId ? newClient : c)
        : [...clients, newClient];

      setClients(updated);
      saveClients(updated, newClient);
    }

    resetForm();
    setShowForm(false);
  };

  const handleDeleteContact = (id: string) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      if (activeTab === 'VENDORS') {
        const updated = vendors.filter(v => v.id !== id);
        setVendors(updated);
        saveVendors(updated, undefined, id);
      } else {
        const updated = clients.filter(c => c.id !== id);
        setClients(updated);
        saveClients(updated, undefined, id);
      }
    }
  };

  // Server already applied search for the active tab; use loaded rows as-is.
  const filteredVendors = vendors;
  const filteredClients = clients;

  if (loading) {
    return <LoadingSpinner message="Retrieving contact profiles..." subtitle="CONTACTS_LOAD" />;
  }

  return (
    <div className="space-y-6" id="contacts-view">

      {/* Top Toggle & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

        {/* Toggle Selector */}
        <div className="flex space-x-1 p-1 bg-slate-100 rounded-lg border border-slate-200/50 self-start">
          <button
            onClick={() => { setActiveTab('VENDORS'); setSearchQuery(''); setShowForm(false); }}
            className={`flex items-center space-x-1.5 px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'VENDORS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Suppliers & Vendors</span>
          </button>
          <button
            onClick={() => { setActiveTab('CLIENTS'); setSearchQuery(''); setShowForm(false); }}
            className={`flex items-center space-x-1.5 px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'CLIENTS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Customer Clients</span>
          </button>
        </div>

        {/* Search Input & Button */}
        <div className="flex items-center space-x-2">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={`Search ${activeTab === 'VENDORS' ? 'suppliers' : 'clients'}...`}
            className="relative flex-1 sm:w-64"
          />

          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add {activeTab === 'VENDORS' ? 'Supplier' : 'Client'}</span>
          </button>
        </div>

      </div>

      {/* Creation form as Dialog Modal */}
      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title={`${editId ? 'Edit' : 'Create'} ${activeTab === 'VENDORS' ? 'Preferred Raw Supplier Account' : 'Customer Client Account'}`}
      >
        <form onSubmit={handleAddContact} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

            {activeTab === 'VENDORS' ? (
              // Vendor Fields
              <>
                <FormField label="Vendor / Company Name *">
                  <input
                    type="text" required value={vendorName} onChange={(e) => setVendorName(e.target.value)}
                    placeholder="e.g. PentaSteel Mills"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Contact Representative">
                  <input
                    type="text" value={vendorContact} onChange={(e) => setVendorContact(e.target.value)}
                    placeholder="e.g. Tan Seng Jie"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Business Email">
                  <input
                    type="email" value={vendorEmail} onChange={(e) => setVendorEmail(e.target.value)}
                    placeholder="e.g. sales@pentasteel.com.my"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Business Phone">
                  <input
                    type="text" value={vendorPhone} onChange={(e) => setVendorPhone(e.target.value)}
                    placeholder="+60 3-8012 3456"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Materials Supplied (Comma-separated SKUs or Names)" colSpan="sm:col-span-2">
                  <input
                    type="text" value={vendorMaterials} onChange={(e) => setVendorMaterials(e.target.value)}
                    placeholder="Steel Billets, Ball Bearings, Machining Coolant"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Headquarters Address" colSpan="sm:col-span-2">
                  <input
                    type="text" value={vendorAddress} onChange={(e) => setVendorAddress(e.target.value)}
                    placeholder="Lot 102, Kawasan Perindustrian Balakong, Selangor, Malaysia"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Vendor Performance Score (1-5 Stars)">
                  <ComboBox
                    value={String(vendorRating)}
                    onChange={(v) => setVendorRating(Number(v))}
                    options={[
                      { value: '5', label: '⭐⭐⭐⭐⭐ (5/5) - Flawless' },
                      { value: '4', label: '⭐⭐⭐⭐ (4/5) - High Quality' },
                      { value: '3', label: '⭐⭐⭐ (3/5) - Standard' },
                      { value: '2', label: '⭐⭐ (2/5) - Unreliable' },
                      { value: '1', label: '⭐ (1/5) - At Risk' },
                    ]}
                  />
                </FormField>
              </>
            ) : (
              // Client Fields
              <>
                <FormField label="Client Company Name *">
                  <input
                    type="text" required value={clientCompany} onChange={(e) => setClientCompany(e.target.value)}
                    placeholder="e.g. Mega Machinery Sdn Bhd"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Contact Representative *">
                  <input
                    type="text" required value={clientName} onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Mr. Lee"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Email">
                  <input
                    type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="e.g. lee@megamachinery.com.my"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Phone">
                  <input
                    type="text" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="+60 3-8890 1122"
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Delivery / Billing Address" colSpan="sm:col-span-2">
                  <input
                    type="text" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)}
                    placeholder="e.g. Lot 45, Shah Alam Industrial Park, Selangor, Malaysia"
                    className={fieldInputClassName}
                  />
                </FormField>
              </>
            )}

            <div className="sm:col-span-2">
              <AttachmentSection
                attachment={formAttachment}
                onAttachmentChange={setFormAttachment}
                label="Business Profile Documents (Optional)"
                helperText="Upload any agreement, invoice, credentials, or branding assets (Max 1MB)"
              />
            </div>

          </div>
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowForm(false)} />
            <DialogSubmitButton>{editId ? 'Save Profile' : 'Add Profile'}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Grid displays */}
      {activeTab === 'VENDORS' ? (
        // VENDORS GRID
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredVendors.length === 0 ? (
            <Card className="col-span-full text-center py-12 text-xs text-slate-400">
              No vendors found matching your query.
            </Card>
          ) : (
            filteredVendors.map((vendor) => (
              <Card key={vendor.id} className="group p-5 hover:shadow-md transition-shadow flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-sans font-semibold text-slate-900 text-sm leading-snug">{vendor.name}</h4>
                      <p className="text-xs text-blue-600 font-medium font-mono">{vendor.contactName || 'Representative'}</p>
                    </div>
                    {/* Star Rating Badge */}
                    <div className="flex items-center bg-blue-50/50 text-blue-700 px-2 py-0.5 rounded border border-blue-100 font-mono text-xs space-x-1 font-semibold shrink-0">
                      <Star className="w-3.5 h-3.5 fill-blue-600 stroke-blue-600 shrink-0" />
                      <span>{vendor.rating.toFixed(1)}</span>
                    </div>
                  </div>

                  {/* Location & Details */}
                  <div className="space-y-1.5 text-xs text-slate-500">
                    {vendor.email && (
                      <div className="flex items-center space-x-2">
                        <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{vendor.email}</span>
                      </div>
                    )}
                    {vendor.phone && (
                      <div className="flex items-center space-x-2">
                        <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span>{vendor.phone}</span>
                      </div>
                    )}
                    {vendor.address && (
                      <div className="flex items-start space-x-2">
                        <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-0.5" />
                        <span className="line-clamp-2">{vendor.address}</span>
                      </div>
                    )}
                    {vendor.attachments?.[0] && (
                      <div className="pt-1 flex items-center">
                        <a
                          href={vendor.attachments[0].dataUrl}
                          download={vendor.attachments[0].name}
                          className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                          title="Download attachment"
                        >
                          <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                          <span className="truncate max-w-[150px]">{vendor.attachments[0].name}</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer: Materials List & Delete */}
                <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Supplied Stocks:</span>
                    <div className="flex flex-wrap gap-1">
                      {vendor.materialsSupplied.length === 0 ? (
                        <span className="text-slate-400 italic text-[11px]">No registered stocks</span>
                      ) : (
                        vendor.materialsSupplied.map((mat, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-slate-100 border border-slate-200/50 text-slate-600 rounded text-[10px] font-mono">
                            {mat.startsWith('rm-') ? (mat === 'rm-1' ? 'Oak' : mat === 'rm-2' ? 'Steel' : mat === 'rm-3' ? 'Varnish' : mat === 'rm-4' ? 'Screws' : 'Cushions') : mat}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEditContact(vendor, 'VENDORS')}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                      title="Edit"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteContact(vendor.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      ) : (
        // CLIENTS GRID
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClients.length === 0 ? (
            <Card className="col-span-full text-center py-12 text-xs text-slate-400">
              No clients found matching your query.
            </Card>
          ) : (
            filteredClients.map((client) => (
              <Card key={client.id} className="group p-5 hover:shadow-md transition-shadow flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-sans font-semibold text-slate-900 text-sm leading-snug">{client.companyName}</h4>
                      <p className="text-xs text-blue-600 font-medium font-mono">Rep: {client.name}</p>
                    </div>
                  </div>

                  {/* Location & Details */}
                  <div className="space-y-1.5 text-xs text-slate-500">
                    {client.email && (
                      <div className="flex items-center space-x-2">
                        <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{client.email}</span>
                      </div>
                    )}
                    {client.phone && (
                      <div className="flex items-center space-x-2">
                        <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span>{client.phone}</span>
                      </div>
                    )}
                    {client.address && (
                      <div className="flex items-start space-x-2">
                        <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-0.5" />
                        <span className="line-clamp-2">{client.address}</span>
                      </div>
                    )}
                    {client.attachments?.[0] && (
                      <div className="pt-1 flex items-center">
                        <a
                          href={client.attachments[0].dataUrl}
                          download={client.attachments[0].name}
                          className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                          title="Download attachment"
                        >
                          <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                          <span className="truncate max-w-[150px]">{client.attachments[0].name}</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer: Revenue metrics & Actions */}
                <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Total Contract Value:</span>
                    <div className="font-mono font-semibold text-emerald-600">
                      RM {client.totalOrdersValue.toLocaleString('en-US')}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEditContact(client, 'CLIENTS')}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                      title="Edit"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteContact(client.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      <InfiniteScrollSentinel
        onLoadMore={activeTab === 'VENDORS' ? loadMoreVendors : loadMoreClients}
        hasMore={activeTab === 'VENDORS' ? hasMoreVendors : hasMoreClients}
        loading={activeTab === 'VENDORS' ? vendorsLoadingMore : clientsLoadingMore}
      />

    </div>
  );
}

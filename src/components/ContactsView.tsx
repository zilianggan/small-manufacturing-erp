/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { getVendors, getClients, saveVendors, saveClients } from '../services/db';
import { Vendor, Client, Attachment } from '../types';
import { Plus, Search, Star, Mail, Phone, MapPin, Award, User, Briefcase, Paperclip, Edit, Trash2 } from 'lucide-react';
import AttachmentSection from './AttachmentSection';

export default function ContactsView() {
  const [vendors, setVendors] = useState<Vendor[]>(() => getVendors());
  const [clients, setClients] = useState<Client[]>(() => getClients());

  const [activeTab, setActiveTab] = useState<'VENDORS' | 'CLIENTS'>('VENDORS');
  const [searchQuery, setSearchQuery] = useState('');
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
      setFormAttachment(v.attachment);
    } else {
      const c = item as Client;
      setClientName(c.name);
      setClientContact(c.contactName || '');
      setClientEmail(c.email || '');
      setClientPhone(c.phone || '');
      setClientCompany(c.companyName || '');
      setClientAddress(c.address || '');
      setFormAttachment(c.attachment);
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
        attachment: formAttachment
      };
      
      const updated = editId 
        ? vendors.map(v => v.id === editId ? newVendor : v)
        : [...vendors, newVendor];
        
      setVendors(updated);
      saveVendors(updated);
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
        attachment: formAttachment
      };
      
      const updated = editId 
        ? clients.map(c => c.id === editId ? newClient : c)
        : [...clients, newClient];
        
      setClients(updated);
      saveClients(updated);
    }

    resetForm();
    setShowForm(false);
  };

  const handleDeleteContact = (id: string) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      if (activeTab === 'VENDORS') {
        const updated = vendors.filter(v => v.id !== id);
        setVendors(updated);
        saveVendors(updated);
      } else {
        const updated = clients.filter(c => c.id !== id);
        setClients(updated);
        saveClients(updated);
      }
    }
  };

  // Filters
  const filteredVendors = useMemo(() => {
    return vendors.filter(v =>
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [vendors, searchQuery]);

  const filteredClients = useMemo(() => {
    return clients.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.contactName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [clients, searchQuery]);

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
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${activeTab === 'VENDORS' ? 'suppliers' : 'clients'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 font-sans"
            />
          </div>

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
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-sans font-semibold text-slate-900 text-sm">
                {editId ? 'Edit' : 'Create'} {activeTab === 'VENDORS' ? 'Preferred Raw Supplier Account' : 'Customer Client Account'}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-base p-1 leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddContact} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
                
                {activeTab === 'VENDORS' ? (
                  // Vendor Fields
                  <>
                    <div className="space-y-1">
                      <label className="font-semibold block">Vendor / Company Name *</label>
                      <input
                        type="text" required value={vendorName} onChange={(e) => setVendorName(e.target.value)}
                        placeholder="e.g. PentaSteel Mills"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold block">Contact Representative</label>
                      <input
                        type="text" value={vendorContact} onChange={(e) => setVendorContact(e.target.value)}
                        placeholder="e.g. Tan Seng Jie"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold block">Business Email</label>
                      <input
                        type="email" value={vendorEmail} onChange={(e) => setVendorEmail(e.target.value)}
                        placeholder="e.g. sales@pentasteel.com.my"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold block">Business Phone</label>
                      <input
                        type="text" value={vendorPhone} onChange={(e) => setVendorPhone(e.target.value)}
                        placeholder="+60 3-8012 3456"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="font-semibold block">Materials Supplied (Comma-separated SKUs or Names)</label>
                      <input
                        type="text" value={vendorMaterials} onChange={(e) => setVendorMaterials(e.target.value)}
                        placeholder="Steel Billets, Ball Bearings, Machining Coolant"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="font-semibold block">Headquarters Address</label>
                      <input
                        type="text" value={vendorAddress} onChange={(e) => setVendorAddress(e.target.value)}
                        placeholder="Lot 102, Kawasan Perindustrian Balakong, Selangor, Malaysia"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold block">Vendor Performance Score (1-5 Stars)</label>
                      <select
                        value={vendorRating} onChange={(e) => setVendorRating(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans"
                      >
                        <option value="5">⭐⭐⭐⭐⭐ (5/5) - Flawless</option>
                        <option value="4">⭐⭐⭐⭐ (4/5) - High Quality</option>
                        <option value="3">⭐⭐⭐ (3/5) - Standard</option>
                        <option value="2">⭐⭐ (2/5) - Unreliable</option>
                        <option value="1">⭐ (1/5) - At Risk</option>
                      </select>
                    </div>
                  </>
                ) : (
                  // Client Fields
                  <>
                    <div className="space-y-1">
                      <label className="font-semibold block">Client Company Name *</label>
                      <input
                        type="text" required value={clientCompany} onChange={(e) => setClientCompany(e.target.value)}
                        placeholder="e.g. Mega Machinery Sdn Bhd"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold block">Contact Representative *</label>
                      <input
                        type="text" required value={clientName} onChange={(e) => setClientName(e.target.value)}
                        placeholder="e.g. Mr. Lee"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold block">Email</label>
                      <input
                        type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="e.g. lee@megamachinery.com.my"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold block">Phone</label>
                      <input
                        type="text" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)}
                        placeholder="+60 3-8890 1122"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="font-semibold block">Delivery / Billing Address</label>
                      <input
                        type="text" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)}
                        placeholder="e.g. Lot 45, Shah Alam Industrial Park, Selangor, Malaysia"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
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
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 text-xs mt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  {editId ? 'Save Profile' : 'Add Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grid displays */}
      {activeTab === 'VENDORS' ? (
        // VENDORS GRID
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredVendors.length === 0 ? (
            <div className="col-span-full text-center py-12 text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">
              No vendors found matching your query.
            </div>
          ) : (
            filteredVendors.map((vendor) => (
              <div key={vendor.id} className="group bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4">
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
                    {vendor.attachment && (
                      <div className="pt-1 flex items-center">
                        <a
                          href={vendor.attachment.dataUrl}
                          download={vendor.attachment.name}
                          className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                          title="Download attachment"
                        >
                          <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                          <span className="truncate max-w-[150px]">{vendor.attachment.name}</span>
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
              </div>
            ))
          )}
        </div>
      ) : (
        // CLIENTS GRID
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClients.length === 0 ? (
            <div className="col-span-full text-center py-12 text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">
              No clients found matching your query.
            </div>
          ) : (
            filteredClients.map((client) => (
              <div key={client.id} className="group bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4">
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
                    {client.attachment && (
                      <div className="pt-1 flex items-center">
                        <a
                          href={client.attachment.dataUrl}
                          download={client.attachment.name}
                          className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                          title="Download attachment"
                        >
                          <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                          <span className="truncate max-w-[150px]">{client.attachment.name}</span>
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
              </div>
            ))
          )}
        </div>
      )}

    </div>
  );
}

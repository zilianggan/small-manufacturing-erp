/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { getVendors, getClients, saveVendor, saveClient, deleteVendor, deleteClient, generateId } from '../services/ContactsService';
import { Vendor, Client, Attachment } from '../types';
import { Plus, Mail, Phone, MapPin, Briefcase, Users, Paperclip, Edit, Trash2, ChevronRight, FileText } from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import CompanyFormFields from './CompanyFormFields';
import ContactDetailView from './ContactDetailView';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, SearchInput } from './ui';
import { CallAPI } from './UIHelper';

type CompanyType = 'VENDORS' | 'CLIENTS';
type Company = Vendor | Client;

/**
 * Company (Vendor/Client) listing: tabs, search, create/edit/delete, and the
 * entry point into ContactDetailView (that file owns the drill-down page —
 * company summary + its Contacts CRUD).
 */
export default function ContactsView() {
  const [activeTab, setActiveTab] = useState<CompanyType>('VENDORS');
  const [searchQuery, setSearchQuery] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCompanies = (tab: CompanyType, search = searchQuery) => {
    setLoading(true);
    const request = tab === 'VENDORS' ? getVendors(search) : getClients(search);
    CallAPI(() => request, {
      onCompleted: (data) => {
        if (tab === 'VENDORS') setVendors(data as Vendor[]); else setClients(data as Client[]);
        setLoading(false);
      },
      onError: (err) => { console.error(err); setLoading(false); },
    });
  };

  // Reload (unfiltered) whenever the active tab changes
  useEffect(() => { setSearchQuery(''); loadCompanies(activeTab, ''); }, [activeTab]);

  // Debounced search-as-you-type
  useEffect(() => {
    const t = setTimeout(() => loadCompanies(activeTab, searchQuery), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Drill-down: selected company (shows ContactDetailView instead of the grid)
  const [selectedType, setSelectedType] = useState<CompanyType>('VENDORS');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // ─── Company create/edit form ──────────────────────────────────────────
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [editCompanyId, setEditCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyOfficeNo, setCompanyOfficeNo] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');
  const [companyAttachment, setCompanyAttachment] = useState<Attachment | undefined>(undefined);

  const resetCompanyForm = () => {
    setEditCompanyId(null);
    setCompanyName('');
    setCompanyEmail('');
    setCompanyOfficeNo('');
    setCompanyAddress('');
    setCompanyDescription('');
    setCompanyAttachment(undefined);
  };

  const openAddCompany = () => {
    resetCompanyForm();
    setShowCompanyForm(true);
  };

  const openEditCompany = (item: Company) => {
    setEditCompanyId(item.id);
    setCompanyName(item.companyName);
    setCompanyEmail(item.email || '');
    setCompanyOfficeNo(item.officeNo || '');
    setCompanyAddress(item.address || '');
    setCompanyDescription(item.description || '');
    setCompanyAttachment(item.attachments?.[0]);
    setShowCompanyForm(true);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;

    const record: Company = {
      id: editCompanyId || generateId(),
      companyName: companyName.trim(),
      email: companyEmail,
      officeNo: companyOfficeNo,
      address: companyAddress,
      description: companyDescription,
      attachments: companyAttachment ? [companyAttachment] : []
    };

    const save = activeTab === 'VENDORS' ? saveVendor(record as Vendor) : saveClient(record as Client);
    await CallAPI(() => save, {
      onCompleted: () => loadCompanies(activeTab),
      onError: console.error,
    });

    resetCompanyForm();
    setShowCompanyForm(false);
  };

  const handleDeleteCompany = async (item: Company) => {
    if (!confirm(`Delete ${item.companyName}? Its contacts will be removed as well.`)) return;

    const remove = activeTab === 'VENDORS' ? deleteVendor(item.id) : deleteClient(item.id);
    await CallAPI(() => remove, {
      onCompleted: () => loadCompanies(activeTab),
      onError: console.error,
    });
  };

  const openCompanyDetail = (item: Company) => {
    setSelectedType(activeTab);
    setSelectedCompany(item);
  };

  // ─── Drill-down detail page ─────────────────────────────────────────────
  if (selectedCompany) {
    return (
      <ContactDetailView
        company={selectedCompany}
        companyType={selectedType}
        onBack={() => { setSelectedCompany(null); loadCompanies(activeTab); }}
        onCompanyUpdated={(updated) => setSelectedCompany(updated)}
        onCompanyDeleted={() => { setSelectedCompany(null); loadCompanies(activeTab); }}
      />
    );
  }

  if (loading) {
    return <LoadingSpinner message="Retrieving contact profiles..." subtitle="CONTACTS_LOAD" />;
  }

  const companies = activeTab === 'VENDORS' ? vendors : clients;

  // ─── Company listing view ──────────────────────────────────────────────
  return (
    <div className="space-y-6" id="contacts-view">

      {/* Top Toggle & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

        {/* Toggle Selector */}
        <div className="flex space-x-1 p-1 bg-slate-100 rounded-lg border border-slate-200/50 self-start">
          <button
            onClick={() => setActiveTab('VENDORS')}
            className={`flex items-center space-x-1.5 px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'VENDORS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Suppliers & Vendors</span>
          </button>
          <button
            onClick={() => setActiveTab('CLIENTS')}
            className={`flex items-center space-x-1.5 px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'CLIENTS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Users className="w-3.5 h-3.5" />
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
            onClick={openAddCompany}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add {activeTab === 'VENDORS' ? 'Supplier' : 'Client'}</span>
          </button>
        </div>

      </div>

      {/* Creation/Edit form as Dialog Modal */}
      <Dialog
        open={showCompanyForm}
        onClose={() => setShowCompanyForm(false)}
        title={`${editCompanyId ? 'Edit' : 'Create'} ${activeTab === 'VENDORS' ? 'Preferred Raw Supplier Account' : 'Customer Client Account'}`}
      >
        <form onSubmit={handleSaveCompany} className="p-5 space-y-4">
          <CompanyFormFields
            companyName={companyName} setCompanyName={setCompanyName}
            companyEmail={companyEmail} setCompanyEmail={setCompanyEmail}
            companyOfficeNo={companyOfficeNo} setCompanyOfficeNo={setCompanyOfficeNo}
            companyAddress={companyAddress} setCompanyAddress={setCompanyAddress}
            companyDescription={companyDescription} setCompanyDescription={setCompanyDescription}
            companyAttachment={companyAttachment} setCompanyAttachment={setCompanyAttachment}
          />
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowCompanyForm(false)} />
            <DialogSubmitButton>{editCompanyId ? 'Save Profile' : 'Add Profile'}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Company grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {companies.length === 0 ? (
          <Card className="col-span-full text-center py-12 text-xs text-slate-400">
            No {activeTab === 'VENDORS' ? 'vendors' : 'clients'} found matching your query.
          </Card>
        ) : (
          companies.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              onOpen={() => openCompanyDetail(company)}
              onEdit={() => openEditCompany(company)}
              onDelete={() => handleDeleteCompany(company)}
            />
          ))
        )}
      </div>

    </div>
  );
}

// Company summary card used in both the Vendors and Clients grids
function CompanyCard({
  company, onOpen, onEdit, onDelete
}: {
  company: Company;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="group p-5 hover:shadow-md transition-shadow flex flex-col justify-between space-y-4 cursor-pointer">
      <div className="space-y-2.5" onClick={onOpen}>
        <div className="flex items-start justify-between">
          <h4 className="font-sans font-semibold text-slate-900 text-sm leading-snug">{company.companyName}</h4>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
        </div>

        <div className="space-y-1.5 text-xs text-slate-500">
          {company.email && (
            <div className="flex items-center space-x-2">
              <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{company.email}</span>
            </div>
          )}
          {company.officeNo && (
            <div className="flex items-center space-x-2">
              <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span>{company.officeNo}</span>
            </div>
          )}
          {company.address && (
            <div className="flex items-start space-x-2">
              <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-0.5" />
              <span className="line-clamp-2">{company.address}</span>
            </div>
          )}
          {company.description && (
            <div className="flex items-start space-x-2">
              <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-0.5" />
              <span className="line-clamp-2">{company.description}</span>
            </div>
          )}
          {company.attachments?.[0] && (
            <div className="pt-1 flex items-center">
              <a
                href={company.attachments[0].dataUrl}
                download={company.attachments[0].name}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[150px]">{company.attachments[0].name}</span>
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
        <button
          onClick={onOpen}
          className="flex items-center space-x-1 text-[11px] font-medium text-blue-600 hover:text-blue-800"
        >
          <Users className="w-3.5 h-3.5" />
          <span>View Contacts</span>
        </button>

        <div className="flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
            title="Edit"
          >
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}

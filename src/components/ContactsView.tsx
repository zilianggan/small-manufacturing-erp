/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import { getVendors, getClients, saveVendor, saveClient, deleteVendor, deleteClient, generateId } from '../services/ContactsService';
import { Vendor, Client, Attachment } from '../types';
import { Plus, Mail, Phone, MapPin, Briefcase, Users, Edit, Trash2, ChevronRight, FileText } from 'lucide-react';
import CompanyFormFields from './CompanyFormFields';
import ContactDetailView from './ContactDetailView';
import SortMenu, { SortOption } from './SortMenu';
import CompanyLogo from './CompanyLogo';
import { Sheet, Card, SearchInput, Button, Tabs, TabsList, TabsTrigger, Skeleton, useToast, useConfirm } from './ui';
import { CallAPI } from './UIHelper';
import { sortByField } from '../utils/sortRows';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { debounce } from 'lodash'

type CompanyType = 'VENDORS' | 'CLIENTS';
type Company = Vendor | Client;
type CompanySortField = 'companyName' | 'email' | 'createdAt';

const SORT_OPTIONS: SortOption[] = [
  { value: 'companyName', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'createdAt', label: 'Date Added' },
];

/**
 * Company (Vendor/Client) listing: tabs, search, create/edit/delete, and the
 * entry point into ContactDetailView (that file owns the drill-down page —
 * company summary + its Contacts CRUD).
 */
export default function ContactsView() {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<CompanyType>('VENDORS');
  const [searchQuery, setSearchQuery] = useState([{ search: '' }, { search: '' }]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCompanies = (tab: CompanyType, search: string = '') => {
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
  useEffect(() => {
    loadCompanies(activeTab, searchQuery[activeTab === 'VENDORS' ? 0 : 1]?.search);
  }, [activeTab]);

  // Debounced search-as-you-type
  const search = useMemo(
    () =>
      debounce((text: string) => {
        loadCompanies(activeTab, text);
      }, 500),
    [activeTab]
  );

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<CompanySortField>('companyName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
  const formRef = useFadeInOnMount<HTMLDivElement>([showCompanyForm], { duration: 0.7, stagger: 0.18, y: 16 });

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

  const handleSaveCompany = async () => {
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
      onCompleted: () => { loadCompanies(activeTab); toast.success(editCompanyId ? 'Profile updated.' : 'Profile added.'); },
      onError: (err) => { console.error(err); toast.error('Failed to save profile.'); },
    });

    resetCompanyForm();
    setShowCompanyForm(false);
  };

  const handleDeleteCompany = async (item: Company) => {
    if (!(await confirm(`Delete ${item.companyName}? Its contacts will be removed as well.`))) return;

    const remove = activeTab === 'VENDORS' ? deleteVendor(item.id) : deleteClient(item.id);
    await CallAPI(() => remove, {
      onCompleted: () => { loadCompanies(activeTab); toast.success(`${item.companyName} deleted.`); },
      onError: (err) => { console.error(err); toast.error('Failed to delete profile.'); },
    });
  };

  const openCompanyDetail = (item: Company) => {
    setSelectedType(activeTab);
    setSelectedCompany(item);
  };

  const companies = useMemo(
    () => sortByField(activeTab === 'VENDORS' ? vendors : clients, sortField, sortDir),
    [vendors, clients, activeTab, sortField, sortDir]
  );

  // ─── Drill-down detail page ─────────────────────────────────────────────
  // (kept after all hooks above — an early return before a hook call means
  // this component renders a different hook count than the list view, which
  // React's rules of hooks forbid.)
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

  // ─── Company listing view ──────────────────────────────────────────────
  return (
    <div className="space-y-6" id="contacts-view">

      {/* Top Toggle & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

        {/* Toggle Selector */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CompanyType)} className="self-start">
          <TabsList>
            <TabsTrigger value="VENDORS" className="gap-1.5">
              <Briefcase className="w-3.5 h-3.5" /> Suppliers & Vendors
            </TabsTrigger>
            <TabsTrigger value="CLIENTS" className="gap-1.5">
              <Users className="w-3.5 h-3.5" /> Customer Clients
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Search Input & Button */}
        <div className="flex items-center space-x-2">
          <SearchInput
            value={searchQuery?.[activeTab === 'VENDORS' ? 0 : 1]?.search}
            onChange={(e: any) => {
              setSearchQuery((prev) => {
                const updated = [...prev];
                const index = activeTab === "VENDORS" ? 0 : 1;

                updated[index] = {
                  ...updated[index],
                  search: e,
                };

                return updated;
              });
              search(e)
            }}
            placeholder={`Search ${activeTab === 'VENDORS' ? 'suppliers' : 'clients'}...`}
            className="relative flex-1 sm:w-64"
          />

          <SortMenu options={SORT_OPTIONS} sortField={sortField} sortDir={sortDir} onChange={(f, d) => { setSortField(f as CompanySortField); setSortDir(d); }} />

          <Button onClick={openAddCompany}>
            <Plus className="w-4 h-4" />
            Add {activeTab === 'VENDORS' ? 'Supplier' : 'Client'}
          </Button>
        </div>

      </div>

      {/* Creation/Edit form as slide-over drawer — matches MaterialView/ProductView */}
      <Sheet
        open={showCompanyForm}
        onClose={() => setShowCompanyForm(false)}
        title={`${editCompanyId ? 'Edit' : 'Create'} ${activeTab === 'VENDORS' ? 'Preferred Raw Supplier Account' : 'Customer Client Account'}`}
        description={editCompanyId ? companyEmail || undefined : 'Create a new company profile'}
        width="w-full sm:max-w-xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCompanyForm(false)}>Cancel</Button>
            <Button onClick={handleSaveCompany}>{editCompanyId ? 'Save Profile' : 'Add Profile'}</Button>
          </div>
        }
      >
        <div ref={formRef} className="p-5 space-y-6">
          <div data-fade-item>
            <CompanyFormFields
              companyName={companyName} setCompanyName={setCompanyName}
              companyEmail={companyEmail} setCompanyEmail={setCompanyEmail}
              companyOfficeNo={companyOfficeNo} setCompanyOfficeNo={setCompanyOfficeNo}
              companyAddress={companyAddress} setCompanyAddress={setCompanyAddress}
              companyDescription={companyDescription} setCompanyDescription={setCompanyDescription}
              companyAttachment={companyAttachment} setCompanyAttachment={setCompanyAttachment}
            />
          </div>
        </div>
      </Sheet>

      {/* Company grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading && companies.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => <CompanyCardSkeleton key={`skeleton-${i}`} />)
        ) : companies.length === 0 ? (
          <Card className="col-span-full text-center py-12 text-xs text-muted-foreground">
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

// Placeholder shown in the grid while a company page is loading
function CompanyCardSkeleton() {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="border-t border-border pt-3">
        <Skeleton className="h-3 w-24" />
      </div>
    </Card>
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
          <div className="flex items-center gap-2.5 min-w-0">
            <CompanyLogo attachment={company.attachments?.[0]} size="sm" />
            <h4 className="font-sans font-semibold text-slate-900 text-sm leading-snug truncate">{company.companyName}</h4>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
        </div>

        <div className="space-y-1.5 text-xs text-slate-500">
          {company.email && (
            <div className="flex items-center space-x-2" >
              <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span className="truncate font-mono text-primary hover:underline cursor-pointer" onClick={(e) => { e.stopPropagation(); window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(company.email)}`, "_blank") }}>{company.email}</span>
            </div>
          )}
          {company.officeNo && (
            <div className="flex items-center space-x-2">
              <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span className="font-mono text-primary hover:underline cursor-pointer" onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/${company.officeNo}`, "_blank") }}>{company.officeNo}</span>
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
          {/* {company.attachments?.[0] && (
            <div className="pt-1 flex items-center">
              <a
                href={company.attachments[0].dataUrl}
                download={company.attachments[0].name}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <AttachmentIcon className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[150px]">{company.attachments[0].name}</span>
              </a>
            </div>
          )} */}
        </div>
      </div>

      <div className="border-t border-border pt-3 flex items-center justify-between text-xs">
        <Button variant="link" size="sm" onClick={onOpen} className="h-auto p-0 gap-1">
          <Users className="w-3.5 h-3.5" />
          View Contacts
        </Button>

        <div className="flex items-center space-x-1">
          <Button
            variant="ghost" size="icon"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            title="Edit"
          >
            <Edit className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

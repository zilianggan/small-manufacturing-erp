/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  saveVendor, saveClient, deleteVendor, deleteClient,
  saveContact, deleteContact, getContacts, generateId, getJobPositions
} from '../services/ContactsService';
import { Vendor, Client, Contact, JobPosition, Attachment } from '../types';
import { Plus, Mail, Phone, MapPin, Paperclip, Edit, Trash2, ArrowLeft, Users, FileText } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import ComboBox from './ComboBox';
import CompanyFormFields from './CompanyFormFields';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, fieldInputClassName, SearchInput } from './ui';
import { CallAPI } from './UIHelper';

type CompanyType = 'VENDORS' | 'CLIENTS';
type Company = Vendor | Client;

interface ContactDetailViewProps {
  company: Company;
  companyType: CompanyType;
  onBack: () => void;
  onCompanyUpdated: (company: Company) => void;
  onCompanyDeleted: () => void;
}

/**
 * Drill-down "detail page" for a single Vendor/Client company: its own info
 * card (with edit/delete) plus the list of Contacts (people) that belong to
 * it, each with full CRUD. Split out of ContactsView.tsx to keep that file
 * focused on the company listing/search/create flow.
 */
export default function ContactDetailView({ company, companyType, onBack, onCompanyUpdated, onCompanyDeleted }: ContactDetailViewProps) {
  // ─── Job positions (reference data for the contact form) ───────────────
  const [jobPositions, setJobPositions] = useState<JobPosition[]>([]);
  useEffect(() => {
    CallAPI(getJobPositions, { onCompleted: setJobPositions, onError: console.error });
  }, []);
  const jobPositionMap = useMemo(() => new Map(jobPositions.map(p => [p.id, p.name])), [jobPositions]);
  const activeJobPositionOptions = jobPositions
    .filter(p => p.is_active)
    .map(p => ({ value: p.id, label: p.name }));

  // ─── Contacts scoped to this company ────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState('');

  const loadContacts = (search = contactSearch) => {
    setContactsLoading(true);
    const filter = companyType === 'VENDORS' ? { vendorId: company.id, search } : { clientId: company.id, search };
    CallAPI(() => getContacts(filter), {
      onCompleted: (data) => { setContacts(data); setContactsLoading(false); },
      onError: (err) => { console.error(err); setContactsLoading(false); },
    });
  };

  // Reload on company switch, and debounce as the search box is typed into.
  useEffect(() => { loadContacts(''); setContactSearch(''); }, [company.id, companyType]);
  useEffect(() => {
    const t = setTimeout(() => loadContacts(contactSearch), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactSearch]);

  // ─── Company edit form ──────────────────────────────────────────────────
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyName, setCompanyName] = useState(company.companyName);
  const [companyEmail, setCompanyEmail] = useState(company.email || '');
  const [companyOfficeNo, setCompanyOfficeNo] = useState(company.officeNo || '');
  const [companyAddress, setCompanyAddress] = useState(company.address || '');
  const [companyDescription, setCompanyDescription] = useState(company.description || '');
  const [companyAttachment, setCompanyAttachment] = useState<Attachment | undefined>(company.attachments?.[0]);

  const openEditCompany = () => {
    setCompanyName(company.companyName);
    setCompanyEmail(company.email || '');
    setCompanyOfficeNo(company.officeNo || '');
    setCompanyAddress(company.address || '');
    setCompanyDescription(company.description || '');
    setCompanyAttachment(company.attachments?.[0]);
    setShowCompanyForm(true);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;

    const updated: Company = {
      ...company,
      companyName: companyName.trim(),
      email: companyEmail,
      officeNo: companyOfficeNo,
      address: companyAddress,
      description: companyDescription,
      attachments: companyAttachment ? [companyAttachment] : []
    };

    const save = companyType === 'VENDORS' ? saveVendor(updated as Vendor) : saveClient(updated as Client);
    await CallAPI(() => save, {
      onCompleted: () => onCompanyUpdated(updated),
      onError: console.error,
    });

    setShowCompanyForm(false);
  };

  const handleDeleteCompany = async () => {
    if (!confirm(`Delete ${company.companyName}? Its contacts will be removed as well.`)) return;

    const remove = companyType === 'VENDORS' ? deleteVendor(company.id) : deleteClient(company.id);
    await CallAPI(() => remove, {
      onCompleted: onCompanyDeleted,
      onError: console.error,
    });
  };

  // ─── Contact (person) add/edit form ─────────────────────────────────────
  const [showContactForm, setShowContactForm] = useState(false);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [contactFullName, setContactFullName] = useState('');
  const [contactNo, setContactNo] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactJobPositionId, setContactJobPositionId] = useState('');
  const [contactAttachment, setContactAttachment] = useState<Attachment | undefined>(undefined);

  const resetContactForm = () => {
    setEditContactId(null);
    setContactFullName('');
    setContactNo('');
    setContactEmail('');
    setContactJobPositionId('');
    setContactAttachment(undefined);
  };

  const openAddContact = () => {
    resetContactForm();
    setShowContactForm(true);
  };

  const openEditContact = (c: Contact) => {
    setEditContactId(c.id);
    setContactFullName(c.fullName);
    setContactNo(c.contactNo || '');
    setContactEmail(c.email || '');
    setContactJobPositionId(c.jobPositionId || '');
    setContactAttachment(c.attachments?.[0]);
    setShowContactForm(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactFullName.trim()) return;

    const newContact: Contact = {
      id: editContactId || generateId(),
      fullName: contactFullName.trim(),
      contactNo: contactNo || undefined,
      email: contactEmail || undefined,
      jobPositionId: contactJobPositionId || undefined,
      vendorId: companyType === 'VENDORS' ? company.id : undefined,
      clientId: companyType === 'CLIENTS' ? company.id : undefined,
      attachments: contactAttachment ? [contactAttachment] : []
    };

    await CallAPI(() => saveContact(newContact), {
      onCompleted: () => loadContacts(),
      onError: console.error,
    });

    resetContactForm();
    setShowContactForm(false);
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm('Are you sure you want to delete this contact?')) return;

    await CallAPI(() => deleteContact(id), {
      onCompleted: () => loadContacts(),
      onError: console.error,
    });
  };

  return (
    <div className="space-y-6" id="contact-detail-view">
      <button
        onClick={onBack}
        className="flex items-center space-x-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to {companyType === 'VENDORS' ? 'Suppliers & Vendors' : 'Customer Clients'}</span>
      </button>

      {/* Company summary card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2.5 min-w-0">
            <div>
              <h2 className="font-sans font-bold text-slate-900 text-lg leading-snug truncate">{company.companyName}</h2>
              {company.description && (
                <p className="text-xs text-slate-500 mt-1 max-w-2xl">{company.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
              {company.email && (
                <div className="flex items-center space-x-1.5">
                  <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span>{company.email}</span>
                </div>
              )}
              {company.officeNo && (
                <div className="flex items-center space-x-1.5">
                  <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span>{company.officeNo}</span>
                </div>
              )}
              {company.address && (
                <div className="flex items-center space-x-1.5">
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span>{company.address}</span>
                </div>
              )}
            </div>
            {company.attachments?.[0] && (
              <a
                href={company.attachments[0].dataUrl}
                download={company.attachments[0].name}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[200px]">{company.attachments[0].name}</span>
              </a>
            )}
          </div>
          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              onClick={openEditCompany}
              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
              title="Edit"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={handleDeleteCompany}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Card>

      {/* Contacts section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="font-sans font-bold text-slate-900 text-sm flex items-center space-x-2">
          <Users className="w-4 h-4 text-slate-500" />
          <span>Contacts</span>
        </h3>
        <div className="flex items-center space-x-2">
          <SearchInput
            value={contactSearch}
            onChange={setContactSearch}
            placeholder="Search contacts..."
            className="relative flex-1 sm:w-64"
          />
          <button
            onClick={openAddContact}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Contact</span>
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {contactsLoading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No contacts found for this company yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 hover:bg-slate-50/50 transition-colors group"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-sans font-semibold text-slate-900 text-sm truncate">{contact.fullName}</h4>
                    {contact.jobPositionId && jobPositionMap.get(contact.jobPositionId) && (
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-[10px] font-mono shrink-0">
                        {jobPositionMap.get(contact.jobPositionId)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    {contact.contactNo && (
                      <span className="flex items-center space-x-1"><Phone className="w-3 h-3 text-slate-400" /><span>{contact.contactNo}</span></span>
                    )}
                    {contact.email && (
                      <span className="flex items-center space-x-1"><Mail className="w-3 h-3 text-slate-400" /><span>{contact.email}</span></span>
                    )}
                    {contact.attachments?.[0] && (
                      <a
                        href={contact.attachments[0].dataUrl}
                        download={contact.attachments[0].name}
                        className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                        title="Download attachment"
                      >
                        <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                        <span className="truncate max-w-[150px]">{contact.attachments[0].name}</span>
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => openEditContact(contact)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded transition-colors"
                    title="Edit"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteContact(contact.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Company edit dialog */}
      <Dialog
        open={showCompanyForm}
        onClose={() => setShowCompanyForm(false)}
        title={`Edit ${companyType === 'VENDORS' ? 'Preferred Raw Supplier Account' : 'Customer Client Account'}`}
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
            <DialogSubmitButton>Save Profile</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Contact add/edit dialog */}
      <Dialog
        open={showContactForm}
        onClose={() => setShowContactForm(false)}
        maxWidth="max-w-md"
        title={editContactId ? 'Edit Contact' : 'Add Contact'}
      >
        <form onSubmit={handleSaveContact} className="p-5 space-y-4 text-xs text-slate-600">
          <FormField label="Full Name *" labelClassName="font-semibold block text-slate-700">
            <input
              type="text" required value={contactFullName} onChange={(e) => setContactFullName(e.target.value)}
              placeholder="e.g. Tan Seng Jie"
              className={fieldInputClassName}
            />
          </FormField>
          <FormField label="Job Position" labelClassName="font-semibold block text-slate-700">
            <ComboBox
              value={contactJobPositionId}
              onChange={setContactJobPositionId}
              noneLabel="-- Select Job Position --"
              options={activeJobPositionOptions}
            />
          </FormField>
          <FormField label="Contact No." labelClassName="font-semibold block text-slate-700">
            <input
              type="text" value={contactNo} onChange={(e) => setContactNo(e.target.value)}
              placeholder="+60 12-345 6789"
              className={fieldInputClassName}
            />
          </FormField>
          <FormField label="Email" labelClassName="font-semibold block text-slate-700">
            <input
              type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              placeholder="e.g. name@company.com"
              className={fieldInputClassName}
            />
          </FormField>
          <AttachmentSection
            attachment={contactAttachment}
            onAttachmentChange={setContactAttachment}
            label="Business Card / Document (Optional)"
            helperText="Upload a business card, ID, or related document (Max 1MB)"
          />
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowContactForm(false)} />
            <DialogSubmitButton>{editContactId ? 'Save Contact' : 'Add Contact'}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}

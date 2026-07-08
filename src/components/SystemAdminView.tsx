import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  BriefcaseBusiness,
  Clock,
  Edit,
  Hash,
  PackageCheck,
  Plus,
  Search,
  Settings,
  Trash2
} from 'lucide-react';
import { CompanyProfile, JobPosition, MaterialCategory, ProductCategory } from '../types';
import {
  generateId,
} from '../services/db';
import { Card, Dialog, DialogCancelButton, DialogFooter, DialogSubmitButton, FormField, fieldInputClassName, useToast, useConfirm } from './ui';
import { getJobPositions, getMaterialCategories, getProductCategories, loadSystemAdminData, saveJobPositions, saveMaterialCategories, saveProductCategories } from '../services/SystemAdminService';
import { getCompanyProfile, saveCompanyProfile } from '../services/CompanyProfileService';
import { CallAPI } from './UIHelper';

type CrudKind = 'JOB_POSITION' | 'MATERIAL_CATEGORY' | 'PRODUCT_CATEGORY';
type ParameterKind = CrudKind | 'NUMBERING';
// All parameter kinds now share the exact same minimal shape:
type ParameterRecord = JobPosition | MaterialCategory | ProductCategory;

interface SectionConfig {
  kind: ParameterKind;
  title: string;
  shortTitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClassName: string;
}

const SECTIONS: SectionConfig[] = [
  { kind: 'JOB_POSITION', title: 'Job Position', shortTitle: 'Positions', icon: BriefcaseBusiness, accentClassName: 'bg-blue-50 text-blue-700 border-blue-100' },
  { kind: 'MATERIAL_CATEGORY', title: 'Material Category', shortTitle: 'Materials', icon: Boxes, accentClassName: 'bg-amber-50 text-amber-800 border-amber-100' },
  { kind: 'PRODUCT_CATEGORY', title: 'Product Category', shortTitle: 'Products', icon: PackageCheck, accentClassName: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { kind: 'NUMBERING', title: 'Document Numbering', shortTitle: 'Numbering', icon: Hash, accentClassName: 'bg-slate-50 text-slate-700 border-slate-200' },
];

const emptyNumberingForm = {
  so_number_format: 'SO-0000',
  so_next_number: 1,
  po_number_format: 'PO-0000',
  po_next_number: 1,
};

const emptyFormState = {
  id: '',
  name: '',
  is_active: true
};

export default function SystemAdminView() {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeKind, setActiveKind] = useState<ParameterKind>('JOB_POSITION');
  const [searchTerm, setSearchTerm] = useState('');
  const [jobPositions, setJobPositions] = useState<JobPosition[]>([]);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ParameterRecord | null>(null);
  const [form, setForm] = useState(emptyFormState);
  const [formError, setFormError] = useState('');
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [numberingForm, setNumberingForm] = useState(emptyNumberingForm);
  const [numberingSaving, setNumberingSaving] = useState(false);

  const loaders = {
    JOB_POSITION: {
      api: getJobPositions,
      setApi: saveJobPositions,
      onCompleted: setJobPositions,
    },
    MATERIAL_CATEGORY: {
      api: getMaterialCategories,
      setApi: saveMaterialCategories,
      onCompleted: setMaterialCategories,
    },
    PRODUCT_CATEGORY: {
      api: getProductCategories,
      setApi: saveProductCategories,
      onCompleted: setProductCategories,
    },
    all: {
      api: loadSystemAdminData,
      onCompleted: (data: any) => {
        setJobPositions(data.job_positions ?? []);
        setMaterialCategories(data.material_categories ?? []);
        setProductCategories(data.product_categories ?? []);
      },
    },
  } as const;

  type LoaderKey = keyof typeof loaders;

  const loadData = async (type: LoaderKey) => {
    const loader = loaders[type];
    await CallAPI(loader.api, {
      onCompleted: loader.onCompleted,
      onError: console.error,
    });
  }

  const saveRecords = async (kind: ParameterKind, items: ParameterRecord[], changed?: ParameterRecord, deletedId?: string, successMessage?: string) => {
    const loader = loaders[kind as CrudKind];
    await CallAPI(() => loader.setApi(
      items as any[],
      changed as any | undefined,
      deletedId
    ),
      {
        onCompleted: () => { loadData(kind as CrudKind); if (successMessage) toast.success(successMessage); },
        onError: (err) => { console.error(err); toast.error('Failed to save changes.'); },
      }
    );
  };

  useEffect(() => {
    loadData('all');
    CallAPI(getCompanyProfile, {
      onCompleted: (profile: CompanyProfile | null) => {
        setCompanyProfile(profile);
        if (profile) setNumberingForm({
          so_number_format: profile.so_number_format ?? emptyNumberingForm.so_number_format,
          so_next_number: profile.so_next_number ?? emptyNumberingForm.so_next_number,
          po_number_format: profile.po_number_format ?? emptyNumberingForm.po_number_format,
          po_next_number: profile.po_next_number ?? emptyNumberingForm.po_next_number,
        });
      },
      onError: console.error,
    });
  }, []);

  const handleSaveNumbering = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyProfile) return;
    setNumberingSaving(true);
    await CallAPI(() => saveCompanyProfile({ ...companyProfile, ...numberingForm }), {
      onCompleted: (profile: CompanyProfile) => { setCompanyProfile(profile); toast.success('Numbering settings updated.'); },
      onError: (err) => { console.error(err); toast.error('Failed to save numbering settings.'); },
    });
    setNumberingSaving(false);
  };

  const activeSection = SECTIONS.find(s => s.kind === activeKind) || SECTIONS[0];
  const ActiveIcon = activeSection.icon;

  const records = useMemo<ParameterRecord[]>(() => {
    if (activeKind === 'JOB_POSITION') return jobPositions;
    if (activeKind === 'MATERIAL_CATEGORY') return materialCategories;
    if (activeKind === 'PRODUCT_CATEGORY') return productCategories;
    return productCategories;
  }, [activeKind, jobPositions, materialCategories, productCategories]);

  const filteredRecords = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return records;
    return records.filter(r => r.name.toLowerCase().includes(needle));
  }, [records, searchTerm]);

  const activeCount = records.filter(r => r.is_active).length;

  const openCreateDialog = () => {
    setEditing(null);
    setForm({ ...emptyFormState, is_active: true });
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (record: ParameterRecord) => {
    setEditing(record);
    setForm({ id: record.id, name: record.name, is_active: record.is_active });
    setFormError('');
    setDialogOpen(true);
  };

  const isDuplicateName = (name: string): boolean => {
    const needle = name.trim().toLowerCase();
    return records.some(r => r.id !== editing?.id && r.name.trim().toLowerCase() === needle);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = form.name.trim();
    if (!trimmedName) return;

    if (isDuplicateName(trimmedName)) {
      setFormError(`A ${activeSection.title.toLowerCase()} named "${trimmedName}" already exists.`);
      return;
    }

    const nextRecord: ParameterRecord = {
      id: editing?.id || generateId(),
      name: trimmedName,
      is_active: form.is_active
    };

    const nextRecords = editing
      ? records.map(r => r.id === editing.id ? nextRecord : r)
      : [...records, nextRecord];

    saveRecords(activeKind, nextRecords, nextRecord, undefined, editing ? `${activeSection.title} updated.` : `${activeSection.title} added.`);
    setDialogOpen(false);
  };

  const handleDelete = async (record: ParameterRecord) => {
    if (!(await confirm(`Delete ${record.name}?`))) return;
    saveRecords(activeKind, records.filter(r => r.id !== record.id), undefined, record.id, `${record.name} deleted.`);
  };

  const handleToggleActive = (record: ParameterRecord) => {
    const changed = { ...record, status: !record.is_active };
    saveRecords(activeKind, records.map(r => r.id === record.id ? changed : r), changed);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return 'N/A';
    }
  };

  return (
    <div className="space-y-6" id="system-admin-view">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <span className="p-2 bg-slate-900 text-white rounded-lg">
            <Settings className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-sans font-bold text-slate-900 text-lg">System Admin</h2>
            <p className="text-xs text-slate-500 mt-1">
              {activeKind === 'NUMBERING' ? 'Document numbering' : `Parameters · ${activeCount} active of ${records.length} total`}
            </p>
          </div>
        </div>

        {activeKind !== 'NUMBERING' && (
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex items-center justify-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add {activeSection.title}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">
        {/* Sidebar Navigation */}
        <div className="space-y-2">
          {SECTIONS.map(section => {
            const Icon = section.icon;
            const active = section.kind === activeKind;
            const count = section.kind === 'JOB_POSITION'
              ? jobPositions.length
              : section.kind === 'MATERIAL_CATEGORY'
                ? materialCategories.length
                : section.kind === 'PRODUCT_CATEGORY'
                  ? productCategories.length
                  : null;

            return (
              <button
                key={section.kind}
                type="button"
                onClick={() => { setActiveKind(section.kind); setSearchTerm(''); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs transition-all ${active
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="font-semibold truncate">{section.shortTitle}</span>
                </span>
                <span className={`font-mono text-[10px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <div className="space-y-4 min-w-0">
          {activeKind === 'NUMBERING' ? (
          <Card className="p-5">
            <div className="flex items-center space-x-3 mb-4">
              <span className={`p-2 rounded-lg border ${activeSection.accentClassName}`}>
                <ActiveIcon className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-sans font-bold text-slate-900 text-sm">Document Numbering</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Format uses a run of zeros to mark the padded number, e.g. SO-0000 → SO-0001</p>
              </div>
            </div>

            {!companyProfile ? (
              <p className="text-xs text-slate-400">Loading...</p>
            ) : (
              <form onSubmit={handleSaveNumbering} className="space-y-5 text-xs text-slate-600">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Sales Order Format" labelClassName="font-semibold text-slate-700 block">
                    <input
                      type="text"
                      value={numberingForm.so_number_format}
                      onChange={(e) => setNumberingForm(p => ({ ...p, so_number_format: e.target.value }))}
                      placeholder="SO-0000"
                      className={`${fieldInputClassName} text-slate-800 font-mono`}
                    />
                  </FormField>
                  <FormField label="Sales Order Start Number" labelClassName="font-semibold text-slate-700 block">
                    <input
                      type="number"
                      min={1}
                      value={numberingForm.so_next_number}
                      onChange={(e) => setNumberingForm(p => ({ ...p, so_next_number: Number(e.target.value) || 1 }))}
                      className={`${fieldInputClassName} text-slate-800`}
                    />
                  </FormField>
                  <FormField label="Purchase Order Format" labelClassName="font-semibold text-slate-700 block">
                    <input
                      type="text"
                      value={numberingForm.po_number_format}
                      onChange={(e) => setNumberingForm(p => ({ ...p, po_number_format: e.target.value }))}
                      placeholder="PO-0000"
                      className={`${fieldInputClassName} text-slate-800 font-mono`}
                    />
                  </FormField>
                  <FormField label="Purchase Order Start Number" labelClassName="font-semibold text-slate-700 block">
                    <input
                      type="number"
                      min={1}
                      value={numberingForm.po_next_number}
                      onChange={(e) => setNumberingForm(p => ({ ...p, po_next_number: Number(e.target.value) || 1 }))}
                      className={`${fieldInputClassName} text-slate-800`}
                    />
                  </FormField>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={numberingSaving}
                    className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
                  >
                    {numberingSaving ? 'Saving...' : 'Save Numbering'}
                  </button>
                </div>
              </form>
            )}
          </Card>
          ) : (
          <>
          {/* Search Bar */}
          <Card className="p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0">
                <span className={`p-2 rounded-lg border ${activeSection.accentClassName}`}>
                  <ActiveIcon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-sans font-bold text-slate-900 text-sm">{activeSection.title}</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">{records.length} total · {activeCount} active</p>
                </div>
              </div>

              <div className="relative w-full md:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={`Search ${activeSection.shortTitle.toLowerCase()}...`}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </Card>

          {/* Records Table */}
          <Card className="overflow-hidden">
            {filteredRecords.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-xs text-slate-400 font-medium">No records found</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {/* Header (desktop only) */}
                <div className="hidden sm:grid sm:grid-cols-[1fr_100px_110px_110px_80px] gap-4 px-4 py-3 bg-slate-50/50 text-xs font-semibold text-slate-600 sticky top-0">
                  <div>Name</div>
                  <div>Status</div>
                  <div>Created</div>
                  <div>Modified</div>
                  <div className="text-right">Actions</div>
                </div>

                {/* Rows */}
                {filteredRecords.map(record => (
                  <div
                    key={record.id}
                    className="p-4 grid grid-cols-1 sm:grid-cols-[1fr_100px_110px_110px_80px] gap-4 sm:items-center sm:gap-4 hover:bg-slate-50/50 transition-colors"
                  >
                    {/* Name */}
                    <div className="min-w-0">
                      <h4 className="font-sans font-bold text-slate-900 text-sm truncate">{record.name}</h4>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(record)}
                        className={`px-2 py-1 rounded text-xs font-semibold whitespace-nowrap border ${record.is_active
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                      >
                        {record.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </div>

                    {/* Created Date */}
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{formatDate(record.created_at)}</span>
                    </div>

                    {/* Modified Date */}
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{formatDate(record.updated_at)}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditDialog(record)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(record)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </>
          )}
        </div>
      </div>

      {/* Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="max-w-md"
        title={editing ? `Edit ${activeSection.title}` : `Add ${activeSection.title}`}
        titleIcon={<span className={`p-1 rounded border ${activeSection.accentClassName}`}><ActiveIcon className="w-4 h-4" /></span>}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-slate-600">
          {formError && (
            <div className="p-2.5 bg-red-50 border border-red-100 text-red-700 rounded-lg font-medium">
              {formError}
            </div>
          )}

          <FormField label="Name *" labelClassName="font-semibold text-slate-700 block">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => { setForm(p => ({ ...p, name: e.target.value })); setFormError(''); }}
              placeholder={activeSection.title}
              className={`${fieldInputClassName} text-slate-800`}
              autoFocus
            />
          </FormField>

          <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-100 transition-colors">
            <span>Active</span>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm(p => ({ ...p, is_active: e.target.checked }))}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
          </label>

          <DialogFooter>
            <DialogCancelButton onClick={() => setDialogOpen(false)} />
            <DialogSubmitButton>{editing ? 'Save' : 'Create'}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}

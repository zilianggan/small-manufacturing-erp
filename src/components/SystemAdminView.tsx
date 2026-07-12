import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Edit, Plus, Trash2 } from 'lucide-react';
import { CompanyProfile, JobPosition, MaterialCategory, ProductCategory } from '../types';
import { generateId } from '../helper';
import {
  Badge, Button, Sheet,
  FormField, fieldInputClassName, useToast, useConfirm, ActionsMenu,
  Tabs, TabsList, TabsTrigger,
} from './ui';
import type { ActionMenuItem } from './ui';
import { PageHeader, SectionCard, FilterBar, DataTable } from './shell';
import type { DataTableColumn } from './shell';
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
}

const SECTIONS: SectionConfig[] = [
  { kind: 'JOB_POSITION', title: 'Job Position', shortTitle: 'Positions' },
  { kind: 'MATERIAL_CATEGORY', title: 'Material Category', shortTitle: 'Materials' },
  { kind: 'PRODUCT_CATEGORY', title: 'Product Category', shortTitle: 'Products' },
  { kind: 'NUMBERING', title: 'Document Numbering', shortTitle: 'Auto Numbering' },
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

  const handleSubmit = () => {
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

  const buildRowActions = (record: ParameterRecord): ActionMenuItem[] => [
    { label: 'Edit', icon: <Edit className="w-3.5 h-3.5" />, onClick: () => openEditDialog(record) },
    { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDelete(record), danger: true },
  ];

  const columns: DataTableColumn<ParameterRecord>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-card-foreground">{r.name}</span> },
    {
      key: 'status', header: 'Status', className: 'w-24',
      render: (r) => (
        <button type="button" onClick={() => handleToggleActive(r)}>
          <Badge variant={r.is_active ? 'success' : 'secondary'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
        </button>
      ),
    },
    {
      key: 'created', header: 'Created', className: 'w-32',
      render: (r) => (
        <div className="inline-flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
          <Clock className="w-3 h-3" />
          <span>{formatDate(r.created_at)}</span>
        </div>
      ),
    },
    {
      key: 'modified', header: 'Modified', className: 'w-32',
      render: (r) => (
        <div className="inline-flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
          <Clock className="w-3 h-3" />
          <span>{formatDate(r.updated_at)}</span>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5 h-full min-h-0" id="system-admin-view">
      <PageHeader
        title="System Admin"
        description="Manage lookup lists and document numbering."
        actions={activeKind !== 'NUMBERING' && <Button onClick={openCreateDialog}><Plus className="w-4 h-4" /> Add {activeSection.title}</Button>}
      />

      <Tabs value={activeKind} onValueChange={(v) => { setActiveKind(v as ParameterKind); setSearchTerm(''); }}>
        <TabsList>
          {SECTIONS.map((section) => <TabsTrigger key={section.kind} value={section.kind}>{section.shortTitle}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {activeKind === 'NUMBERING' ? (
        <SectionCard title="Document Numbering" description="Format uses a run of zeros to mark the padded number, e.g. SO-0000 → SO-0001" className="flex-1 min-h-0" contentClassName="p-5 overflow-auto">
          {!companyProfile ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <form onSubmit={handleSaveNumbering} className="space-y-5 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Sales Order Format">
                  <input
                    type="text"
                    value={numberingForm.so_number_format}
                    onChange={(e) => setNumberingForm(p => ({ ...p, so_number_format: e.target.value }))}
                    placeholder="SO-0000"
                    className={`${fieldInputClassName} font-mono`}
                  />
                </FormField>
                <FormField label="Sales Order Start Number">
                  <input
                    type="number"
                    min={1}
                    value={numberingForm.so_next_number}
                    onChange={(e) => setNumberingForm(p => ({ ...p, so_next_number: Number(e.target.value) || 1 }))}
                    className={fieldInputClassName}
                  />
                </FormField>
                <FormField label="Purchase Order Format">
                  <input
                    type="text"
                    value={numberingForm.po_number_format}
                    onChange={(e) => setNumberingForm(p => ({ ...p, po_number_format: e.target.value }))}
                    placeholder="PO-0000"
                    className={`${fieldInputClassName} font-mono`}
                  />
                </FormField>
                <FormField label="Purchase Order Start Number">
                  <input
                    type="number"
                    min={1}
                    value={numberingForm.po_next_number}
                    onChange={(e) => setNumberingForm(p => ({ ...p, po_next_number: Number(e.target.value) || 1 }))}
                    className={fieldInputClassName}
                  />
                </FormField>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={numberingSaving}>{numberingSaving ? 'Saving...' : 'Save Numbering'}</Button>
              </div>
            </form>
          )}
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Filters" className="shrink-0" contentClassName="p-4">
            <FilterBar
              search={searchTerm}
              onSearchChange={setSearchTerm}
              searchPlaceholder={`Search ${activeSection.shortTitle.toLowerCase()}...`}
            />
          </SectionCard>

          <SectionCard title={activeSection.title} description={`${records.length} total · ${activeCount} active`} className="flex-1 min-h-0" contentClassName="p-0 flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
              <DataTable
                columns={columns}
                rows={filteredRecords}
                rowKey={(r) => r.id}
                rowActions={(r) => <ActionsMenu items={buildRowActions(r)} />}
                emptyState="No records found."
              />
            </div>
          </SectionCard>
        </>
      )}

      {/* Add/Edit drawer */}
      <Sheet
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? `Edit ${activeSection.title}` : `Add ${activeSection.title}`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!form.name.trim()}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        }
      >
        <div className="p-5 space-y-4">
          {formError && (
            <div data-fade-item className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
              {formError}
            </div>
          )}

          <div data-fade-item>
            <FormField label="Name *">
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => { setForm(p => ({ ...p, name: e.target.value })); setFormError(''); }}
                placeholder={activeSection.title}
                className={fieldInputClassName}
                autoFocus
              />
            </FormField>
          </div>

          <label data-fade-item className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-secondary/30 text-xs font-semibold text-foreground cursor-pointer hover:bg-secondary/50 transition-colors">
            <span>Active</span>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm(p => ({ ...p, is_active: e.target.checked }))}
              className="w-4 h-4 accent-primary cursor-pointer"
            />
          </label>
        </div>
      </Sheet>
    </div>
  );
}

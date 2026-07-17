import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Clock, Edit, Plus, Trash2 } from 'lucide-react';
import { CompanyProfile, JobPosition, MaterialCategory, ProductCategory, WhatsappTemplateType } from '../types';
import { generateId } from '../helper';
import {
  Badge, Button, Sheet,
  FormField, fieldInputClassName, useToast, useConfirm, ActionsMenu,
  Tabs, TabsList, TabsTrigger,
} from './ui';
import type { ActionMenuItem } from './ui';
import { PageHeader, SectionCard, FilterBar, DataTable } from './shell';
import type { DataTableColumn } from './shell';
import { getJobPositions, getMaterialCategories, getProductCategories, getWhatsappTemplates, loadSystemAdminData, saveJobPositions, saveMaterialCategories, saveProductCategories, saveWhatsappTemplate } from '../services/SystemAdminService';
import { getCompanyProfile, saveCompanyProfile } from '../services/CompanyProfileService';
import { CallAPI } from './UIHelper';

type CrudKind = 'JOB_POSITION' | 'MATERIAL_CATEGORY' | 'PRODUCT_CATEGORY';
type ParameterKind = CrudKind | 'NUMBERING' | 'WHATSAPP_TEMPLATES';
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
  { kind: 'WHATSAPP_TEMPLATES', title: 'WhatsApp Templates', shortTitle: 'WhatsApp' },
];

const emptyWhatsappForm: Record<WhatsappTemplateType, string> = { PURCHASE: '', SALES: '' };

// Matches the vars each template type actually fills (see utils/whatsapp.ts's
// fillPurchaseTemplate/fillSalesTemplate) — only offer tokens that do something.
const TEMPLATE_TOKENS: Record<WhatsappTemplateType, string[]> = {
  PURCHASE: ['{{vendor_name}}', '{{quotation_no}}', '{{items}}'],
  SALES: ['{{customer_name}}', '{{quotation_no}}', '{{items}}', '{{grand_total}}'],
};

const TOKEN_PATTERN = /\{\{\w+\}\}/g;

const CHIP_CLASSNAME = 'inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-primary/15 text-primary font-mono text-[11px] font-semibold select-none align-baseline';

const makeChip = (token: string): HTMLElement => {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.token = token;
  span.className = CHIP_CLASSNAME;
  span.textContent = `{{${token}}}`;
  return span;
};

// text -> DOM nodes: {{token}} runs become atomic chip spans, everything else stays plain text.
const textToNodes = (text: string): Node[] => {
  const nodes: Node[] = [];
  let last = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_PATTERN.exec(text))) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    nodes.push(makeChip(m[0].slice(2, -2)));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
};

// DOM -> text: re-materializes {{token}} from each chip's data-token attribute. Only text nodes and
// chip spans are ever inserted into the editor (typing, token buttons, plain-text paste, and a
// manual "\n" text node for Enter — see below), so the DOM never grows anything else to walk.
const domToText = (root: HTMLElement): string => {
  let out = '';
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent || '';
    else if (node instanceof HTMLElement && node.dataset.token) out += `{{${node.dataset.token}}}`;
  });
  return out;
};

export interface TemplateTokenEditorHandle {
  insertToken: (token: string) => void;
}

interface TemplateTokenEditorProps {
  value: string;
  onChange: (next: string) => void;
}

// A textarea can't render styled inline elements, so template tokens are rendered as real atomic
// chips here via a contentEditable box instead: a chip is a contentEditable="false" span, which
// browsers already treat as a single unit for the caret, arrow keys, and Backspace/Delete — the same
// technique Gmail/Slack/Notion use for @mention chips. That native behavior is what makes tokens
// non-editable-a-character-at-a-time for free; no manual key interception needed for that part.
// Line breaks are plain "\n" text nodes (not browser-inserted <div>/<br>), so DOM<->string stays a
// lossless round trip without diffing browser-specific line-break markup.
const TemplateTokenEditor = forwardRef<TemplateTokenEditorHandle, TemplateTokenEditorProps>(({ value, onChange }, ref) => {
  const elRef = useRef<HTMLDivElement>(null);
  const lastValue = useRef('');

  // Rebuilds the DOM only when `value` changes from OUTSIDE this component (token insert, initial
  // load) — comparing against the string this component itself last emitted means a normal keystroke
  // (which updates `value` via onChange right back to what's already in the DOM) never triggers a
  // rebuild, which would otherwise fight the browser's own caret placement mid-edit.
  useEffect(() => {
    if (!elRef.current || value === lastValue.current) return;
    elRef.current.innerHTML = '';
    textToNodes(value).forEach((n) => elRef.current!.appendChild(n));
    lastValue.current = value;
  }, [value]);

  const emit = () => {
    if (!elRef.current) return;
    const next = domToText(elRef.current);
    lastValue.current = next;
    onChange(next);
  };

  useImperativeHandle(ref, () => ({
    insertToken: (token: string) => {
      const el = elRef.current;
      const sel = window.getSelection();
      if (!el || !sel) return;
      if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const chip = makeChip(token.slice(2, -2));
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      emit();
    },
  }));

  // Enter would otherwise let the browser insert its own (inconsistent-across-browsers) line-break
  // markup — replace it with a plain "\n" text node instead, rendered via white-space: pre-wrap.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode('\n');
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    emit();
  };

  // Force plain-text paste — anything else risks the browser dropping in rich-HTML markup domToText
  // doesn't know how to read back.
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(e.clipboardData.getData('text/plain'));
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    emit();
  };

  return (
    <div
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      onInput={emit}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className={`${fieldInputClassName} font-mono whitespace-pre-wrap min-h-[18rem] max-h-[28rem] overflow-y-auto`}
    />
  );
});
TemplateTokenEditor.displayName = 'TemplateTokenEditor';

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
  const [whatsappForm, setWhatsappForm] = useState(emptyWhatsappForm);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const whatsappEditorRefs = useRef<Record<WhatsappTemplateType, TemplateTokenEditorHandle | null>>({ PURCHASE: null, SALES: null });

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
    CallAPI(getWhatsappTemplates, {
      onCompleted: (templates) => {
        setWhatsappForm(prev => {
          const next = { ...prev };
          for (const t of templates) next[t.type] = t.content;
          return next;
        });
      },
      onError: console.error,
    });
  }, []);

  const handleSaveWhatsappTemplates = async () => {
    setWhatsappSaving(true);
    await CallAPI(() => Promise.all([
      saveWhatsappTemplate('PURCHASE', whatsappForm.PURCHASE),
      saveWhatsappTemplate('SALES', whatsappForm.SALES),
    ]), {
      onCompleted: () => toast.success('WhatsApp templates updated.'),
      onError: (err) => { console.error(err); toast.error('Failed to save templates.'); },
    });
    setWhatsappSaving(false);
  };

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
    <div className="flex flex-col gap-5 min-[1440px]:h-full min-[1440px]:min-h-0" id="system-admin-view">
      <PageHeader
        title="System Admin"
        description="Manage lookup lists and document numbering."
        actions={!['NUMBERING', 'WHATSAPP_TEMPLATES'].includes(activeKind) && <Button onClick={openCreateDialog}><Plus className="w-4 h-4" /> Add {activeSection.title}</Button>}
      />

      <Tabs value={activeKind} onValueChange={(v) => { setActiveKind(v as ParameterKind); setSearchTerm(''); }}>
        <TabsList>
          {SECTIONS.map((section) => <TabsTrigger key={section.kind} value={section.kind}>{section.shortTitle}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {activeKind === 'WHATSAPP_TEMPLATES' ? (
        <SectionCard title="WhatsApp Templates" description="Click a token to insert it, or type {{token}} manually. Tokens are atomic — deleting any character removes the whole token." className="flex-1 min-h-0" contentClassName="p-5 overflow-auto">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {(['PURCHASE', 'SALES'] as WhatsappTemplateType[]).map((type) => (
              <div key={type} className="space-y-2 min-w-0">
                <FormField label={type === 'PURCHASE' ? 'Purchase Quotation Template' : 'Sales Quotation Template'}>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {TEMPLATE_TOKENS[type].map((token) => (
                      <Button
                        key={token}
                        variant="secondary"
                        size="sm"
                        className="font-mono"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => whatsappEditorRefs.current[type]?.insertToken(token)}
                      >
                        {token}
                      </Button>
                    ))}
                  </div>
                  <TemplateTokenEditor
                    ref={(handle) => { whatsappEditorRefs.current[type] = handle; }}
                    value={whatsappForm[type]}
                    onChange={(next) => setWhatsappForm(p => ({ ...p, [type]: next }))}
                  />
                </FormField>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-5">
            <Button onClick={handleSaveWhatsappTemplates} disabled={whatsappSaving}>
              {whatsappSaving ? 'Saving...' : 'Save Templates'}
            </Button>
          </div>
        </SectionCard>
      ) : activeKind === 'NUMBERING' ? (
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

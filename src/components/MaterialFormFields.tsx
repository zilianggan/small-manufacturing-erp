import React from 'react';
import { Attachment, MaterialCategory, MaterialType } from '../types';
import AttachmentSection from './AttachmentSection';
import ComboBox from './ComboBox';
import { FormField, fieldInputClassName } from './ui';

const MATERIAL_TYPE_OPTIONS = [
  { value: 'RAW_MATERIAL', label: 'Raw Material' },
  { value: 'FINISHED_GOOD', label: 'Finished Good' },
  { value: 'CUSTOMER_STOCK', label: 'Customer Stock' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

interface MaterialFormFieldsProps {
  name: string; setName: (v: string) => void;
  code: string; setCode: (v: string) => void;
  materialType: MaterialType; setMaterialType: (v: MaterialType) => void;
  dimension: string; setDimension: (v: string) => void;
  materialCategoryId: string; setMaterialCategoryId: (v: string) => void;
  materialCategories: MaterialCategory[];
  status: 'ACTIVE' | 'INACTIVE'; setStatus: (v: 'ACTIVE' | 'INACTIVE') => void;
  minimumStock: number; setMinimumStock: (v: number) => void;
  reorderQuantity: number; setReorderQuantity: (v: number) => void;
  description: string; setDescription: (v: string) => void;
  attachment: Attachment | undefined; setAttachment: (a?: Attachment) => void;
  /** Which field group to render — lets the Material slide-over split these across tabs (General/Inventory/Attachment). Omit to render everything at once (legacy single-page form). */
  section?: 'general' | 'inventory' | 'attachment';
}

/** Shared Material create/edit form fields. */
export default function MaterialFormFields({
  name, setName,
  code, setCode,
  materialType, setMaterialType,
  dimension, setDimension,
  materialCategoryId, setMaterialCategoryId,
  materialCategories,
  status, setStatus,
  minimumStock, setMinimumStock,
  reorderQuantity, setReorderQuantity,
  description, setDescription,
  attachment, setAttachment,
  section,
}: MaterialFormFieldsProps) {
  const categoryOptions = materialCategories
    .filter(c => c.is_active)
    .map(c => ({ value: c.id, label: c.name }));

  const showGeneral = !section || section === 'general';
  const showInventory = !section || section === 'inventory';
  const showAttachment = !section || section === 'attachment';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-muted-foreground">
      {showGeneral && (
        <>
          <FormField label="Material Name *" colSpan="sm:col-span-2">
            <input
              type="text" required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mild Steel Plate"
              className={fieldInputClassName}
            />
          </FormField>
          <FormField label="Code">
            <input
              type="text" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. MS-PLT-001"
              className={fieldInputClassName}
            />
          </FormField>
          <FormField label="Dimension">
            <input
              type="text" value={dimension} onChange={(e) => setDimension(e.target.value)}
              placeholder="e.g. 1200mm x 2400mm x 6mm"
              className={fieldInputClassName}
            />
          </FormField>
          <FormField label="Material Type">
            <ComboBox
              value={materialType}
              onChange={(v) => setMaterialType(v as MaterialType)}
              options={MATERIAL_TYPE_OPTIONS}
              required
            />
          </FormField>
          <FormField label="Material Category">
            <ComboBox
              value={materialCategoryId}
              onChange={setMaterialCategoryId}
              noneLabel="-- Select Category --"
              options={categoryOptions}
            />
          </FormField>
          <FormField label="Status">
            <ComboBox
              value={status}
              onChange={(v) => setStatus(v as 'ACTIVE' | 'INACTIVE')}
              options={STATUS_OPTIONS}
              required
            />
          </FormField>
        </>
      )}
      {showInventory && (
        <>
          <FormField label="Minimum Stock">
            <input
              type="number" min={0} step="any" value={minimumStock}
              onChange={(e) => setMinimumStock(Number(e.target.value))}
              className={fieldInputClassName}
            />
          </FormField>
          <FormField label="Reorder Quantity">
            <input
              type="number" min={0} step="any" value={reorderQuantity}
              onChange={(e) => setReorderQuantity(Number(e.target.value))}
              className={fieldInputClassName}
            />
          </FormField>
          <FormField label="Description" colSpan="sm:col-span-2">
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Brief notes about this material..."
              className={fieldInputClassName}
            />
          </FormField>
        </>
      )}
      {showAttachment && (
        <div className="sm:col-span-2">
          <AttachmentSection
            attachment={attachment}
            onAttachmentChange={setAttachment}
            label="Material Spec Sheet / Drawing (Optional)"
            helperText="Upload a spec sheet, drawing, or related document (Max 1MB)"
          />
        </div>
      )}
    </div>
  );
}

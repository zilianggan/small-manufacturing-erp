import { Attachment, ProductCategory } from '../types';
import AttachmentSection from './AttachmentSection';
import ComboBox from './ComboBox';
import { FormField, fieldInputClassName } from './ui';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

interface ProductFormFieldsProps {
  name: string; setName: (v: string) => void;
  code: string; setCode: (v: string) => void;
  dimension: string; setDimension: (v: string) => void;
  productCategoryId: string; setProductCategoryId: (v: string) => void;
  productCategories: ProductCategory[];
  status: 'ACTIVE' | 'INACTIVE'; setStatus: (v: 'ACTIVE' | 'INACTIVE') => void;
  sellingPrice: number; setSellingPrice: (v: number) => void;
  description: string; setDescription: (v: string) => void;
  attachment: Attachment | undefined; setAttachment: (a?: Attachment) => void;
}

/** Shared Product create/edit form fields. */
export default function ProductFormFields({
  name, setName,
  code, setCode,
  dimension, setDimension,
  productCategoryId, setProductCategoryId,
  productCategories,
  status, setStatus,
  sellingPrice, setSellingPrice,
  description, setDescription,
  attachment, setAttachment,
}: ProductFormFieldsProps) {
  const categoryOptions = productCategories
    .filter(c => c.is_active)
    .map(c => ({ value: c.id, label: c.name }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
      <FormField label="Product Name *" colSpan="sm:col-span-2">
        <input
          type="text" required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Industrial Steel Bracket"
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Code">
        <input
          type="text" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. SB-2400-001"
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Dimension">
        <input
          type="text" value={dimension} onChange={(e) => setDimension(e.target.value)}
          placeholder="e.g. 300mm x 150mm x 8mm"
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Product Category">
        <ComboBox
          value={productCategoryId}
          onChange={setProductCategoryId}
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
      <FormField label="Selling Price">
        <input
          type="number" min={0} step="0.01" value={sellingPrice}
          onChange={(e) => setSellingPrice(Number(e.target.value))}
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Description" colSpan="sm:col-span-2">
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Brief notes about this product..."
          className={fieldInputClassName}
        />
      </FormField>
      <div className="sm:col-span-2">
        <AttachmentSection
          attachment={attachment}
          onAttachmentChange={setAttachment}
          label="Product Spec Sheet / Drawing (Optional)"
          helperText="Upload a spec sheet, drawing, or related document (Max 1MB)"
        />
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  UploadCloud, CheckCircle2, AlertTriangle, Download, Clipboard, Info,
  Database, ArrowRight, FileSpreadsheet, Layers, Users, ShoppingBag, Briefcase, Package, UserPlus, Boxes,
} from 'lucide-react';
import {
  ImportColumn, ImportRowError, FlatCategory,
  VENDOR_COLUMNS, CLIENT_COLUMNS, CONTACT_COLUMNS, MATERIAL_COLUMNS, PRODUCT_COLUMNS, PURCHASE_COLUMNS, SALES_COLUMNS, INVENTORY_COLUMNS,
  validateVendorsImport, validateClientsImport, validateContactsImport, validateMaterialsImport, validateProductsImport, validateInventoryImport, commitFlatImport,
  validatePurchaseImport, commitPurchaseImport, PurchaseImportPreview, PurchaseImportRow,
  validateSalesImport, commitSalesImport, SalesImportPreview, SalesImportRow,
  getVendorExportRows, getClientExportRows, getContactExportRows, getMaterialExportRows, getProductExportRows,
  getPurchaseExportSheets, getSalesExportSheets, getInventoryExportRows, getAllExportSheets,
} from '../services/ImportExportService';
import { useToast } from './ui';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataImported: () => void; // Refresh current views
}

type Category = 'VENDORS' | 'CLIENTS' | 'CONTACTS' | 'MATERIAL' | 'PRODUCT' | 'PURCHASE' | 'SALES' | 'INVENTORY';

const EXPECTED_COLUMNS: Record<Category, ImportColumn[]> = {
  VENDORS: VENDOR_COLUMNS,
  CLIENTS: CLIENT_COLUMNS,
  CONTACTS: CONTACT_COLUMNS,
  MATERIAL: MATERIAL_COLUMNS,
  PRODUCT: PRODUCT_COLUMNS,
  PURCHASE: PURCHASE_COLUMNS,
  SALES: SALES_COLUMNS,
  INVENTORY: INVENTORY_COLUMNS,
};

const CATEGORY_LIST: { id: Category; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'VENDORS', label: 'Vendors', icon: Users },
  { id: 'CLIENTS', label: 'Clients', icon: Briefcase },
  { id: 'CONTACTS', label: 'Contacts', icon: UserPlus },
  { id: 'MATERIAL', label: 'Material Catalog', icon: Layers },
  { id: 'PRODUCT', label: 'Product Catalog', icon: Package },
  { id: 'PURCHASE', label: 'Purchase Orders', icon: ShoppingBag },
  { id: 'SALES', label: 'Sales Orders', icon: FileSpreadsheet },
  { id: 'INVENTORY', label: 'Inventory Transactions', icon: Boxes },
];

const isHeaderDetailCategory = (category: Category): category is 'PURCHASE' | 'SALES' =>
  category === 'PURCHASE' || category === 'SALES';

export default function ImportExportModal({ isOpen, onClose, onDataImported }: ImportExportModalProps) {
  const toast = useToast();
  const [activeCategory, setActiveCategory] = useState<Category>('VENDORS');
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string; details?: string[] }>({ type: 'idle', message: '' });
  const [mappingState, setMappingState] = useState<{
    category: Category;
    fileHeaders: string[];
    dataRows: any[][];
    mapping: Record<string, string>;
  } | null>(null);
  const [purchasePreview, setPurchasePreview] = useState<PurchaseImportPreview | null>(null);
  const [salesPreview, setSalesPreview] = useState<SalesImportPreview | null>(null);
  const [flatPreview, setFlatPreview] = useState<{ category: FlatCategory; totalRows: number; errors: ImportRowError[]; records: any[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const dateStamp = new Date().toISOString().split('T')[0];
  const activeCategoryLabel = CATEGORY_LIST.find(c => c.id === activeCategory)?.label || '';

  // Attachments are a base64 dataUrl stored on the record. Images get embedded
  // directly into the "attachment" cell (exceljs supports real image
  // anchoring, unlike xlsx/SheetJS which is read-only for images); anything
  // else (PDF, docs, ...) falls back to a hyperlink on the filename text.
  const IMAGE_EXT: Record<string, ExcelJS.Image['extension']> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif' };

  const appendRowsSheet = (wb: ExcelJS.Workbook, sheetName: string, rows: Record<string, unknown>[], attachmentLinks?: (string | undefined)[]) => {
    const data = rows.length > 0 ? rows : [{ Notice: 'No records found' }];
    const columns = Object.keys(data[0]);
    const ws = wb.addWorksheet(sheetName);
    ws.columns = columns.map(key => ({ header: key, key, width: key === 'attachment' ? 14 : undefined }));
    ws.addRows(data);

    if (attachmentLinks && rows.length > 0) {
      const colIndex = columns.indexOf('attachment');
      if (colIndex !== -1) {
        attachmentLinks.forEach((dataUrl, rowIndex) => {
          if (!dataUrl) return;
          const sheetRow = rowIndex + 2; // +1 for header row, +1 for 1-based indexing
          const match = /^data:image\/(png|jpe?g|gif);base64,/i.exec(dataUrl);
          const ext = match ? IMAGE_EXT[match[1].toLowerCase()] : undefined;
          if (ext) {
            const imageId = wb.addImage({ base64: dataUrl, extension: ext });
            ws.addImage(imageId, { tl: { col: colIndex, row: sheetRow - 1 }, ext: { width: 60, height: 60 } });
            ws.getRow(sheetRow).height = 46;
          } else {
            const cell = ws.getCell(sheetRow, colIndex + 1);
            cell.value = { text: String(cell.value ?? ''), hyperlink: dataUrl, tooltip: 'Open attachment' };
          }
        });
      }
    }
  };

  const downloadWorkbook = async (wb: ExcelJS.Workbook, fileName: string) => {
    const buffer = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (category: Category) => {
    const wb = new ExcelJS.Workbook();
    const fileName = `ERP_${category}_${dateStamp}.xlsx`;
    let exportedCount = 0;

    if (category === 'VENDORS') {
      const { rows, attachmentLinks } = await getVendorExportRows();
      appendRowsSheet(wb, 'Vendors', rows, attachmentLinks);
      exportedCount = rows.length;
    } else if (category === 'CLIENTS') {
      const { rows, attachmentLinks } = await getClientExportRows();
      appendRowsSheet(wb, 'Clients', rows, attachmentLinks);
      exportedCount = rows.length;
    } else if (category === 'CONTACTS') {
      const { rows, attachmentLinks } = await getContactExportRows();
      appendRowsSheet(wb, 'Contacts', rows, attachmentLinks);
      exportedCount = rows.length;
    } else if (category === 'MATERIAL') {
      const { rows, attachmentLinks } = await getMaterialExportRows();
      appendRowsSheet(wb, 'Material', rows, attachmentLinks);
      exportedCount = rows.length;
    } else if (category === 'PRODUCT') {
      const { rows, attachmentLinks } = await getProductExportRows();
      appendRowsSheet(wb, 'Product', rows, attachmentLinks);
      exportedCount = rows.length;
    } else if (category === 'PURCHASE') {
      const { headerRows, itemRows, attachmentLinks } = await getPurchaseExportSheets();
      appendRowsSheet(wb, 'Purchase_Items', itemRows);
      appendRowsSheet(wb, 'Purchase_Orders', headerRows, attachmentLinks);
      exportedCount = headerRows.length;
    } else if (category === 'INVENTORY') {
      const { rows } = await getInventoryExportRows();
      appendRowsSheet(wb, 'Inventory_Transactions', rows);
      exportedCount = rows.length;
    } else {
      const { headerRows, itemRows, attachmentLinks } = await getSalesExportSheets();
      appendRowsSheet(wb, 'Sales_Items', itemRows);
      appendRowsSheet(wb, 'Sales_Orders', headerRows, attachmentLinks);
      exportedCount = headerRows.length;
    }

    await downloadWorkbook(wb, fileName);
    setStatus({ type: 'success', message: `Export file created: ${fileName}`, details: [`Exported ${exportedCount} record(s).`] });
    toast.success(`Exported ${exportedCount} record(s) to ${fileName}.`);
  };

  const handleExportAll = async () => {
    const { sheets, attachmentLinksBySheet } = await getAllExportSheets();
    const wb = new ExcelJS.Workbook();
    Object.entries(sheets).forEach(([sheetName, rows]) => appendRowsSheet(wb, sheetName, rows, (attachmentLinksBySheet as Record<string, (string | undefined)[]>)[sheetName]));
    const fileName = `ERP_Export_All_${dateStamp}.xlsx`;
    await downloadWorkbook(wb, fileName);
    const totalRows = Object.values(sheets).reduce((sum, rows) => sum + rows.length, 0);
    setStatus({ type: 'success', message: `Export file created: ${fileName}`, details: [`Exported ${totalRows} record(s) across ${Object.keys(sheets).length} sheets.`] });
    toast.success(`Exported all categories to ${fileName}.`);
  };

  const handleDownloadTemplate = (category: Category) => {
    const ws = XLSX.utils.aoa_to_sheet([EXPECTED_COLUMNS[category].map(c => c.label)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `ERP_${category}_Template.xlsx`);
    toast.success('Template downloaded.');
  };

  const getTemplateHeaders = (category: Category): string => {
    const cols = EXPECTED_COLUMNS[category];
    const required = cols.filter(c => c.required).map(c => c.label).join('\t');
    const optional = cols.filter(c => !c.required).map(c => c.label).join('\t');
    return `Required columns:\n${required}${optional ? `\nOptional columns:\n${optional}` : ''}`;
  };

  const runFlatValidation = async (category: FlatCategory, rows: Record<string, any>[]) => {
    try {
      const result = category === 'VENDORS' ? await validateVendorsImport(rows)
        : category === 'CLIENTS' ? await validateClientsImport(rows)
        : category === 'CONTACTS' ? await validateContactsImport(rows)
        : category === 'MATERIAL' ? await validateMaterialsImport(rows)
        : category === 'PRODUCT' ? await validateProductsImport(rows)
        : await validateInventoryImport(rows);

      setFlatPreview({ category, totalRows: rows.length, errors: result.errors, records: result.records });
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Validation failed!', details: [err.message || 'Make sure the Excel file is correctly formatted.'] });
      toast.error(err.message || 'Validation failed. Make sure the Excel file is correctly formatted.');
    }
  };

  const handleConfirmFlatImport = async () => {
    if (!flatPreview) return;
    try {
      await commitFlatImport(flatPreview.category, flatPreview.records);
      setStatus({ type: 'success', message: 'Successfully completed import.', details: [`Imported ${flatPreview.records.length} record(s).`] });
      toast.success('Import completed successfully.');
      onDataImported();
      setFlatPreview(null);
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Import failed!', details: [err.message || 'Import failed.'] });
      toast.error(err.message || 'Import failed.');
    }
  };

  const runHeaderDetailValidation = async (category: 'PURCHASE' | 'SALES', rows: Record<string, any>[]) => {
    try {
      if (category === 'PURCHASE') {
        setPurchasePreview(await validatePurchaseImport(rows as unknown as PurchaseImportRow[]));
      } else {
        setSalesPreview(await validateSalesImport(rows as unknown as SalesImportRow[]));
      }
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Validation failed!', details: [err.message || 'Make sure the Excel file is correctly formatted.'] });
      toast.error(err.message || 'Validation failed. Make sure the Excel file is correctly formatted.');
    }
  };

  const executeImport = () => {
    if (!mappingState) return;
    const importCategory = mappingState.category;
    const expectedCols = EXPECTED_COLUMNS[importCategory];

    const missingMapped = expectedCols.filter(col => col.required && !mappingState.mapping[col.key]);
    if (missingMapped.length > 0) {
      setStatus({ type: 'error', message: 'Missing Required Column Mappings', details: missingMapped.map(m => `Please map: ${m.label}`) });
      toast.warning('Please map all required columns before continuing.');
      return;
    }

    // Every category surfaces row-level errors in the Preview screen
    // (validateXImport) before anything is written.
    const parsed: Record<string, any>[] = mappingState.dataRows.map((rowArray) => {
      const rowObj: Record<string, any> = {};
      mappingState.fileHeaders.forEach((header, index) => { rowObj[header] = rowArray[index]; });
      const mappedObj: Record<string, any> = {};
      expectedCols.forEach(col => {
        const fileHeader = mappingState.mapping[col.key];
        mappedObj[col.key] = fileHeader ? rowObj[fileHeader] : undefined;
      });
      return mappedObj;
    });

    setMappingState(null);

    if (isHeaderDetailCategory(importCategory)) {
      runHeaderDetailValidation(importCategory, parsed);
    } else {
      runFlatValidation(importCategory, parsed);
    }
  };

  const handleConfirmPurchaseImport = async () => {
    if (!purchasePreview) return;
    const result = await commitPurchaseImport(purchasePreview.groups);
    setPurchasePreview(null);
    if (result.failed) {
      setStatus({
        type: 'error',
        message: `Import stopped at Purchase No "${result.failed.purchaseNo}".`,
        details: [result.failed.message, `Successfully created before the failure: ${result.succeeded.join(', ') || 'none'}.`],
      });
      toast.error(`Import stopped at Purchase No "${result.failed.purchaseNo}": ${result.failed.message}`);
    } else {
      setStatus({ type: 'success', message: `Successfully imported ${result.succeeded.length} purchase order(s).`, details: result.succeeded });
      toast.success(`Successfully imported ${result.succeeded.length} purchase order(s).`);
      onDataImported();
    }
  };

  const handleConfirmSalesImport = async () => {
    if (!salesPreview) return;
    const result = await commitSalesImport(salesPreview.groups);
    setSalesPreview(null);
    if (result.failed) {
      setStatus({
        type: 'error',
        message: `Import stopped at Sales No "${result.failed.salesNo}".`,
        details: [result.failed.message, `Successfully created before the failure: ${result.succeeded.join(', ') || 'none'}.`],
      });
      toast.error(`Import stopped at Sales No "${result.failed.salesNo}": ${result.failed.message}`);
    } else {
      setStatus({ type: 'success', message: `Successfully imported ${result.succeeded.length} sales order(s).`, details: result.succeeded });
      toast.success(`Successfully imported ${result.succeeded.length} sales order(s).`);
      onDataImported();
    }
  };

  const handleFileProcessing = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        setStatus({ type: 'error', message: 'Only Excel files (.xlsx, .xls) are supported.' });
        toast.warning('Only Excel files (.xlsx, .xls) are supported.');
        return;
      }

      const workbook = XLSX.read(data, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

      if (rows.length < 2) {
        setStatus({ type: 'error', message: 'File has no data rows.' });
        toast.warning('File has no data rows.');
        return;
      }

      const fileHeaders = rows[0].map(h => String(h || '').trim());
      const dataRows = rows.slice(1);

      const expected = EXPECTED_COLUMNS[activeCategory];
      const mapping: Record<string, string> = {};
      expected.forEach(col => {
        const match = fileHeaders.find(h => h.toLowerCase() === col.key.toLowerCase() || h.toLowerCase() === col.label.toLowerCase());
        if (match) mapping[col.key] = match;
      });

      setMappingState({ category: activeCategory, fileHeaders, dataRows, mapping });
    };
    reader.readAsBinaryString(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileProcessing(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileProcessing(e.dataTransfer.files[0]);
  };

  const activePreview = activeCategory === 'PURCHASE' ? purchasePreview
    : activeCategory === 'SALES' ? salesPreview
    : (flatPreview && flatPreview.category === activeCategory ? flatPreview : null);

  // Display-only: the three preview shapes (Purchase/Sales/flat) share `errors`
  // but differ on the other stat(s), so pull those out here instead of doing
  // TS union-narrowing gymnastics inside the JSX below.
  const previewGroupsCount = activeCategory === 'PURCHASE' ? purchasePreview?.groups.length
    : activeCategory === 'SALES' ? salesPreview?.groups.length
    : undefined;
  const previewSecondaryCount = isHeaderDetailCategory(activeCategory)
    ? (activeCategory === 'PURCHASE' ? purchasePreview?.totalDetailRows : salesPreview?.totalDetailRows)
    : flatPreview?.totalRows;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full h-full sm:h-auto sm:max-w-4xl bg-white border-0 sm:border border-slate-200 rounded-none sm:rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-full sm:max-h-[90vh] animate-in fade-in zoom-in duration-200">

        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center space-x-2.5">
            <span className="p-1.5 bg-blue-600 rounded text-white shrink-0 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-sans font-bold text-slate-900 text-sm">ERP Data Import & Export Hub</h3>
              <p className="text-[10px] text-slate-500 font-mono">Load or export Vendors, Clients, Contacts, Material, Product, Purchase, Sales and Inventory Transactions</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold text-base p-1.5 leading-none bg-transparent">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col lg:flex-row gap-5 min-h-0">

          <div className="w-full lg:w-1/3 flex flex-col space-y-4 shrink-0">
            <div className="space-y-1.5">
              <span className="font-semibold block text-slate-700 text-xs uppercase tracking-wider">1. Select Category</span>
              <div className="space-y-1">
                {CATEGORY_LIST.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeCategory === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveCategory(item.id);
                        setStatus({ type: 'idle', message: '' });
                        setMappingState(null);
                        setPurchasePreview(null);
                        setSalesPreview(null);
                        setFlatPreview(null);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium border transition-all text-left ${isActive
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-950'
                        }`}
                    >
                      <div className="flex items-center space-x-2">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </div>
                      <ArrowRight className={`w-3.5 h-3.5 opacity-60 transition-transform ${isActive ? 'translate-x-0.5' : ''}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 text-[11px] text-slate-500 space-y-1.5 border border-slate-150">
              <div className="flex items-center space-x-1.5 font-semibold text-slate-700">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>Format Guidelines</span>
              </div>
              <p className="leading-relaxed">
                Vendors/Clients/Material/Product are matched to existing records by name (and code, for Material/Product) — a match updates that record, otherwise a new one is created.
              </p>
              <p className="leading-relaxed">
                Purchase/Sales rows are grouped into orders by Purchase No/Sales No. Every order is validated before anything is saved — you'll see a preview with any errors first.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h4 className="font-bold text-slate-900 text-xs">Export Data</h4>
                  <p className="text-[10px] text-slate-400">Download the current {activeCategoryLabel} as Excel (attachments, if any, are a link in the sheet).</p>
                </div>
                <Download className="w-4 h-4 text-blue-500 shrink-0" />
              </div>
              <button
                type="button"
                onClick={() => handleExport(activeCategory)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export {activeCategoryLabel}</span>
              </button>
              <button
                type="button"
                onClick={handleExportAll}
                className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export All (8 categories)</span>
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col space-y-4 min-w-0">

            {status.type !== 'idle' && (
              <div className={`p-4 rounded-xl border text-xs leading-relaxed animate-in slide-in-from-top-2 duration-200 ${status.type === 'success'
                ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                : 'bg-red-50 border-red-100 text-red-800'
                }`}>
                <div className="flex items-start space-x-2.5">
                  {status.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5 w-full">
                    <span className="font-bold block text-slate-900">{status.message}</span>
                    {status.details && status.details.length > 0 && (
                      <ul className="list-disc list-inside space-y-1 font-mono text-[10px] bg-white/65 p-2 rounded-lg max-h-[140px] overflow-y-auto">
                        {status.details.map((detail, index) => <li key={index}>{detail}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activePreview ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 overflow-y-auto space-y-4">
                <h4 className="font-bold text-slate-900 text-sm">Import Preview — {activeCategoryLabel}</h4>
                <div className={`grid gap-3 text-center ${isHeaderDetailCategory(activeCategory) ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {isHeaderDetailCategory(activeCategory) && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-lg font-bold text-slate-900">{previewGroupsCount}</div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total Orders</div>
                    </div>
                  )}
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-lg font-bold text-slate-900">{previewSecondaryCount}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">{isHeaderDetailCategory(activeCategory) ? 'Total Detail Rows' : 'Total Rows'}</div>
                  </div>
                  <div className={`rounded-lg p-3 ${activePreview.errors.length > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                    <div className={`text-lg font-bold ${activePreview.errors.length > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{activePreview.errors.length}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Validation Errors</div>
                  </div>
                </div>

                {activePreview.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3 max-h-[220px] overflow-y-auto">
                    <ul className="space-y-1 text-[11px] text-red-800 font-mono">
                      {activePreview.errors.map((err: ImportRowError, idx: number) => (
                        <li key={idx}>Row {err.row}: {err.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex space-x-3 justify-end pt-2 border-t border-slate-100">
                  <button
                    onClick={() => { setPurchasePreview(null); setSalesPreview(null); setFlatPreview(null); }}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={activeCategory === 'PURCHASE' ? handleConfirmPurchaseImport : activeCategory === 'SALES' ? handleConfirmSalesImport : handleConfirmFlatImport}
                    disabled={activePreview.errors.length > 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm &amp; Import
                  </button>
                </div>
              </div>
            ) : mappingState ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 overflow-y-auto">
                <h4 className="font-bold text-slate-900 mb-4 text-sm">Map Columns for {CATEGORY_LIST.find(c => c.id === mappingState.category)?.label}</h4>
                <div className="space-y-3 mb-6">
                  {EXPECTED_COLUMNS[mappingState.category].map(col => (
                    <div key={col.key} className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="w-1/2 flex items-center">
                        <span className="text-xs font-medium text-slate-700">{col.label}</span>
                        {col.required && <span className="text-red-500 ml-1 text-xs">*</span>}
                      </div>
                      <div className="w-1/2 pl-2">
                        <select
                          className="w-full text-xs border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                          value={mappingState.mapping[col.key] || ''}
                          onChange={(e) => {
                            setMappingState(prev => prev ? { ...prev, mapping: { ...prev.mapping, [col.key]: e.target.value } } : null);
                          }}
                        >
                          <option value="">-- Ignore / Not Mapped --</option>
                          {mappingState.fileHeaders.map((h, i) => <option key={i} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex space-x-3 justify-end mt-4">
                  <button onClick={() => setMappingState(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors">
                    Cancel
                  </button>
                  <button onClick={executeImport} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700">
                    Continue to Preview
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[150px] ${dragActive
                      ? 'border-blue-500 bg-blue-50/40 scale-[0.99]'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 dark:hover:bg-slate-950'
                      }`}
                  >
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" />
                    <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                    <span className="text-xs font-semibold text-slate-800 text-center block">Upload Excel file</span>
                    <span className="text-[10px] text-slate-400 text-center mt-1">
                      Drag and drop your <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">.xlsx</code> file or click to browse
                    </span>
                  </div>

                  <div className="bg-slate-900 text-slate-300 rounded-xl p-4 flex flex-col justify-between min-h-[150px] font-mono text-[10px]">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-400">Excel Column Blueprint Template</span>
                        <span className="text-[8px] bg-slate-800 px-1 py-0.5 rounded text-slate-500">Read-only template</span>
                      </div>
                      <pre className="mt-2 text-slate-300 font-mono text-[9px] leading-relaxed max-h-[100px] overflow-y-auto overflow-x-hidden select-all whitespace-pre-wrap">
                        {getTemplateHeaders(activeCategory)}
                      </pre>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(getTemplateHeaders(activeCategory));
                          toast.success('Template copied to clipboard!');
                        }}
                        className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 hover:text-white rounded text-[10px] text-slate-300 font-sans font-medium transition-colors flex items-center justify-center space-x-1"
                      >
                        <Clipboard className="w-3 h-3" />
                        <span>Copy Blueprint</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadTemplate(activeCategory)}
                        className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 hover:text-white rounded text-[10px] text-slate-300 font-sans font-medium transition-colors flex items-center justify-center space-x-1"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download .xlsx</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 shrink-0">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors">
                Close Hub
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

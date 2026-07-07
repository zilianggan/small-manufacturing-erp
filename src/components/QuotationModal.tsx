import React, { useMemo, useState, useEffect } from 'react';
import { X, Printer, FileText, Mail, Phone, MapPin, Database, Factory, Cpu, Wrench } from 'lucide-react';
import { PurchaseHeader, Vendor, CompanyProfile } from '../types';
import { getVendors } from '../services/ContactsService';
import { getCompanyProfile } from '../services/CompanyProfileService';

interface QuotationModalProps {
  purchase: PurchaseHeader | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function QuotationModal({ purchase, isOpen, onClose }: QuotationModalProps) {
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    getVendors().then(setVendors).catch(console.error);
  }, [isOpen]);

  useEffect(() => {
    const load = async () => {
      const cachedProfile = JSON.parse(localStorage.getItem('erp_company_profile'));
      if (cachedProfile && cachedProfile.id) {
        setCompanyProfile(cachedProfile);
        return;
      }
      const profile = await getCompanyProfile();
      if (profile) setCompanyProfile(profile);
    };
    if (isOpen) load();
  }, [isOpen]);

  const [showSignature, setShowSignature] = useState(true);

  const vendorDetails = useMemo(() => {
    if (!purchase) return null;
    return vendors.find(v => v.id === purchase.vendorId);
  }, [purchase, vendors]);

  if (!isOpen || !purchase || !companyProfile) return null;

  const referenceNo = purchase.purchaseNo;
  const grandTotal = purchase.totalPrice;

  const handlePrint = () => {
    const sheet = document.getElementById('printable-quotation-sheet');
    if (!sheet) {
      window.print();
      return;
    }

    try {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        const logoHtml = companyProfile.icon_type === 'custom_image' && companyProfile.icon_data_url
          ? `<img src="${companyProfile.icon_data_url}" style="max-height: 50px; width: auto; object-fit: contain; border-radius: 4px;" />`
          : `<div style="font-size: 24px; font-weight: 800; color: #1e3a8a;">${companyProfile.name}</div>`;

        const signatureHtml = showSignature && companyProfile.signature_url
          ? `<img src="${companyProfile.signature_url}" style="max-height: 70px; max-width: 150px; object-fit: contain;" />`
          : (showSignature ? `<div style="font-family: serif; font-style: italic; font-size: 18px; color: #1e3a8a; font-weight: bold;">${companyProfile.name.split(' ').map(n => n[0]).join('') || 'SJE'}</div>` : '');

        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Purchase Quotation - ${referenceNo}</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 40px; background: #ffffff; }
                .quotation-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f1f5f9; padding-bottom: 24px; margin-bottom: 30px; }
                .company-info { max-width: 380px; }
                .company-name { font-size: 18px; font-weight: 800; color: #0f172a; margin: 6px 0 2px 0; }
                .reg-no { font-size: 8px; font-family: monospace; color: #94a3b8; letter-spacing: 0.05em; text-transform: uppercase; }
                .contact-details { font-size: 10px; color: #64748b; margin-top: 8px; line-height: 1.5; }
                .quotation-title-block { text-align: right; }
                .quotation-title { font-size: 24px; font-weight: 900; color: #0f172a; margin: 0 0 6px 0; }
                .meta-details { font-size: 10px; font-family: monospace; color: #475569; line-height: 1.5; }
                .meta-label { font-weight: 700; }
                .billing-block { display: grid; grid-template-cols: 1fr 1fr; gap: 40px; background-color: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 30px; }
                .bill-to-title { font-size: 9px; font-weight: 700; color: #94a3b8; letter-spacing: 0.1em; margin-bottom: 6px; }
                .vendor-name { font-size: 13px; font-weight: bold; color: #0f172a; margin: 0 0 4px 0; }
                .vendor-info { font-size: 10px; color: #475569; line-height: 1.4; }
                .terms-details { font-size: 10px; color: #475569; line-height: 1.4; }
                .items-title { font-size: 9px; font-weight: 700; color: #94a3b8; letter-spacing: 0.1em; margin-bottom: 8px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
                th { background-color: #f1f5f9; color: #475569; font-size: 9px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.05em; padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
                td { padding: 12px; font-size: 11px; color: #334155; border-bottom: 1px solid #f1f5f9; }
                .item-name { font-weight: 700; color: #0f172a; }
                .item-desc { font-size: 9px; color: #94a3b8; }
                .text-right { text-align: right; }
                .text-mono { font-family: monospace; }
                .totals-section { display: flex; justify-content: space-between; align-items: flex-start; border-top: 1px solid #f1f5f9; padding-top: 20px; margin-bottom: 40px; }
                .declaration { max-width: 360px; font-size: 10px; color: #94a3b8; line-height: 1.5; }
                .declaration-title { font-weight: 700; color: #64748b; margin-bottom: 4px; }
                .totals-box { width: 240px; font-size: 10px; font-family: monospace; line-height: 1.8; }
                .totals-row-grand { display: flex; justify-content: space-between; font-size: 12px; font-weight: 900; font-family: sans-serif; color: #1d4ed8; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 8px; }
                .signatures-area { display: flex; justify-content: flex-start; border-top: 1px solid #f1f5f9; padding-top: 30px; }
                .signature-box { width: 200px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-height: 110px; }
                .signature-image-wrapper { height: 60px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
                .signature-line { width: 140px; border-bottom: 1px solid #cbd5e1; margin-bottom: 6px; }
                .signature-title { font-size: 10px; font-weight: 700; color: #334155; }
              </style>
            </head>
            <body>
              <div class="quotation-header">
                <div class="company-info">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    ${logoHtml}
                    <div>
                      <div class="company-name">${companyProfile.name}</div>
                      <span class="reg-no">REG NO: 202601048292 (159421-P)</span>
                    </div>
                  </div>
                  <div class="contact-details">
                    <p style="margin: 4px 0 2px 0;">📍 ${companyProfile.address || 'Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor, Malaysia'}</p>
                    <p style="margin: 2px 0;">📞 ${companyProfile.phone || '+60 3-8012 3456'}</p>
                    <p style="margin: 2px 0;">✉️ ${companyProfile.email || 'finance@sengjie.com.my'}</p>
                  </div>
                </div>

                <div class="quotation-title-block">
                  <h1 class="quotation-title">PURCHASE QUOTATION</h1>
                  <div class="meta-details">
                    <p style="margin: 2px 0;"><span class="meta-label">Reference No:</span> ${referenceNo}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Quotation Date:</span> ${purchase.quotationDate}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Status:</span> <span style="font-weight: bold; color: #047857; text-transform: uppercase;">${purchase.status}</span></p>
                  </div>
                </div>
              </div>

              <div class="billing-block">
                <div>
                  <div class="bill-to-title">QUOTATION REQUESTED FROM</div>
                  <h3 class="vendor-name">${purchase.vendorName}</h3>
                  ${vendorDetails ? `
                    <div class="vendor-info">
                      <p style="margin: 2px 0; max-width: 250px;">${vendorDetails.address}</p>
                      <p style="margin: 2px 0;">📞 ${vendorDetails.officeNo}</p>
                      <p style="margin: 2px 0;">✉️ ${vendorDetails.email}</p>
                    </div>
                  ` : `<div class="vendor-info">Vendor details not available</div>`}
                </div>

                <div>
                  <div class="bill-to-title">QUOTATION TERMS</div>
                  <p class="terms-details">
                    Please confirm unit pricing and delivery lead time for the materials below. This document is a request for quotation and is not a binding purchase commitment until converted to a Purchase Order.
                  </p>
                </div>
              </div>

              <div class="items-title">MATERIAL LINE ITEMS</div>
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>Material Description</th>
                    <th class="text-right" style="width: 100px;">Quantity</th>
                    <th class="text-right" style="width: 120px;">Unit Cost</th>
                    <th class="text-right" style="width: 140px;">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  ${purchase.details.map((item, idx) => `
                    <tr>
                      <td class="text-mono" style="color: #94a3b8;">${String(idx + 1).padStart(2, '0')}</td>
                      <td>
                        <div class="item-name">${item.materialName}</div>
                        <span class="item-desc">${item.materialCode || item.materialId} | Dimension: ${item.material.dimension}</span>
                      </td>
                      <td class="text-right text-mono">${item.quantity} units</td>
                      <td class="text-right text-mono">RM ${item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-right text-mono" style="font-weight: 700; color: #0f172a;">RM ${item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div class="totals-section">
                <div class="declaration">
                  <div class="declaration-title">QUOTATION DECLARATION</div>
                  <p style="margin: 0;">
                    This quotation request is issued by ${companyProfile.name} for supply evaluation purposes only. All values expressed in Malaysian Ringgit (MYR).
                  </p>
                </div>

                <div class="totals-box">
                  <div class="totals-row-grand">
                    <span>ESTIMATED TOTAL</span>
                    <span>RM ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div class="signatures-area">
                <div class="signature-box">
                  <div class="signature-image-wrapper">
                    ${signatureHtml}
                  </div>
                  <div class="signature-line"></div>
                  <div class="signature-title">Authorized Signature</div>
                </div>
              </div>

              <script>
                window.addEventListener('load', () => {
                  setTimeout(() => {
                    window.print();
                    window.close();
                  }, 400);
                });
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
        return;
      }
    } catch (err) {
      console.warn("Popup-based print blocked or failed, falling back to window.print", err);
    }

    window.focus();
    window.print();
  };

  const renderLogo = () => {
    if (companyProfile.icon_type === 'custom_image' && companyProfile.icon_data_url) {
      return (
        <img
          src={companyProfile.icon_data_url}
          alt="Logo"
          className="w-9 h-9 object-contain rounded border border-slate-150 bg-white"
          referrerPolicy="no-referrer"
        />
      );
    }

    const iconSize = "w-5 h-5 text-white";
    switch (companyProfile.icon_type) {
      case 'factory':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Factory className={iconSize} /></div>;
      case 'cpu':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Cpu className={iconSize} /></div>;
      case 'wrench':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Wrench className={iconSize} /></div>;
      case 'database':
      default:
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Database className={iconSize} /></div>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto print:p-0 print:bg-white print:static">
      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          html, body { background-color: #ffffff !important; color: #000000 !important; margin: 0 !important; padding: 0 !important; height: auto !important; width: 100% !important; }
          aside, header, main, nav, .print\\:hidden, [role="dialog"] > div:not(#printable-quotation-container) { display: none !important; visibility: hidden !important; }
          #printable-quotation-container { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: 100% !important; border: none !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; background: #ffffff !important; visibility: visible !important; }
          #printable-quotation-sheet { padding: 0 !important; margin: 0 !important; border: none !important; visibility: visible !important; }
          #printable-quotation-sheet * { visibility: visible !important; }
        }
      `}} />

      <div
        id="printable-quotation-container"
        className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col my-8 animate-in fade-in zoom-in-95 duration-200 print:shadow-none print:border-none print:my-0 print:rounded-none"
      >
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-4 print:hidden">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <div>
              <span className="font-sans font-bold text-slate-800 text-xs uppercase tracking-wider block leading-none">Purchase Quotation</span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Configure print options and finalize document</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center space-x-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:bg-slate-50 transition-all text-[11px] font-sans font-medium text-slate-600 select-none">
              <input
                type="checkbox"
                checked={showSignature}
                onChange={(e) => setShowSignature(e.target.checked)}
                className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
              />
              <span>Add Signature</span>
            </label>

            <div className="h-6 w-px bg-slate-200 hidden md:block"></div>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow cursor-pointer"
              title="Print quotation"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Quotation</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-8 text-xs text-slate-600 print:p-0 font-sans bg-white" id="printable-quotation-sheet">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-6 border-b border-slate-100 pb-6">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                {renderLogo()}
                <div>
                  <h2 className="font-sans font-extrabold text-slate-900 text-base tracking-tight">{companyProfile.name}</h2>
                  <span className="text-[8px] text-slate-400 font-mono font-bold tracking-widest uppercase">REG NO: 202601048292 (159421-P)</span>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 font-sans space-y-0.5">
                <p className="flex items-start space-x-1.5 max-w-[340px]">
                  <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                  <span>{companyProfile.address || 'Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor, Malaysia'}</span>
                </p>
                <p className="flex items-center space-x-1.5">
                  <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{companyProfile.phone || '+60 3-8012 3456'}</span>
                </p>
                <p className="flex items-center space-x-1.5">
                  <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{companyProfile.email || 'finance@sengjie.com.my'}</span>
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right space-y-1 sm:min-w-[180px]">
              <h1 className="font-sans font-black text-slate-900 text-xl tracking-tight uppercase print:text-2xl">Purchase Quotation</h1>
              <div className="space-y-0.5 text-[10px] font-mono text-slate-500">
                <p><span className="font-bold text-slate-700">Reference No:</span> {referenceNo}</p>
                <p><span className="font-bold text-slate-700">Quotation Date:</span> {purchase.quotationDate}</p>
                <p><span className="font-bold text-slate-700">Status:</span> <span className="text-emerald-700 font-bold uppercase">{purchase.status}</span></p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 bg-slate-50/70 rounded-xl p-4 border border-slate-100 print:bg-white print:border-none print:p-0">
            <div>
              <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">QUOTATION REQUESTED FROM</span>
              <h3 className="font-sans font-bold text-slate-900 text-xs">{purchase.vendorName}</h3>
              {vendorDetails ? (
                <div className="text-[10px] text-slate-500 space-y-0.5 mt-1 leading-relaxed">
                  <p className="max-w-[250px]">{vendorDetails.address}</p>
                  <p className="font-mono">{vendorDetails.officeNo}</p>
                  <p className="font-mono">{vendorDetails.email}</p>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1 italic">Vendor directory match not available.</p>
              )}
            </div>

            <div className="flex flex-col justify-between sm:text-right">
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">QUOTATION TERMS</span>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Please confirm unit pricing and delivery lead time for the materials below. Not a binding purchase commitment until converted to a Purchase Order.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block">MATERIAL LINE ITEMS</span>
            <div className="border border-slate-200 rounded-lg overflow-hidden print:border-slate-300">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider text-[9px] print:bg-slate-50">
                    <th className="p-3">#</th>
                    <th className="p-3">Material Description</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-right">Unit Cost</th>
                    <th className="p-3 text-right">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 print:divide-slate-200">
                  {purchase.details.map((item, idx) => (
                    <tr key={item.detailId || idx}>
                      <td className="p-3 font-mono text-slate-400">{String(idx + 1).padStart(2, '0')}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        <div>{item.materialName}</div>
                        <span className="text-[9px] text-slate-400 font-normal">{item.materialCode || item.materialId} | Dimension: {item.material.dimension}</span>
                      </td>
                      <td className="p-3 text-right font-mono">{item.quantity} units</td>
                      <td className="p-3 text-right font-mono">RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-semibold text-slate-900">RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-4 pt-4 border-t border-slate-100">
            <div className="max-w-[340px] text-[10px] text-slate-400 leading-relaxed">
              <span className="font-bold text-slate-500 block mb-1">QUOTATION DECLARATION</span>
              <p>
                This quotation request is issued by {companyProfile.name} for supply evaluation purposes only. All values expressed in Malaysian Ringgit (MYR).
              </p>
            </div>

            <div className="w-full sm:w-[260px] text-right font-mono text-[10px] space-y-1.5 border-t sm:border-t-0 pt-3 sm:pt-0">
              <div className="flex justify-between pt-2 border-t border-slate-100 font-sans text-xs">
                <span className="font-bold text-slate-800 uppercase">ESTIMATED TOTAL</span>
                <span className="font-mono font-black text-blue-700">RM {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-start pt-8 border-t border-slate-100 items-end">
            <div className="flex flex-col items-center justify-end text-center min-h-[110px] w-48">
              {showSignature ? (
                companyProfile.signature_url ? (
                  <img
                    src={companyProfile.signature_url}
                    alt="Authorized Signature"
                    className="h-14 max-w-[140px] object-contain mb-2 print:max-h-14"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="mb-2 h-14 flex flex-col items-center justify-center select-none">
                    <span className="font-serif italic text-base text-blue-800 font-bold tracking-wider leading-none">
                      {companyProfile.name.split(' ').map(n => n[0]).join('') || 'SJE'}
                    </span>
                    <span className="text-[8px] text-slate-400 font-sans mt-1">Digitally Sealed</span>
                  </div>
                )
              ) : (
                <div className="h-14 mb-2"></div>
              )}
              <div className="w-32 border-b border-slate-300 mb-1.5"></div>
              <span className="font-bold text-slate-700 text-[10px]">Authorized Signature</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

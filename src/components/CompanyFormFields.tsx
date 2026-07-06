/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Attachment } from '../types';
import AttachmentSection from './AttachmentSection';
import { FormField, fieldInputClassName } from './ui';

interface CompanyFormFieldsProps {
  companyName: string; setCompanyName: (v: string) => void;
  companyEmail: string; setCompanyEmail: (v: string) => void;
  companyOfficeNo: string; setCompanyOfficeNo: (v: string) => void;
  companyAddress: string; setCompanyAddress: (v: string) => void;
  companyDescription: string; setCompanyDescription: (v: string) => void;
  companyAttachment: Attachment | undefined; setCompanyAttachment: (a?: Attachment) => void;
}

/** Shared Vendor/Client form fields (company_name, address, office_no, email, description + attachment). */
export default function CompanyFormFields({
  companyName, setCompanyName,
  companyEmail, setCompanyEmail,
  companyOfficeNo, setCompanyOfficeNo,
  companyAddress, setCompanyAddress,
  companyDescription, setCompanyDescription,
  companyAttachment, setCompanyAttachment,
}: CompanyFormFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
      <FormField label="Company Name *" colSpan="sm:col-span-2">
        <input
          type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g. PentaSteel Mills Sdn Bhd"
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Business Email">
        <input
          type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)}
          placeholder="e.g. sales@company.com.my"
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Office No.">
        <input
          type="text" value={companyOfficeNo} onChange={(e) => setCompanyOfficeNo(e.target.value)}
          placeholder="+60 3-8012 3456"
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Address" colSpan="sm:col-span-2">
        <input
          type="text" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)}
          placeholder="Lot 102, Kawasan Perindustrian Balakong, Selangor, Malaysia"
          className={fieldInputClassName}
        />
      </FormField>
      <FormField label="Description" colSpan="sm:col-span-2">
        <textarea
          value={companyDescription} onChange={(e) => setCompanyDescription(e.target.value)}
          rows={2}
          placeholder="Brief notes about this company..."
          className={fieldInputClassName}
        />
      </FormField>
      <div className="sm:col-span-2">
        <AttachmentSection
          attachment={companyAttachment}
          onAttachmentChange={setCompanyAttachment}
          label="Business Profile Documents (Optional)"
          helperText="Upload any agreement, invoice, credentials, or branding assets (Max 1MB)"
        />
      </div>
    </div>
  );
}

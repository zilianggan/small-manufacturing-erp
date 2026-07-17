/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { PurchaseHeader, SalesHeader } from "../types";

// Phone numbers are already normalized to E.164 (+60123456789, see PhoneInput.tsx) —
// wa.me just wants the digits, no leading +.
export const buildWhatsappUrl = (phone: string, message: string): string =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

const fillTemplate = (content: string, vars: Record<string, string>): string =>
  content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');

const money = (n: number): string => `RM ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Purchase side is a request for quotation — material + qty only, no price to quote back yet.
// vendor_name greets the actual person being messaged (the contact), not the company — safe since
// this only runs when a contact is set (WhatsApp button is hidden otherwise).
export const fillPurchaseTemplate = (template: string, purchase: PurchaseHeader): string =>
  fillTemplate(template, {
    vendor_name: purchase.contactName || purchase.vendorName,
    quotation_no: purchase.purchaseNo,
    items: purchase.details.map((d, i) => `${i + 1}. ${d.materialName} x ${d.quantity}`).join('\n'),
  });

// Sales side is the offer itself — items carry unit price + line total, plus a grand total.
export const fillSalesTemplate = (template: string, sales: SalesHeader): string =>
  fillTemplate(template, {
    customer_name: sales.contactName || sales.clientName,
    quotation_no: sales.salesNo,
    items: sales.details.map((d, i) => `${i + 1}. ${d.productName} x ${d.quantity} @ ${money(d.unitPrice)} = ${money(d.totalPrice)}`).join('\n'),
    grand_total: money(sales.totalAmount),
  });

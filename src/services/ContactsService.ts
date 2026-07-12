/**
 * Contacts module service layer (Vendors + Clients + their people).
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * the CompanyProfileService / SystemAdminService pattern: no db.ts full-list
 * localStorage cache, no server.ts REST hop, no useTableData hook. Search and
 * per-company filtering happen server-side via the Supabase query builder.
 *
 * Naming note: "Vendors & Clients" is the Contacts tab (companies). `Contact`
 * (person) belongs to exactly one company via vendorId/clientId.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord, generateId } from "../helper";
import { Vendor, Client, Contact } from "../types";
import { getJobPositions } from "./SystemAdminService";

export { getJobPositions, generateId };

// Vendors and Clients share an identical column shape.
const mapCompanyRow = (row: any): Vendor & Client => ({
  id: row.id,
  companyName: row.company_name,
  email: row.email,
  officeNo: row.office_no,
  address: row.address,
  description: row.description || '',
  attachments: row.attachments || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const fetchCompanies = async (table: 'vendors' | 'clients', search: string): Promise<any[]> => {
  let query = supabase.from(table).select('*').order('created_at', { ascending: true });
  const q = search.trim();
  if (q) query = query.or(`company_name.ilike.%${q}%,email.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error(`getCompanies(${table})`, error);
    return [];
  }
  return (data || []).map(mapCompanyRow);
};

export const getVendors = (search = ''): Promise<Vendor[]> => fetchCompanies('vendors', search);
export const getClients = (search = ''): Promise<Client[]> => fetchCompanies('clients', search);

export const saveVendor = (vendor: Vendor): Promise<void> => upsertRecord('erp_vendors', vendor);
export const deleteVendor = (id: string): Promise<void> => deleteRecord('erp_vendors', id);
export const saveClient = (client: Client): Promise<void> => upsertRecord('erp_clients', client);
export const deleteClient = (id: string): Promise<void> => deleteRecord('erp_clients', id);

const mapContactRow = (row: any): Contact => ({
  id: row.id,
  fullName: row.full_name,
  contactNo: row.contact_no,
  email: row.email,
  jobPositionId: row.job_position,
  vendorId: row.vendor_id,
  clientId: row.client_id,
  attachments: row.attachments || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

interface ContactQuery {
  vendorId?: string;
  clientId?: string;
  search?: string;
}

// Contacts are always scoped to (and fetched per) a single vendor/client.
export const getContacts = async ({ vendorId, clientId, search }: ContactQuery): Promise<Contact[]> => {
  let query = supabase.from('contacts').select('*').order('created_at', { ascending: true });
  if (vendorId) query = query.eq('vendor_id', vendorId);
  if (clientId) query = query.eq('client_id', clientId);
  const q = search?.trim();
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error('getContacts', error);
    return [];
  }
  return (data || []).map(mapContactRow);
};

export const saveContact = (contact: Contact): Promise<void> => upsertRecord('erp_contacts', contact);
export const deleteContact = (id: string): Promise<void> => deleteRecord('erp_contacts', id);

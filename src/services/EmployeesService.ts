/**
 * Employees module service layer.
 *
 * Pattern A: talks to Supabase directly via helper.ts's shared primitives,
 * mirroring ContactsService.ts. No db.ts full-list localStorage cache, no
 * server.ts REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord, generateId } from "../helper";
import { Employee } from "../types";
import { getJobPositions } from "./SystemAdminService";

export { getJobPositions, generateId };

const mapEmployeeRow = (row: any): Employee => ({
  id: row.id,
  fullName: row.full_name,
  contactNo: row.contact_no,
  email: row.email,
  jobPositionId: row.job_position,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const getEmployees = async (search = ''): Promise<Employee[]> => {
  let query = supabase.from('employees').select('*').order('created_at', { ascending: true });
  const q = search.trim();
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error('getEmployees', error);
    return [];
  }
  return (data || []).map(mapEmployeeRow);
};

export const saveEmployee = (employee: Employee): Promise<void> => upsertRecord('erp_employees', employee);
export const deleteEmployee = (id: string): Promise<void> => deleteRecord('erp_employees', id);

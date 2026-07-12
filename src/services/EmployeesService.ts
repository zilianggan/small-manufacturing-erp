/**
 * Employees module service layer.
 *
 * Pattern A: talks to Supabase directly via helper.ts's shared primitives,
 * mirroring ContactsService.ts. No db.ts full-list localStorage cache, no
 * server.ts REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord, generateId } from "../helper";
import { Employee, EmployeeConsumableUsageItem } from "../types";
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

export const getEmployeeById = async (id: string): Promise<Employee | null> => {
  const { data, error } = await supabase.from('employees').select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('getEmployeeById', error);
    return null;
  }
  return data ? mapEmployeeRow(data) : null;
};

// Consumable materials this employee worked on: their assigned workflow tasks →
// the consumable production_material_usage rows on those orders. Used by
// EmployeeDetailView. (Consumables attach to an order's first line, so an
// employee is credited via that first line's assignment.)
export const getEmployeeConsumableUsage = async (employeeId: string): Promise<EmployeeConsumableUsageItem[]> => {
  const { data: tasks, error: taskError } = await supabase
    .from('workflow_tasks')
    .select('stage, sales_detail_id')
    .eq('employee_id', employeeId);
  if (taskError) {
    console.error('getEmployeeConsumableUsage(tasks)', taskError);
    return [];
  }
  const stageByDetail = new Map<string, string>();
  (tasks || []).forEach((t: any) => { if (t.sales_detail_id) stageByDetail.set(t.sales_detail_id, t.stage); });
  const detailIds = Array.from(stageByDetail.keys());
  if (detailIds.length === 0) return [];

  const { data, error } = await supabase
    .from('production_material_usage')
    .select('id, actual_quantity, created_at, sales_detail_id, material!inner(name, code, material_type), sales_detail(sales_header(id, sales_no))')
    .in('sales_detail_id', detailIds)
    .eq('material.material_type', 'CONSUMABLE_MATERIAL')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getEmployeeConsumableUsage(usage)', error);
    return [];
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    materialName: row.material?.name || '',
    materialCode: row.material?.code || undefined,
    quantity: Number(row.actual_quantity) || 0,
    salesHeaderId: row.sales_detail?.sales_header?.id,
    salesNo: row.sales_detail?.sales_header?.sales_no,
    stage: stageByDetail.get(row.sales_detail_id) || undefined,
    date: row.created_at,
  }));
};

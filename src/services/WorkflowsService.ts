/**
 * Workflows module service layer (production kanban).
 *
 * Pattern A: talks to Supabase directly, mirroring OrdersService.ts /
 * PurchasesService.ts. No db.ts, no server.ts REST hop, no useTableData.
 *
 * `workflow_tasks.status` (IN_PRODUCTION/DONE/CANCELLED) is lifecycle state
 * owned exclusively by OrdersService.ts (startProduction/confirmProductionDone/
 * cancelSalesOrder). This service only reads status to filter the board and
 * never writes it. `stage` (the 5-step shop-floor position) is owned
 * exclusively here — advancing it has no inventory or order-status side
 * effects; those live solely in OrdersService's confirmProductionDone.
 */
import { supabase } from "./supabase";
import { WorkflowTask } from "../types";

const mapTaskRow = (row: any): WorkflowTask => ({
    id: row.id,
    headerId: row.sales_detail?.header_id,
    salesNo: row.sales_detail?.sales_header?.sales_no || '',
    productName: row.sales_detail?.product_name || '',
    quantity: Number(row.sales_detail?.quantity) || 0,
    stage: row.stage,
    employeeId: row.employee_id || undefined,
    employeeName: row.employees?.name || undefined,
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    remark: row.remark || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

export const getWorkflowTasks = async (): Promise<WorkflowTask[]> => {
    const { data, error } = await supabase
        .from('workflow_tasks')
        .select('*, sales_detail(header_id, product_name, quantity, sales_header(sales_no)), employees(full_name)')
        .eq('status', 'IN_PRODUCTION');
    if (error) {
        console.error('getWorkflowTasks', error);
        throw error;
    }
    return (data || []).map(mapTaskRow);
};

export const updateWorkflowStage = async (taskId: string, stage: WorkflowTask['stage']): Promise<void> => {
    const { error } = await supabase.from('workflow_tasks').update({ stage }).eq('id', taskId);
    if (error) {
        console.error('updateWorkflowStage', error);
        throw error;
    }
};

export const assignEmployee = async (taskId: string, employeeId: string | null): Promise<void> => {
    const { error } = await supabase.from('workflow_tasks').update({ employee_id: employeeId }).eq('id', taskId);
    if (error) {
        console.error('assignEmployee', error);
        throw error;
    }
};

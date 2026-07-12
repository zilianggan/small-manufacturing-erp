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
import { generateId } from "../helper";
import { ConsumptionMode, WorkflowTask } from "../types";

const mapTaskRow = (row: any): WorkflowTask => ({
    id: row.id,
    headerId: row.sales_detail?.header_id,
    salesNo: row.sales_detail?.sales_header?.sales_no || '',
    clientId: row.sales_detail?.sales_header?.client_id || '',
    clientName: row.sales_detail?.sales_header?.clients?.company_name || '',
    productionDueDate: row.sales_detail?.sales_header?.production_due_date || undefined,
    priority: row.sales_detail?.sales_header?.priority || 'MEDIUM',
    productName: row.sales_detail?.product_name || '',
    quantity: Number(row.sales_detail?.quantity) || 0,
    stage: row.stage,
    employeeId: row.employee_id || undefined,
    employeeName: row.employees?.full_name || undefined,
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    remark: row.remark || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

export const getWorkflowTasks = async (): Promise<WorkflowTask[]> => {
    const { data, error } = await supabase
        .from('workflow_tasks')
        .select('*, sales_detail(header_id, product_name, quantity, sales_header(sales_no, client_id, production_due_date, priority, clients(company_name))), employees(full_name)')
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

// ─── Consumables used during production ──────────────────────────────────────
// Recorded here (not on the sales order) since consumables like paint/glue are
// added by the shop floor mid-job. Stored as production_material_usage rows on
// the order's first sales_detail line — consumables are order-level, not
// line-specific. confirmProductionDone deducts AUTOMATIC ones at completion.
export interface OrderConsumable {
    id: string;
    materialId: string;
    materialName: string;
    materialCode?: string;
    consumptionMode?: ConsumptionMode;
    quantity: number;
    remark?: string;
}

export const getOrderConsumables = async (headerId: string): Promise<OrderConsumable[]> => {
    const { data, error } = await supabase
        .from('production_material_usage')
        .select('id, actual_quantity, remark, material_id, material!inner(name, code, material_type, consumption_mode), sales_detail!inner(header_id)')
        .eq('sales_detail.header_id', headerId)
        .eq('material.material_type', 'CONSUMABLE_MATERIAL');
    if (error) {
        console.error('getOrderConsumables', error);
        return [];
    }
    return (data || []).map((row: any) => ({
        id: row.id,
        materialId: row.material_id,
        materialName: row.material?.name || '',
        materialCode: row.material?.code || undefined,
        consumptionMode: row.material?.consumption_mode || undefined,
        quantity: Number(row.actual_quantity) || 0,
        remark: row.remark || undefined,
    }));
};

export const addOrderConsumable = async (headerId: string, materialId: string, quantity: number, remark?: string): Promise<void> => {
    const { data: firstLine, error: lineError } = await supabase
        .from('sales_detail')
        .select('detail_id')
        .eq('header_id', headerId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (lineError || !firstLine) {
        console.error('addOrderConsumable(line)', lineError);
        throw lineError || new Error('No sales_detail line for order');
    }

    const { error } = await supabase.from('production_material_usage').insert({
        id: generateId(),
        sales_detail_id: firstLine.detail_id,
        material_id: materialId,
        planned_quantity: 0,
        actual_quantity: quantity,
        returned_quantity: 0,
        remark: remark || null,
    });
    if (error) {
        console.error('addOrderConsumable', error);
        throw error;
    }
};

export const removeOrderConsumable = async (usageId: string): Promise<void> => {
    const { error } = await supabase.from('production_material_usage').delete().eq('id', usageId);
    if (error) {
        console.error('removeOrderConsumable', error);
        throw error;
    }
};

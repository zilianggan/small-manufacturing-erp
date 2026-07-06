import { JobPosition, MaterialCategory, ProductCategory, SystemAdminData } from "../types";
import { deleteRecord, getRecords, getStorageItem, loadTable, removeStorageItem, setStorageItem, upsertRecord } from "../helper";
import { supabase } from "./supabase";

export const getJobPositions = async (): Promise<JobPosition[]> => {
    const cached = getStorageItem("erp_job_positions", null);
    if (cached) return cached;
    const data = await getRecords<JobPosition>("job_positions");
    if (data) setStorageItem("erp_job_positions", data);
    return data;
};
export const getMaterialCategories = async (): Promise<MaterialCategory[]> => {
    const cached = getStorageItem("erp_material_categories", null);
    if (cached) return cached;
    const data = await getRecords<JobPosition>("material_categories");
    if (data) setStorageItem("erp_material_categories", data);
    return data;
};
export const getProductCategories = async (): Promise<ProductCategory[]> => {
    const cached = getStorageItem("erp_product_categories", null);
    if (cached) return cached;
    const data = await getRecords<JobPosition>("product_categories");
    if (data) setStorageItem("erp_product_categories", data);
    return data;
};

export const saveJobPositions = async (items: JobPosition[], changed?: JobPosition, deletedId?: string) => {
    setStorageItem('erp_job_positions', items);
    if (changed) await upsertRecord('erp_job_positions', changed);
    if (deletedId) await deleteRecord('erp_job_positions', deletedId);
    removeStorageItem("erp_job_positions");
};

export const saveMaterialCategories = async (items: MaterialCategory[], changed?: MaterialCategory, deletedId?: string) => {
    if (changed) await upsertRecord('erp_material_categories', changed);
    if (deletedId) await deleteRecord('erp_material_categories', deletedId);
    removeStorageItem("erp_material_categories");
};

export const saveProductCategories = async (items: ProductCategory[], changed?: ProductCategory, deletedId?: string) => {
    if (changed) await upsertRecord('erp_product_categories', changed);
    if (deletedId) await deleteRecord('erp_product_categories', deletedId);
    removeStorageItem("erp_product_categories");
};

export const loadSystemAdminData = async () => {
    // const tables = [
    //     ['erp_job_positions', 'job_positions'],
    //     ['erp_material_categories', 'material_categories'],
    //     ['erp_product_categories', 'product_categories'],
    // ] as const;
    // await Promise.allSettled(tables.map(([key, table]) => loadTable(key, table)));
    const { data, error } = await supabase
        .rpc("get_system_admin_data")
        .single<SystemAdminData>();
    if (error) throw error;
    return data;
};
/**
 * Inventory module service layer.
 *
 * Centralizes data access for the Inventory view behind one import, mirroring
 * the CompanyProfileService / SystemAdminService pattern:
 *   - Views call `saveInventory` for writes (localStorage cache + Supabase upsert/delete).
 *   - Reads for the main table go through the `useTableData` hook (server-backed,
 *     search + filter aware) — this service only covers writes + reference data.
 *   - Material/Product category reference data is owned by SystemAdminService
 *     (single source of truth) and simply re-exported here so InventoryView
 *     doesn't need a second import for it.
 */
import { deleteRecord, setStorageItem, upsertRecord } from "../helper";
import { InventoryItem } from "../types";
import { generateId } from "./db";
import { getMaterialCategories, getProductCategories } from "./SystemAdminService";

export { generateId, getMaterialCategories, getProductCategories };

export const saveInventory = async (items: InventoryItem[], changed?: InventoryItem, deletedId?: string) => {
    setStorageItem('erp_inventory', items);
    if (changed) await upsertRecord('erp_inventory', changed);
    if (deletedId) await deleteRecord('erp_inventory', deletedId);
};

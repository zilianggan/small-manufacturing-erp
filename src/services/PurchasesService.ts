/**
 * Purchases module service layer (Purchase Orders).
 *
 * Centralizes writes for the Purchases view behind one import, mirroring the
 * Inventory / Orders service pattern. `addPurchaseOrder` and
 * `updatePurchaseOrderStatus` also own the cross-entity side effects (raw
 * material stock adjustments) so they stay in `db.ts` where the rest of that
 * orchestration logic lives — this is just the public facade the view
 * imports from. Material category reference data is owned by
 * SystemAdminService (single source of truth) and re-exported here.
 */
import { addPurchaseOrder, savePurchaseOrders, updatePurchaseOrderStatus } from "./db";
import { getMaterialCategories } from "./SystemAdminService";

export { addPurchaseOrder, savePurchaseOrders, updatePurchaseOrderStatus, getMaterialCategories };

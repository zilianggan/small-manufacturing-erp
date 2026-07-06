/**
 * Orders module service layer (Sales Orders).
 *
 * Centralizes writes for the Orders view behind one import, mirroring the
 * Inventory / Contacts / Employees service pattern. `addSalesOrder` and
 * `updateSalesOrderStatus` also own the cross-entity side effects (workflow
 * task creation, client revenue totals) so they stay in `db.ts` where the
 * rest of that orchestration logic lives — this is just the public facade
 * the view imports from.
 */
import { generateId, addSalesOrder, saveSalesOrders, updateSalesOrderStatus } from "./db";

export { generateId, addSalesOrder, saveSalesOrders, updateSalesOrderStatus };

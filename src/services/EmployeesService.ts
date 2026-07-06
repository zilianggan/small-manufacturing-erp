/**
 * Employees module service layer.
 *
 * Centralizes writes for the Employees view behind one import, mirroring the
 * Inventory / Contacts service pattern. Job position reference data is owned
 * by SystemAdminService (single source of truth) and re-exported here so
 * EmployeesView doesn't need a second import for it.
 */
import { generateId, saveEmployees } from "./db";
import { getJobPositions } from "./SystemAdminService";

export { generateId, saveEmployees, getJobPositions };

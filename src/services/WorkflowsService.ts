/**
 * Workflows module service layer (production workflow tasks).
 *
 * Centralizes writes for the Workflows view behind one import, mirroring the
 * Inventory / Orders / Purchases service pattern. `updateWorkflowStep` owns
 * the cross-entity side effects (inventory adjustments, sales order status
 * transitions) so it stays in `db.ts` where that orchestration logic lives —
 * this is just the public facade the view imports from.
 */
import { saveWorkflowTasks, updateWorkflowStep } from "./db";

export { saveWorkflowTasks, updateWorkflowStep };

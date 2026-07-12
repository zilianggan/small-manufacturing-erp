import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, User, Calendar, GripVertical, Trash2, FlaskConical } from 'lucide-react';
import { Material, WorkflowTask } from '../types';
import type { OrderConsumable } from '../services/WorkflowsService';
import { PRIORITY_META, getDueUrgency } from '../utils/priority';
import { formatDate } from '../utils/date';
import { Badge, Button } from './ui';
import ComboBox from './ComboBox';

interface OrderAccordionProps {
  headerId: string;
  salesNo: string;
  clientName: string;
  productionDueDate?: string;
  priority: WorkflowTask['priority'];
  tasks: WorkflowTask[];
  colKey: WorkflowTask['stage'];
  onAssignTask: (taskId: string, employeeId: string) => void;
  employees: any[];
  onSearchEmployees: (query: string) => void;
  employeesSearchLoading: boolean;
  onAdvance: (taskId: string, currentStage: WorkflowTask['stage']) => void;
  onRevert: (taskId: string, currentStage: WorkflowTask['stage']) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** Set by WorkflowsView to make the card a kanban drag source (drop target is the column). */
  onDragStart?: (e: React.DragEvent) => void;
  // Consumables recorded against this order (paint/glue/etc.). Undefined until
  // the order is expanded and its list has loaded.
  consumableMaterials: Material[];
  consumables?: OrderConsumable[];
  onAddConsumable: (headerId: string, materialId: string, quantity: number, remark?: string) => void;
  onRemoveConsumable: (headerId: string, usageId: string) => void;
}

export default function OrderAccordion({
  headerId, salesNo, clientName, productionDueDate, priority, tasks, onAssignTask, employees,
  onSearchEmployees, employeesSearchLoading, onAdvance, onRevert, isOpen, onToggle, onDragStart,
  consumableMaterials, consumables, onAddConsumable, onRemoveConsumable,
}: OrderAccordionProps) {
  const handleBulkAssign = (employeeId: string) => {
    tasks.forEach(task => onAssignTask(task.id, employeeId));
  };

  const employeeOptions = employees.map(emp => ({ value: emp.id, label: emp.fullName }));
  const urgency = getDueUrgency(productionDueDate);

  // Consumable draft (pick material + qty, then Add)
  const [consumableId, setConsumableId] = useState('');
  const [consumableQty, setConsumableQty] = useState(1);
  const consumableOptions = consumableMaterials.map(m => ({ value: m.id, label: m.name, sublabel: m.code }));
  const handleAddConsumable = () => {
    if (!consumableId || consumableQty <= 0) return;
    onAddConsumable(headerId, consumableId, consumableQty);
    setConsumableId('');
    setConsumableQty(1);
  };

  return (
    <div
      className="bg-card border border-border rounded-lg shadow-sm"
      draggable={!!onDragStart}
      onDragStart={onDragStart}
    >
      <div
        className={`flex items-center justify-between gap-2 p-2 cursor-pointer hover:bg-secondary/40 transition-colors ${onDragStart ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onClick={onToggle}
      >
        {onDragStart && <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono font-bold text-foreground">#{salesNo}</span>
            <Badge variant={PRIORITY_META[priority].variant} className="px-1.5 py-0 text-[9px]">{PRIORITY_META[priority].label}</Badge>
            {urgency && <Badge variant={urgency.variant} className="px-1.5 py-0 text-[9px]">{urgency.label}</Badge>}
          </div>
          <p className="text-[9px] text-muted-foreground truncate">{clientName}</p>
          {productionDueDate && (
            <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-mono">
              <Calendar className="w-2.5 h-2.5" />
              <span>Due {formatDate(productionDueDate)}</span>
            </div>
          )}
        </div>
        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      </div>

      {isOpen && (
        <div className="p-2 border-t border-border space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <ComboBox
            value=""
            onChange={handleBulkAssign}
            noneLabel="Bulk Assign..."
            options={employeeOptions}
            onSearch={onSearchEmployees}
            searchLoading={employeesSearchLoading}
          />

          {/* Consumables used (paint/glue/etc.) — deducted at production completion.
              Kept above the task rows so each task's Prev/Next stays bottommost. */}
          <div className="pb-2 border-b border-border space-y-1.5">
            <div className="flex items-center gap-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
              <FlaskConical className="w-3 h-3" /> Consumables
            </div>
            {consumables?.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-1 text-[10px] bg-secondary/30 border border-border rounded px-1.5 py-1">
                <span className="truncate text-card-foreground">{c.materialName} × {c.quantity}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant={c.consumptionMode === 'AUTOMATIC' ? 'success' : 'secondary'} className="px-1 py-0 text-[8px]">
                    {c.consumptionMode === 'AUTOMATIC' ? 'Auto' : 'Manual'}
                  </Badge>
                  <button type="button" onClick={() => onRemoveConsumable(headerId, c.id)} className="text-destructive/70 hover:text-destructive p-0.5" title="Remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
            {consumableOptions.length === 0 ? (
              <p className="text-[9px] text-muted-foreground italic">No consumable materials defined.</p>
            ) : (
              <div className="flex items-end gap-1">
                <div className="flex-1 min-w-0">
                  <ComboBox value={consumableId} onChange={setConsumableId} noneLabel="Add consumable..." options={consumableOptions} />
                </div>
                <input
                  type="number" min="1" value={consumableQty}
                  onChange={(e) => setConsumableQty(Number(e.target.value))}
                  className="w-12 px-1.5 py-1 bg-card border border-border rounded text-[10px] text-right shrink-0"
                />
                <Button type="button" size="sm" className="h-7 px-2 text-[9px] shrink-0" onClick={handleAddConsumable}>Add</Button>
              </div>
            )}
          </div>

          {tasks.map(task => (
            <div key={task.id} className="text-[10px] p-2 bg-secondary/30 border border-border rounded space-y-1.5">
              <p className="font-semibold text-card-foreground">{task.quantity}x {task.productName}</p>
              <div className="flex items-center gap-1.5">
                <User className="w-3 h-3 text-muted-foreground shrink-0" />
                <ComboBox
                  value={task.employeeId || ''}
                  onChange={(v) => onAssignTask(task.id, v)}
                  noneLabel="Unassigned"
                  options={employeeOptions}
                  onSearch={onSearchEmployees}
                  searchLoading={employeesSearchLoading}
                />
              </div>
              <div className="flex justify-between pt-1 border-t border-border">
                {task.stage !== 'PREPARATION' ? (
                  <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[9px]" onClick={() => onRevert(task.id, task.stage)}>
                    <ChevronLeft className="w-3 h-3" /> Prev
                  </Button>
                ) : <div />}
                {task.stage !== 'COMPLETED' ? (
                  <Button type="button" size="sm" className="h-6 px-2 text-[9px]" onClick={() => onAdvance(task.id, task.stage)}>
                    Next <ChevronRight className="w-3 h-3" />
                  </Button>
                ) : <div />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, User, Calendar, GripVertical } from 'lucide-react';
import { WorkflowTask } from '../types';
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
}

export default function OrderAccordion({
  salesNo, clientName, productionDueDate, priority, tasks, onAssignTask, employees,
  onSearchEmployees, employeesSearchLoading, onAdvance, onRevert, isOpen, onToggle, onDragStart,
}: OrderAccordionProps) {
  const handleBulkAssign = (employeeId: string) => {
    tasks.forEach(task => onAssignTask(task.id, employeeId));
  };

  const employeeOptions = employees.map(emp => ({ value: emp.id, label: emp.fullName }));
  const urgency = getDueUrgency(productionDueDate);

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

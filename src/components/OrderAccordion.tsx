import React from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, User } from 'lucide-react';
import { WorkflowTask } from '../types';
import ComboBox from './ComboBox';

interface OrderAccordionProps {
  headerId: string;
  salesNo: string;
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
}

export default function OrderAccordion({ salesNo, tasks, onAssignTask, employees, onSearchEmployees, employeesSearchLoading, onAdvance, onRevert, isOpen, onToggle }: OrderAccordionProps) {
  const handleBulkAssign = (employeeId: string) => {
    tasks.forEach(task => onAssignTask(task.id, employeeId));
  };

  const employeeOptions = employees.map(emp => ({ value: emp.id, label: emp.fullName }));

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div
        className="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-50"
        onClick={onToggle}
      >
        <span className="text-[10px] font-mono font-bold text-slate-700">Order #{salesNo}</span>
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </div>

      {isOpen && (
        <div className="p-2 border-t border-slate-100 space-y-2">
            <ComboBox
              value=""
              onChange={handleBulkAssign}
              noneLabel="Bulk Assign..."
              options={employeeOptions}
              onSearch={onSearchEmployees}
              searchLoading={employeesSearchLoading}
            />
          {tasks.map(task => (
            <div key={task.id} className="text-[10px] p-2 bg-slate-50 border border-slate-200 rounded shadow-sm space-y-1.5 mb-3">
                <p className="font-semibold text-slate-800">{task.quantity}x {task.productName}</p>
                <div className="flex items-center space-x-1.5">
                    <User className="w-3 h-3 text-slate-400" />
                    <ComboBox
                      value={task.employeeId || ''}
                      onChange={(v) => onAssignTask(task.id, v)}
                      noneLabel="Unassigned"
                      options={employeeOptions}
                      onSearch={onSearchEmployees}
                      searchLoading={employeesSearchLoading}
                    />
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                    {task.stage !== 'PREPARATION' ? (
                        <button onClick={() => onRevert(task.id, task.stage)} className="flex items-center text-[9px] px-2 py-0.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded">
                            <ChevronLeft className="w-3 h-3 mr-0.5" /> Prev
                        </button>
                    ) : <div></div>}
                    {task.stage !== 'COMPLETED' ? (
                        <button onClick={() => onAdvance(task.id, task.stage)} className="flex items-center text-[9px] px-2 py-0.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded">
                            Next <ChevronRight className="w-3 h-3 ml-0.5" />
                        </button>
                    ) : <div></div>}
                </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

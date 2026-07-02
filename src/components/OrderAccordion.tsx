import React from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, User } from 'lucide-react';
import { WorkflowTask } from '../types';

interface OrderAccordionProps {
  orderId: string;
  tasks: WorkflowTask[];
  colKey: WorkflowTask['currentStep'];
  onAssignTask: (taskId: string, employeeName: string) => void;
  employees: any[];
  onAdvance: (taskId: string, currentStep: WorkflowTask['currentStep']) => void;
  onRevert: (taskId: string, currentStep: WorkflowTask['currentStep']) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function OrderAccordion({ orderId, tasks, colKey, onAssignTask, employees, onAdvance, onRevert, isOpen, onToggle }: OrderAccordionProps) {
  const handleBulkAssign = (employeeName: string) => {
    tasks.forEach(task => onAssignTask(task.id, employeeName));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div 
        className="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-50"
        onClick={onToggle}
      >
        <span className="text-[10px] font-mono font-bold text-slate-700">Order #{orderId.split('-')[1] || orderId}</span>
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </div>
      
      {isOpen && (
        <div className="p-2 border-t border-slate-100 space-y-2">
            <select
                onChange={(e) => handleBulkAssign(e.target.value)}
                className="w-full text-[9px] border rounded p-1 mb-2"
            >
                <option value="">Bulk Assign</option>
                {employees.filter(emp => emp.status === 'ACTIVE').map(emp => (
                    <option key={emp.id} value={emp.name}>{emp.name}</option>
                ))}
            </select>
          {tasks.map(task => (
            <div key={task.id} className="text-[10px] p-2 bg-slate-50 border border-slate-200 rounded shadow-sm space-y-1.5 mb-3">
                <p className="font-semibold text-slate-800">{task.quantity}x {task.productName}</p>
                <div className="flex items-center space-x-1.5">
                    <User className="w-3 h-3 text-slate-400" />
                    <select
                        value={task.assignedTo || ''}
                        onChange={(e) => onAssignTask(task.id, e.target.value)}
                        className="w-full text-[9px] border border-slate-200 rounded p-0.5 bg-white"
                    >
                        <option value="">Unassigned</option>
                        {employees.filter(emp => emp.status === 'ACTIVE').map(emp => (
                            <option key={emp.id} value={emp.name}>{emp.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                    {task.currentStep !== 'PREPARATION' ? (
                        <button onClick={() => onRevert(task.id, task.currentStep)} className="flex items-center text-[9px] px-2 py-0.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded">
                            <ChevronLeft className="w-3 h-3 mr-0.5" /> Prev
                        </button>
                    ) : <div></div>}
                    {task.currentStep !== 'COMPLETED' ? (
                        <button onClick={() => onAdvance(task.id, task.currentStep)} className="flex items-center text-[9px] px-2 py-0.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded">
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

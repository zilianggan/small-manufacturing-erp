import React from 'react';
import { WorkflowTask } from '../types';
import { User } from 'lucide-react';
import ComboBox from './ComboBox';

interface TaskCardProps {
  task: WorkflowTask;
  onAssignTask: (taskId: string, employeeName: string) => void;
  employees: any[];
  onAdvance: () => void;
  onRevert: () => void;
}

export default function TaskCard({ task, onAssignTask, employees, onAdvance, onRevert }: TaskCardProps) {
  return (
    <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-2 text-xs">
        <div className="font-semibold text-slate-900">{task.productName}</div>
        <div className="text-[10px] text-slate-500 font-mono">Order: {task.orderId}</div>
        <div className="flex items-center space-x-2 text-[10px]">
            <User className="w-3 h-3 text-slate-400 shrink-0" />
            <ComboBox
              value={task.assignedTo || ''}
              onChange={(v) => onAssignTask(task.id, v)}
              noneLabel="Unassigned"
              options={employees.filter(emp => emp.status === 'ACTIVE').map(emp => ({ value: emp.name, label: emp.name }))}
            />
        </div>
        <div className="flex justify-between pt-2 border-t border-slate-100">
            <button onClick={onRevert} className="text-[9px] px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">Prev</button>
            <button onClick={onAdvance} className="text-[9px] px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded">Next</button>
        </div>
    </div>
  );
}

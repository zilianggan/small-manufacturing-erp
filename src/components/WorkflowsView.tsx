/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { getWorkflowTasks, updateWorkflowStage, assignEmployee } from '../services/WorkflowsService';
import { useTableData } from '../hooks/useTableData';
import { WorkflowTask, Employee } from '../types';
import { ClipboardCheck } from 'lucide-react';
import OrderAccordion from './OrderAccordion';
import LoadingSpinner from './LoadingSpinner';
import { CallAPI } from './UIHelper';

export default function WorkflowsView() {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    await CallAPI(() => getWorkflowTasks(), {
      onCompleted: (data) => {
        setTasks(data);
        setLoading(false);
      },
      onError: (err) => {
        console.error(err);
        setLoading(false);
      },
    });
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const [employeeQuery, setEmployeeQuery] = useState('');
  const { data: employees, loading: employeesSearchLoading } = useTableData<Employee>('employees', { search: employeeQuery, filters: { status: 'ACTIVE' } });
  const [orderFilter, setOrderFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  const toggleOrderAccordion = (headerId: string) => {
    setExpandedOrders(prev => ({
      ...prev,
      [headerId]: !prev[headerId]
    }));
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const matchOrder = orderFilter ? t.salesNo.toLowerCase().includes(orderFilter.toLowerCase()) : true;
      const matchAssignee = assigneeFilter ? (t.employeeName || '').toLowerCase().includes(assigneeFilter.toLowerCase()) : true;
      return matchOrder && matchAssignee;
    });
  }, [tasks, orderFilter, assigneeFilter]);

  const handleAssignTask = async (taskId: string, employeeId: string) => {
    const previous = tasks;
    const employee = employees.find(e => e.id === employeeId);
    const updated = tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, employeeId: employeeId || undefined, employeeName: employee?.name };
      }
      return t;
    });
    setTasks(updated);

    await CallAPI(() => assignEmployee(taskId, employeeId || null), {
      onError: (err) => {
        console.error(err);
        setTasks(previous);
      },
    });
  };

  const columns: { key: WorkflowTask['stage']; label: string; bg: string; text: string; desc: string }[] = [
    { key: 'PREPARATION', label: '1. Preparation', bg: 'bg-slate-50', text: 'text-slate-700', desc: 'Material picking & sanding' },
    { key: 'ASSEMBLY', label: '2. Joint & Framing', bg: 'bg-blue-50/50', text: 'text-blue-700', desc: 'Structural joining & assembly' },
    { key: 'QUALITY_CONTROL', label: '3. Finish & Paint', bg: 'bg-sky-50/50', text: 'text-sky-700', desc: 'Varnish coating & inspection' },
    { key: 'PACKAGING', label: '4. Packaging', bg: 'bg-amber-50/40', text: 'text-amber-700', desc: 'Secure boxing & labeling' },
    { key: 'COMPLETED', label: '5. Completed', bg: 'bg-emerald-50/30', text: 'text-emerald-700', desc: 'Ready for production reconciliation' }
  ];

  const handleAdvanceStep = async (taskId: string, currentStage: WorkflowTask['stage']) => {
    const nextSteps: Record<WorkflowTask['stage'], WorkflowTask['stage']> = {
      PREPARATION: 'ASSEMBLY',
      ASSEMBLY: 'QUALITY_CONTROL',
      QUALITY_CONTROL: 'PACKAGING',
      PACKAGING: 'COMPLETED',
      COMPLETED: 'COMPLETED'
    };

    const nextStage = nextSteps[currentStage];
    const previous = tasks;
    const updated = tasks.map(t => t.id === taskId ? { ...t, stage: nextStage } : t);
    setTasks(updated);

    await CallAPI(() => updateWorkflowStage(taskId, nextStage), {
      onError: (err) => {
        console.error(err);
        setTasks(previous);
      },
    });
  };

  const handleRevertStep = async (taskId: string, currentStage: WorkflowTask['stage']) => {
    const prevSteps: Record<WorkflowTask['stage'], WorkflowTask['stage']> = {
      PREPARATION: 'PREPARATION',
      ASSEMBLY: 'PREPARATION',
      QUALITY_CONTROL: 'ASSEMBLY',
      PACKAGING: 'QUALITY_CONTROL',
      COMPLETED: 'PACKAGING'
    };

    const prevStage = prevSteps[currentStage];
    const previous = tasks;
    const updated = tasks.map(t => t.id === taskId ? { ...t, stage: prevStage } : t);
    setTasks(updated);

    await CallAPI(() => updateWorkflowStage(taskId, prevStage), {
      onError: (err) => {
        console.error(err);
        setTasks(previous);
      },
    });
  };

  // Group filtered tasks by their current stage
  const tasksByColumn = useMemo(() => {
    const groups: Record<WorkflowTask['stage'], WorkflowTask[]> = {
      PREPARATION: [],
      ASSEMBLY: [],
      QUALITY_CONTROL: [],
      PACKAGING: [],
      COMPLETED: []
    };
    filteredTasks.forEach(task => {
      if (groups[task.stage]) {
        groups[task.stage].push(task);
      }
    });
    return groups;
  }, [filteredTasks]);

  return (
    <div className="space-y-6" id="workflows-view">
      {loading && <LoadingSpinner message="Monitoring production floor..." subtitle="WORKFLOWS_LOAD" />}
      {/* Information Header */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 p-4 rounded-xl flex items-start space-x-3 text-xs leading-relaxed max-w-4xl text-blue-900 dark:text-blue-200">
        <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold text-blue-950 dark:text-blue-50">Shop Floor Tracking:</span>
          <p>
            This board tracks physical production stage only — moving a card, including to <strong className="text-emerald-800 dark:text-emerald-300">5. Completed</strong>, does not move any stock or change the order's status.
            Material reconciliation, finished-goods stock, and advancing the sales order happen in <strong className="text-emerald-800 dark:text-emerald-300">Orders → Mark production done</strong>.
          </p>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex space-x-4">
        <input
          type="text"
          placeholder="Filter by Order..."
          value={orderFilter}
          onChange={(e) => setOrderFilter(e.target.value)}
          className="border rounded p-2 text-xs"
        />
        <input
          type="text"
          placeholder="Filter by Assignee..."
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="border rounded p-2 text-xs"
        />
      </div>

      {/* Kanban Board Container */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const colTasks = tasksByColumn[col.key] || [];

          // Group tasks by order
          const tasksByOrder: Record<string, WorkflowTask[]> = {};
          colTasks.forEach(task => {
            if (!tasksByOrder[task.headerId]) tasksByOrder[task.headerId] = [];
            tasksByOrder[task.headerId].push(task);
          });

          return (
            <div key={col.key} className="flex flex-col min-w-[220px] bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-3 shrink-0 h-[600px]">

              {/* Column Header */}
              <div className="space-y-1 border-b border-slate-200/70 pb-2">
                <div className="flex items-center justify-between">
                  <span className={`font-sans font-semibold text-xs ${col.text}`}>{col.label}</span>
                  <span className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded font-mono font-medium text-slate-500">
                    {colTasks.length}
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 font-sans leading-tight">{col.desc}</p>
              </div>

              {/* Tasks List (Groups of Orders) */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
                {Object.keys(tasksByOrder).length === 0 ? (
                  <div className="h-24 border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-400 font-sans text-center px-4">
                    Empty column
                  </div>
                ) : (
                  Object.entries(tasksByOrder).map(([headerId, tasks]) => (
                    <OrderAccordion
                      key={headerId}
                      headerId={headerId}
                      salesNo={tasks[0].salesNo}
                      tasks={tasks}
                      colKey={col.key}
                      onAssignTask={handleAssignTask}
                      employees={employees}
                      onSearchEmployees={setEmployeeQuery}
                      employeesSearchLoading={employeesSearchLoading}
                      onAdvance={handleAdvanceStep}
                      onRevert={handleRevertStep}
                      isOpen={!!expandedOrders[headerId]}
                      onToggle={() => toggleOrderAccordion(headerId)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

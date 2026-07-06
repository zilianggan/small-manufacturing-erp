/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { updateWorkflowStep, saveWorkflowTasks } from '../services/WorkflowsService';
import { useTableData } from '../hooks/useTableData';
import { WorkflowTask, Employee } from '../types';
import { ClipboardCheck } from 'lucide-react';
import OrderAccordion from './OrderAccordion';
import LoadingSpinner from './LoadingSpinner';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { CallAPI } from './UIHelper';

export default function WorkflowsView() {
  const { data: tasksData, loading, refetch, loadMore, hasMore, loadingMore } = useTableData<WorkflowTask>('workflow_tasks');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const { data: employees, loading: employeesSearchLoading } = useTableData<Employee>('employees', { search: employeeQuery, filters: { status: 'ACTIVE' } });
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  useEffect(() => { setTasks(tasksData); }, [tasksData]);
  const [orderFilter, setOrderFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  const toggleOrderAccordion = (orderId: string) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const matchOrder = orderFilter ? t.orderId.toLowerCase().includes(orderFilter.toLowerCase()) : true;
      const matchAssignee = assigneeFilter ? (t.assignedTo || '').toLowerCase().includes(assigneeFilter.toLowerCase()) : true;
      return matchOrder && matchAssignee;
    });
  }, [tasks, orderFilter, assigneeFilter]);

  const handleAssignTask = async (taskId: string, employeeName: string) => {
    const previous = tasks;
    const updated = tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, assignedTo: employeeName || undefined };
      }
      return t;
    });
    setTasks(updated);

    await CallAPI(() => saveWorkflowTasks(updated, updated.find(t => t.id === taskId)), {
      onCompleted: refetch,
      onError: (err) => {
        console.error(err);
        setTasks(previous);
      },
    });
  };

  const columns: { key: WorkflowTask['currentStep']; label: string; bg: string; text: string; desc: string }[] = [
    { key: 'PREPARATION', label: '1. Preparation', bg: 'bg-slate-50', text: 'text-slate-700', desc: 'Material picking & sanding' },
    { key: 'ASSEMBLY', label: '2. Joint & Framing', bg: 'bg-blue-50/50', text: 'text-blue-700', desc: 'Structural joining & assembly' },
    { key: 'QUALITY_CONTROL', label: '3. Finish & Paint', bg: 'bg-sky-50/50', text: 'text-sky-700', desc: 'Varnish coating & inspection' },
    { key: 'PACKAGING', label: '4. Packaging', bg: 'bg-amber-50/40', text: 'text-amber-700', desc: 'Secure boxing & labeling' },
    { key: 'COMPLETED', label: '5. Completed', bg: 'bg-emerald-50/30', text: 'text-emerald-700', desc: 'Added to Finished Stock' }
  ];

  const handleAdvanceStep = async (taskId: string, currentStep: WorkflowTask['currentStep']) => {
    const nextSteps: Record<WorkflowTask['currentStep'], WorkflowTask['currentStep']> = {
      PREPARATION: 'ASSEMBLY',
      ASSEMBLY: 'QUALITY_CONTROL',
      QUALITY_CONTROL: 'PACKAGING',
      PACKAGING: 'COMPLETED',
      COMPLETED: 'COMPLETED'
    };

    const nextStep = nextSteps[currentStep];
    const previous = tasks;
    const updated = tasks.map(t => t.id === taskId ? { ...t, currentStep: nextStep } : t);
    setTasks(updated);

    await CallAPI(() => updateWorkflowStep(taskId, nextStep), {
      onCompleted: refetch,
      onError: (err) => {
        console.error(err);
        setTasks(previous);
      },
    });
  };

  const handleRevertStep = async (taskId: string, currentStep: WorkflowTask['currentStep']) => {
    const prevSteps: Record<WorkflowTask['currentStep'], WorkflowTask['currentStep']> = {
      PREPARATION: 'PREPARATION',
      ASSEMBLY: 'PREPARATION',
      QUALITY_CONTROL: 'ASSEMBLY',
      PACKAGING: 'QUALITY_CONTROL',
      COMPLETED: 'PACKAGING'
    };

    const prevStep = prevSteps[currentStep];
    const previous = tasks;
    const updated = tasks.map(t => t.id === taskId ? { ...t, currentStep: prevStep } : t);
    setTasks(updated);

    await CallAPI(() => updateWorkflowStep(taskId, prevStep), {
      onCompleted: refetch,
      onError: (err) => {
        console.error(err);
        setTasks(previous);
      },
    });
  };

  // Group filtered tasks by their current step
  const tasksByColumn = useMemo(() => {
    const groups: Record<WorkflowTask['currentStep'], WorkflowTask[]> = {
      PREPARATION: [],
      ASSEMBLY: [],
      QUALITY_CONTROL: [],
      PACKAGING: [],
      COMPLETED: []
    };
    filteredTasks.forEach(task => {
      if (groups[task.currentStep]) {
        groups[task.currentStep].push(task);
      }
    });
    return groups;
  }, [filteredTasks]);

  if (loading) {
    return <LoadingSpinner message="Monitoring production floor..." subtitle="WORKFLOWS_LOAD" />;
  }

  return (
    <div className="space-y-6" id="workflows-view">
      
      {/* Information Header */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 p-4 rounded-xl flex items-start space-x-3 text-xs leading-relaxed max-w-4xl text-blue-900 dark:text-blue-200">
        <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold text-blue-950 dark:text-blue-50">Manufacturing Automation Active:</span>
          <p>
            When a workflow card transitions to <strong className="text-emerald-800 dark:text-emerald-300">5. Completed</strong>: 
            (1) It automatically subtracts required raw wood, varnish, and brackets based on product formulas. 
            (2) Increments completed finished goods inventory levels. 
            (3) Automatically advances the sales order contract status to <strong className="text-emerald-800 dark:text-emerald-300">SHIPPED</strong>.
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
            if (!tasksByOrder[task.orderId]) tasksByOrder[task.orderId] = [];
            tasksByOrder[task.orderId].push(task);
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
                  Object.entries(tasksByOrder).map(([orderId, tasks]) => (
                    <OrderAccordion 
                        key={orderId} 
                        orderId={orderId} 
                        tasks={tasks} 
                        colKey={col.key} 
                        onAssignTask={handleAssignTask} 
                        employees={employees}
                        onSearchEmployees={setEmployeeQuery}
                        employeesSearchLoading={employeesSearchLoading}
                        onAdvance={handleAdvanceStep}
                        onRevert={handleRevertStep}
                        isOpen={!!expandedOrders[orderId]}
                        onToggle={() => toggleOrderAccordion(orderId)}
                    />
                  ))
                )}
              </div>
              <InfiniteScrollSentinel onLoadMore={loadMore} hasMore={hasMore} loading={loadingMore} />
            </div>
          );
        })}
      </div>

    </div>
  );
}

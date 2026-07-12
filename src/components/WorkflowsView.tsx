/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { getWorkflowTasks, updateWorkflowStage, assignEmployee, getOrderConsumables, addOrderConsumable, removeOrderConsumable } from '../services/WorkflowsService';
import type { OrderConsumable } from '../services/WorkflowsService';
import { getEmployees } from '../services/EmployeesService';
import { getConsumableMaterials } from '../services/MaterialService';
import { getClients } from '../services/ContactsService';
import { WorkflowTask, Employee, Client, Material, SalesPriority } from '../types';
import { ClipboardCheck } from 'lucide-react';
import OrderAccordion from './OrderAccordion';
import { Skeleton } from './ui';
import { CallAPI } from './UIHelper';
import { PageHeader, FilterBar } from './shell';
import type { FilterChip } from './shell';
import FilterDialog from './FilterDialog';
import SortMenu from './SortMenu';
import type { SortOption } from './SortMenu';
import { PRIORITY_META, PRIORITY_OPTIONS } from '../utils/priority';

type SortField = 'dueDate' | 'priority' | 'orderNo';

const SORT_OPTIONS: SortOption[] = [
  { value: 'dueDate', label: 'Production Due Date' },
  { value: 'priority', label: 'Priority' },
  { value: 'orderNo', label: 'Order No.' },
];

interface WorkflowFilters {
  assigneeIds: string[];
  clientIds: string[];
  priorities: SalesPriority[];
  dateFrom?: string;
  dateTo?: string;
}

const emptyFilters: WorkflowFilters = { assigneeIds: [], clientIds: [], priorities: [], dateFrom: undefined, dateTo: undefined };

export default function WorkflowsView() {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

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

  const [consumableMaterials, setConsumableMaterials] = useState<Material[]>([]);
  const [orderConsumables, setOrderConsumables] = useState<Record<string, OrderConsumable[]>>({});

  useEffect(() => {
    loadTasks();
    getEmployees().then((list) => setAllEmployees(list.filter(e => e.status === 'ACTIVE'))).catch(console.error);
    getClients().then(setClients).catch(console.error);
    getConsumableMaterials().then(setConsumableMaterials).catch(console.error);
  }, [loadTasks]);

  const loadOrderConsumables = useCallback((headerId: string) => {
    getOrderConsumables(headerId)
      .then((list) => setOrderConsumables(prev => ({ ...prev, [headerId]: list })))
      .catch(console.error);
  }, []);

  const handleAddConsumable = async (headerId: string, materialId: string, quantity: number, remark?: string) => {
    await CallAPI(() => addOrderConsumable(headerId, materialId, quantity, remark), {
      onCompleted: () => loadOrderConsumables(headerId),
      onError: console.error,
    });
  };
  const handleRemoveConsumable = async (headerId: string, usageId: string) => {
    await CallAPI(() => removeOrderConsumable(usageId), {
      onCompleted: () => loadOrderConsumables(headerId),
      onError: console.error,
    });
  };

  // ComboBox's own search-as-you-type (bulk/single assignment) — independent
  // of the filter dialog's client-side-filtered allEmployees list above.
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesSearchLoading, setEmployeesSearchLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setEmployeesSearchLoading(true);
    getEmployees(employeeQuery)
      .then((list) => {
        if (cancelled) return;
        setEmployees(list.filter(e => e.status === 'ACTIVE'));
        setEmployeesSearchLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setEmployeesSearchLoading(false);
      });
    return () => { cancelled = true; };
  }, [employeeQuery]);

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  // Kanban drag & drop: which column is currently hovered by a dragged card.
  const [dragOverCol, setDragOverCol] = useState<WorkflowTask['stage'] | null>(null);

  const toggleOrderAccordion = (headerId: string) => {
    setExpandedOrders(prev => {
      const opening = !prev[headerId];
      if (opening && !orderConsumables[headerId]) loadOrderConsumables(headerId);
      return { ...prev, [headerId]: opening };
    });
  };

  // ─── Filter dialog: assignee + client + priority checklists, due date range ───
  const [appliedFilters, setAppliedFilters] = useState<WorkflowFilters>(emptyFilters);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftAssigneeIds, setFilterDraftAssigneeIds] = useState<string[]>([]);
  const [filterDraftClientIds, setFilterDraftClientIds] = useState<string[]>([]);
  const [filterDraftPriorities, setFilterDraftPriorities] = useState<string[]>([]);
  const [filterDraftDateFrom, setFilterDraftDateFrom] = useState('');
  const [filterDraftDateTo, setFilterDraftDateTo] = useState('');
  const [filterAssigneeSearch, setFilterAssigneeSearch] = useState('');
  const [filterClientSearch, setFilterClientSearch] = useState('');
  const [filterAssigneeVisibleCount, setFilterAssigneeVisibleCount] = useState(20);
  const [filterClientVisibleCount, setFilterClientVisibleCount] = useState(20);

  const openFilterDialog = () => {
    setFilterDraftAssigneeIds(appliedFilters.assigneeIds);
    setFilterDraftClientIds(appliedFilters.clientIds);
    setFilterDraftPriorities(appliedFilters.priorities);
    setFilterDraftDateFrom(appliedFilters.dateFrom || '');
    setFilterDraftDateTo(appliedFilters.dateTo || '');
    setFilterAssigneeSearch('');
    setFilterClientSearch('');
    setFilterAssigneeVisibleCount(20);
    setFilterClientVisibleCount(20);
    setShowFilterDialog(true);
  };

  const toggleFilterDraftAssignee = (id: string) => {
    setFilterDraftAssigneeIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  const toggleFilterDraftClient = (id: string) => {
    setFilterDraftClientIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  const toggleFilterDraftPriority = (id: string) => {
    setFilterDraftPriorities(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const filterAssigneeMatches = useMemo(() => {
    const q = filterAssigneeSearch.trim().toLowerCase();
    return allEmployees.filter(e => !q || e.fullName.toLowerCase().includes(q));
  }, [allEmployees, filterAssigneeSearch]);
  const filterAssigneeItems = useMemo(
    () => filterAssigneeMatches.slice(0, filterAssigneeVisibleCount).map(e => ({ id: e.id, label: e.fullName })),
    [filterAssigneeMatches, filterAssigneeVisibleCount]
  );

  const filterClientMatches = useMemo(() => {
    const q = filterClientSearch.trim().toLowerCase();
    return clients.filter(c => !q || c.companyName.toLowerCase().includes(q));
  }, [clients, filterClientSearch]);
  const filterClientItems = useMemo(
    () => filterClientMatches.slice(0, filterClientVisibleCount).map(c => ({ id: c.id, label: c.companyName })),
    [filterClientMatches, filterClientVisibleCount]
  );

  const filterPriorityItems = useMemo(() => PRIORITY_OPTIONS.map(p => ({ id: p.value, label: p.label })), []);

  const filterChips: FilterChip[] = [
    ...(appliedFilters.assigneeIds.length ? [{ key: 'assignee', label: `${appliedFilters.assigneeIds.length} assignee${appliedFilters.assigneeIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedFilters(f => ({ ...f, assigneeIds: [] })) }] : []),
    ...(appliedFilters.clientIds.length ? [{ key: 'client', label: `${appliedFilters.clientIds.length} client${appliedFilters.clientIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedFilters(f => ({ ...f, clientIds: [] })) }] : []),
    ...(appliedFilters.priorities.length ? [{ key: 'priority', label: `${appliedFilters.priorities.length} priorit${appliedFilters.priorities.length === 1 ? 'y' : 'ies'}`, onRemove: () => setAppliedFilters(f => ({ ...f, priorities: [] })) }] : []),
    ...(appliedFilters.dateFrom || appliedFilters.dateTo ? [{ key: 'date', label: `Due ${appliedFilters.dateFrom || '…'} → ${appliedFilters.dateTo || '…'}`, onRemove: () => setAppliedFilters(f => ({ ...f, dateFrom: undefined, dateTo: undefined })) }] : []),
  ];
  const activeFilterCount = appliedFilters.assigneeIds.length + appliedFilters.clientIds.length + appliedFilters.priorities.length + (appliedFilters.dateFrom || appliedFilters.dateTo ? 1 : 0);

  const filteredTasks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return tasks.filter(t => {
      const matchSearch = q ? t.salesNo.toLowerCase().includes(q) : true;
      const matchAssignee = appliedFilters.assigneeIds.length ? (!!t.employeeId && appliedFilters.assigneeIds.includes(t.employeeId)) : true;
      const matchClient = appliedFilters.clientIds.length ? appliedFilters.clientIds.includes(t.clientId) : true;
      const matchPriority = appliedFilters.priorities.length ? appliedFilters.priorities.includes(t.priority) : true;
      const matchDateFrom = appliedFilters.dateFrom ? (!!t.productionDueDate && t.productionDueDate >= appliedFilters.dateFrom) : true;
      const matchDateTo = appliedFilters.dateTo ? (!!t.productionDueDate && t.productionDueDate <= appliedFilters.dateTo) : true;
      return matchSearch && matchAssignee && matchClient && matchPriority && matchDateFrom && matchDateTo;
    });
  }, [tasks, searchTerm, appliedFilters]);

  // ─── Sort: reorders the order-groups (accordions) within each column ───
  const [sortField, setSortField] = useState<SortField>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const orderMeta = useMemo(() => {
    const map = new Map<string, { salesNo: string; clientName: string; productionDueDate?: string; priority: SalesPriority }>();
    filteredTasks.forEach(t => {
      if (!map.has(t.headerId)) map.set(t.headerId, { salesNo: t.salesNo, clientName: t.clientName, productionDueDate: t.productionDueDate, priority: t.priority });
    });
    return map;
  }, [filteredTasks]);

  const sortedHeaderIds = useMemo(() => {
    const mul = sortDir === 'asc' ? 1 : -1;
    return Array.from(orderMeta.keys()).sort((a, b) => {
      const ma = orderMeta.get(a)!, mb = orderMeta.get(b)!;
      if (sortField === 'dueDate') {
        if (!ma.productionDueDate && !mb.productionDueDate) return 0;
        if (!ma.productionDueDate) return 1;
        if (!mb.productionDueDate) return -1;
        return ma.productionDueDate.localeCompare(mb.productionDueDate) * mul;
      }
      if (sortField === 'priority') {
        return (PRIORITY_META[ma.priority].rank - PRIORITY_META[mb.priority].rank) * mul;
      }
      return ma.salesNo.localeCompare(mb.salesNo) * mul;
    });
  }, [orderMeta, sortField, sortDir]);

  const handleAssignTask = async (taskId: string, employeeId: string) => {
    const previous = tasks;
    const employee = employees.find(e => e.id === employeeId);
    const updated = tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, employeeId: employeeId || undefined, employeeName: employee?.fullName };
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
    { key: 'PREPARATION', label: '1. Preparation', bg: 'bg-slate-50 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800', text: 'text-slate-700 dark:text-slate-300', desc: 'Material picking & sanding' },
    { key: 'ASSEMBLY', label: '2. Joint & Framing', bg: 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/60', text: 'text-blue-700 dark:text-blue-300', desc: 'Structural joining & assembly' },
    { key: 'QUALITY_CONTROL', label: '3. Finish & Paint', bg: 'bg-sky-50/50 dark:bg-sky-950/20 border-sky-100 dark:border-sky-900/60', text: 'text-sky-700 dark:text-sky-300', desc: 'Varnish coating & inspection' },
    { key: 'PACKAGING', label: '4. Packaging', bg: 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/60', text: 'text-amber-700 dark:text-amber-300', desc: 'Secure boxing & labeling' },
    { key: 'COMPLETED', label: '5. Completed', bg: 'bg-emerald-50/30 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/60', text: 'text-emerald-700 dark:text-emerald-300', desc: 'Ready for production reconciliation' }
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

  // Drag & drop: dropping an order card onto a column moves every task of
  // that order currently sitting in the source column to the target stage —
  // complements (doesn't replace) the per-task Prev/Next buttons.
  const handleDropOnColumn = async (e: React.DragEvent, targetStage: WorkflowTask['stage']) => {
    e.preventDefault();
    setDragOverCol(null);
    let payload: { headerId: string; fromStage: WorkflowTask['stage'] };
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json'));
    } catch {
      return;
    }
    if (!payload.headerId || payload.fromStage === targetStage) return;

    const moving = tasks.filter(t => t.headerId === payload.headerId && t.stage === payload.fromStage);
    if (moving.length === 0) return;

    const previous = tasks;
    setTasks(tasks.map(t => (moving.some(m => m.id === t.id) ? { ...t, stage: targetStage } : t)));

    for (const task of moving) {
      const result = await CallAPI(() => updateWorkflowStage(task.id, targetStage), {
        onError: (err) => console.error(err),
      });
      if (result === null) {
        setTasks(previous);
        return;
      }
    }
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
    <div className="space-y-5" id="workflows-view">
      <PageHeader title="Production Board" description="Track physical production stage for every order in progress." />

      {/* Information Header */}
      <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl flex items-start space-x-3 text-xs leading-relaxed max-w-4xl text-foreground">
        <ClipboardCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold text-foreground">Manufacturing Tracking:</span>
          <p className="text-muted-foreground">
            This board tracks physical production stage only — moving a card, including to <strong className="text-success">5. Completed</strong>, does not move any stock or change the order's status.
            Material reconciliation, finished-goods stock, and advancing the sales order happen in <strong className="text-success">Orders → Mark production done</strong>.
          </p>
        </div>
      </div>

      {/* Filter + sort controls */}
      <FilterBar
        search={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search by order no..."
        chips={filterChips}
        onOpenFilters={openFilterDialog}
        filterCount={activeFilterCount}
        right={<SortMenu options={SORT_OPTIONS} sortField={sortField} sortDir={sortDir} onChange={(f, d) => { setSortField(f as SortField); setSortDir(d); }} />}
      />

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
          const orderedHeaderIds = sortedHeaderIds.filter(id => tasksByOrder[id]);

          return (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null); }}
              onDrop={(e) => handleDropOnColumn(e, col.key)}
              className={`flex flex-col min-w-[220px] border rounded-xl p-3 space-y-3 shrink-0 h-[600px] transition-shadow ${col.bg} ${dragOverCol === col.key ? 'ring-2 ring-primary/50' : ''}`}
            >

              {/* Column Header */}
              <div className="space-y-1 border-b border-border/70 pb-2">
                <div className="flex items-center justify-between">
                  <span className={`font-sans font-semibold text-xs ${col.text}`}>{col.label}</span>
                  <span className="text-[10px] bg-card border border-border px-1.5 py-0.5 rounded font-mono font-medium text-muted-foreground">
                    {colTasks.length}
                  </span>
                </div>
                <p className="text-[9px] text-muted-foreground font-sans leading-tight">{col.desc}</p>
              </div>

              {/* Tasks List (Groups of Orders) */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
                {loading && orderedHeaderIds.length === 0 ? (
                  Array.from({ length: 2 }).map((_, i) => <WorkflowCardSkeleton key={`skeleton-${i}`} />)
                ) : orderedHeaderIds.length === 0 ? (
                  <div className="h-24 border border-dashed border-border rounded-lg flex items-center justify-center text-[10px] text-muted-foreground font-sans text-center px-4">
                    Empty column
                  </div>
                ) : (
                  orderedHeaderIds.map((headerId) => {
                    const meta = orderMeta.get(headerId)!;
                    return (
                      <OrderAccordion
                        key={headerId}
                        headerId={headerId}
                        salesNo={meta.salesNo}
                        clientName={meta.clientName}
                        productionDueDate={meta.productionDueDate}
                        priority={meta.priority}
                        tasks={tasksByOrder[headerId]}
                        colKey={col.key}
                        onAssignTask={handleAssignTask}
                        employees={employees}
                        onSearchEmployees={setEmployeeQuery}
                        employeesSearchLoading={employeesSearchLoading}
                        onAdvance={handleAdvanceStep}
                        onRevert={handleRevertStep}
                        isOpen={!!expandedOrders[headerId]}
                        onToggle={() => toggleOrderAccordion(headerId)}
                        consumableMaterials={consumableMaterials}
                        consumables={orderConsumables[headerId]}
                        onAddConsumable={handleAddConsumable}
                        onRemoveConsumable={handleRemoveConsumable}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify({ headerId, fromStage: col.key }));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      <FilterDialog
        open={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        title="Filter Production Board"
        sections={[
          {
            type: 'checklist',
            key: 'assignee',
            label: 'Assignee',
            searchPlaceholder: 'Search employees...',
            searchQuery: filterAssigneeSearch,
            onSearchChange: (q) => { setFilterAssigneeSearch(q); setFilterAssigneeVisibleCount(20); },
            items: filterAssigneeItems,
            hasMore: filterAssigneeMatches.length > filterAssigneeVisibleCount,
            onLoadMore: () => setFilterAssigneeVisibleCount(c => c + 20),
            selectedIds: filterDraftAssigneeIds,
            onToggle: toggleFilterDraftAssignee,
          },
          {
            type: 'checklist',
            key: 'client',
            label: 'Client',
            searchPlaceholder: 'Search clients...',
            searchQuery: filterClientSearch,
            onSearchChange: (q) => { setFilterClientSearch(q); setFilterClientVisibleCount(20); },
            items: filterClientItems,
            hasMore: filterClientMatches.length > filterClientVisibleCount,
            onLoadMore: () => setFilterClientVisibleCount(c => c + 20),
            selectedIds: filterDraftClientIds,
            onToggle: toggleFilterDraftClient,
          },
          {
            type: 'checklist',
            key: 'priority',
            label: 'Priority',
            searchQuery: '',
            onSearchChange: () => {},
            hideSearch: true,
            items: filterPriorityItems,
            selectedIds: filterDraftPriorities,
            onToggle: toggleFilterDraftPriority,
          },
          {
            type: 'dateRange',
            key: 'dateRange',
            label: 'Production Due Date Range',
            from: filterDraftDateFrom,
            to: filterDraftDateTo,
            onFromChange: setFilterDraftDateFrom,
            onToChange: setFilterDraftDateTo,
          },
        ]}
        onApply={() => setAppliedFilters({
          assigneeIds: filterDraftAssigneeIds,
          clientIds: filterDraftClientIds,
          priorities: filterDraftPriorities as SalesPriority[],
          dateFrom: filterDraftDateFrom || undefined,
          dateTo: filterDraftDateTo || undefined,
        })}
        onClear={() => {
          setFilterDraftAssigneeIds([]); setFilterDraftClientIds([]); setFilterDraftPriorities([]);
          setFilterDraftDateFrom(''); setFilterDraftDateTo('');
          setAppliedFilters(emptyFilters);
        }}
      />
    </div>
  );
}

// Placeholder shown in a kanban column while tasks are loading
function WorkflowCardSkeleton() {
  return (
    <div className="border border-border rounded-lg p-2.5 space-y-2 bg-card">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

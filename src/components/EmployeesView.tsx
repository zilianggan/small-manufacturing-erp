import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Edit,
  Mail,
  Phone,
  Briefcase,
} from 'lucide-react';
import { Employee, JobPosition } from '../types';
import { generateId, getEmployees, saveEmployee, deleteEmployee, getJobPositions } from '../services/EmployeesService';
import ComboBox from './ComboBox';
import { PageHeader } from './shell';
import { Sheet, Card, FormField, fieldInputClassName, SearchInput, Button, Badge, Skeleton, useToast, useConfirm } from './ui';
import { CallAPI } from './UIHelper';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';

export default function EmployeesView() {
  const toast = useToast();
  const confirm = useConfirm();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEmployees = () => {
    CallAPI(() => getEmployees(), {
      onCompleted: (data) => {
        setEmployees(data);
        setLoading(false);
      },
      onError: (err) => {
        console.error(err);
        setLoading(false);
      },
    });
  };

  useEffect(() => { loadEmployees(); }, []);

  // Search and Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Form States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [fullName, setFullName] = useState('');
  const [jobPositionId, setJobPositionId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [email, setEmail] = useState('');
  const [contactNo, setContactNo] = useState('');
  const [jobPositions, setJobPositions] = useState<JobPosition[]>([]);
  const formRef = useFadeInOnMount<HTMLDivElement>([isFormOpen], { duration: 0.7, stagger: 0.18, y: 16 });

  useEffect(() => {
    CallAPI(getJobPositions, {
      onCompleted: setJobPositions,
      onError: console.error,
    });
  }, [])

  const jobPositionMap = useMemo(() => new Map(jobPositions.map(p => [p.id, p.name])), [jobPositions]);

  const activeJobPositionOptions = jobPositions
    .filter(position => position.is_active || position.id === jobPositionId)
    .map(position => ({ value: position.id, label: position.name }));

  const filteredEmployees = employees.filter(emp => {
    const positionName = (emp.jobPositionId && jobPositionMap.get(emp.jobPositionId)) || '';
    const matchesSearch = emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      positionName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.email && emp.email.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'ALL' || emp.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenAddForm = () => {
    setEditingEmployee(null);
    setFullName('');
    setJobPositionId('');
    setStatus('ACTIVE');
    setEmail('');
    setContactNo('');
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (emp: Employee) => {
    setEditingEmployee(emp);
    setFullName(emp.fullName);
    setJobPositionId(emp.jobPositionId || '');
    setStatus(emp.status);
    setEmail(emp.email || '');
    setContactNo(emp.contactNo || '');
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string, empName: string) => {
    if (!(await confirm(`Are you sure you want to delete ${empName}? This employee will no longer be listed in the team catalog.`))) return;

    const previous = employees;
    setEmployees(employees.filter(e => e.id !== id));

    await CallAPI(() => deleteEmployee(id), {
      onCompleted: () => { loadEmployees(); toast.success(`${empName} removed from the team catalog.`); },
      onError: (err) => {
        console.error(err);
        setEmployees(previous);
        toast.error('Failed to delete employee.');
      },
    });
  };

  const handleSubmit = async () => {
    if (!fullName.trim()) return;

    const savedEmployee: Employee = {
      id: editingEmployee ? editingEmployee.id : generateId(),
      fullName: fullName.trim(),
      jobPositionId: jobPositionId || undefined,
      status,
      email: email.trim() || undefined,
      contactNo: contactNo.trim() || undefined
    };

    const previous = employees;
    setEmployees(editingEmployee
      ? employees.map(emp => emp.id === savedEmployee.id ? savedEmployee : emp)
      : [...employees, savedEmployee]);

    await CallAPI(() => saveEmployee(savedEmployee), {
      onCompleted: () => { loadEmployees(); toast.success(editingEmployee ? 'Employee updated.' : 'Employee added.'); },
      onError: (err) => {
        console.error(err);
        setEmployees(previous);
        toast.error('Failed to save employee.');
      },
    });

    setIsFormOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Directory"
        description="Manage personnel records and engineering team availability to assign tasks."
        actions={<Button id="btn-add-employee" onClick={handleOpenAddForm}><Plus className="w-4 h-4" />Add Employee</Button>}
      />

      {/* Searching & filters panel */}
      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search by name, role, or email..."
          className="relative md:col-span-2"
        />

        <div>
          <ComboBox
            id="select-status-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'ACTIVE', label: 'Active Team' },
              { value: 'INACTIVE', label: 'Inactive / Leave' },
            ]}
          />
        </div>
      </Card>

      {/* Employees catalog list */}
      {loading && employees.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <EmployeeCardSkeleton key={`skeleton-${i}`} />)}
        </div>
      ) : filteredEmployees.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="w-10 h-10 text-slate-300 mx-auto stroke-1 mb-2" />
          <span className="text-sm font-semibold text-slate-800 block">No Personnel Found</span>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">Try matching with different filters, using the import helper, or adding employees manually above.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredEmployees.map(emp => (
            <Card
              key={emp.id}
              id={`emp-card-${emp.id}`}
              className="p-5 hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between relative group animate-in fade-in slide-in-from-bottom-2 duration-150"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200 text-slate-500 font-bold font-sans text-xs uppercase">
                      {emp.fullName.split(' ').map(n => n[0]).join('').substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-sans font-bold text-slate-900 text-sm truncate">{emp.fullName}</h4>
                      {emp.jobPositionId && jobPositionMap.get(emp.jobPositionId) && (
                        <p className="text-[11px] text-slate-500 font-semibold truncate flex items-center space-x-1">
                          <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{jobPositionMap.get(emp.jobPositionId)}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <Badge variant={emp.status === 'ACTIVE' ? 'success' : 'secondary'}>{emp.status}</Badge>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                  {emp.email && (
                    <div className="flex items-center space-x-2 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono text-[11px] truncate">{emp.email}</span>
                    </div>
                  )}
                  {emp.contactNo && (
                    <div className="flex items-center space-x-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono text-[11px]">{emp.contactNo}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons drawer overlay on hover */}
              <div className="flex items-center justify-end space-x-1 mt-4 pt-3 border-t border-slate-50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <Button
                  id={`btn-edit-emp-${emp.id}`}
                  variant="ghost" size="icon"
                  onClick={() => handleOpenEditForm(emp)}
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                  title="Edit details"
                >
                  <Edit className="w-3.5 h-3.5" />
                </Button>
                <Button
                  id={`btn-delete-emp-${emp.id}`}
                  variant="ghost" size="icon"
                  onClick={() => handleDelete(emp.id, emp.fullName)}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  title="Remove employee"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit slide-over — matches MaterialView/ContactsView */}
      <Sheet
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingEmployee ? 'Edit Personnel Member' : 'Add New Personnel'}
        description={editingEmployee ? undefined : 'Create a new employee record'}
        width="w-full sm:max-w-xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editingEmployee ? 'Save Changes' : 'Create Record'}</Button>
          </div>
        }
      >
        <div ref={formRef} className="p-5 space-y-4 text-xs text-muted-foreground" data-fade-item>
          <FormField label="Full Name *">
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. John Doe"
              className={fieldInputClassName}
            />
          </FormField>

          <FormField label="Job Position">
            <ComboBox
              value={jobPositionId}
              onChange={setJobPositionId}
              noneLabel="-- Select Job Position --"
              options={activeJobPositionOptions}
            />
          </FormField>

          <FormField label="Availability Status">
            <ComboBox
              value={status}
              onChange={(v) => setStatus(v as 'ACTIVE' | 'INACTIVE')}
              options={[
                { value: 'ACTIVE', label: 'ACTIVE' },
                { value: 'INACTIVE', label: 'INACTIVE' },
              ]}
            />
          </FormField>

          <FormField label="E-mail Address">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. j.doe@sengjie.com"
              className={fieldInputClassName}
            />
          </FormField>

          <FormField label="Phone Contact">
            <input
              type="text"
              value={contactNo}
              onChange={(e) => setContactNo(e.target.value)}
              placeholder="e.g. +60 12-345-6789"
              className={fieldInputClassName}
            />
          </FormField>
        </div>
      </Sheet>

    </div>
  );
}

// Placeholder shown in the grid while the roster is loading
function EmployeeCardSkeleton() {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="pt-3 border-t border-border space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </Card>
  );
}

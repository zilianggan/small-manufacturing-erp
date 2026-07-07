import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Edit,
  Mail,
  Phone,
  Briefcase,
  Search
} from 'lucide-react';
import { Employee, JobPosition } from '../types';
import { generateId, getEmployees, saveEmployee, deleteEmployee, getJobPositions } from '../services/EmployeesService';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, useToast, useConfirm } from './ui';
import { CallAPI } from './UIHelper';

const employeeFieldInputClassName = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      {loading && <LoadingSpinner message="Accessing workforce roster..." subtitle="TEAM_CATALOG" />}
      {/* Top action block */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-sans font-bold text-slate-900 text-lg flex items-center space-x-2">
            <span className="p-1 bg-blue-50 text-blue-600 rounded">
              <Users className="w-5 h-5" />
            </span>
            <span>Employee Directory</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">Manage personnel records and engineering team availability to assign tasks</p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            id="btn-add-employee"
            type="button"
            onClick={handleOpenAddForm}
            className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* Searching & filters panel */}
      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            id="input-search-employees"
            type="text"
            placeholder="Search by name, role, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-500 font-sans"
          />
        </div>

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
      {filteredEmployees.length === 0 ? (
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

                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${emp.status === 'ACTIVE'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                    }`}>
                    {emp.status}
                  </span>
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
              <div className="flex items-center justify-end space-x-1.5 mt-4 pt-3 border-t border-slate-50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  id={`btn-edit-emp-${emp.id}`}
                  type="button"
                  onClick={() => handleOpenEditForm(emp)}
                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                  title="Edit details"
                >
                  <Edit className="w-3.5 h-3.5" />
                </button>
                <button
                  id={`btn-delete-emp-${emp.id}`}
                  type="button"
                  onClick={() => handleDelete(emp.id, emp.fullName)}
                  className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
                  title="Remove employee"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Form Modal */}
      <Dialog
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        maxWidth="max-w-md"
        headerClassName="bg-slate-50"
        titleClassName="font-sans font-bold text-slate-900 text-sm"
        titleIcon={
          <span className="p-1 bg-blue-50 text-blue-600 rounded">
            <Users className="w-4 h-4" />
          </span>
        }
        title={editingEmployee ? 'Edit Personnel Member' : 'Add New Personnel'}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-slate-600">
          <FormField label="Full Name *" labelClassName="font-semibold block text-slate-700">
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. John Doe"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <FormField label="Job Position" labelClassName="font-semibold block text-slate-700">
            <ComboBox
              value={jobPositionId}
              onChange={setJobPositionId}
              noneLabel="-- Select Job Position --"
              options={activeJobPositionOptions}
            />
          </FormField>

          <FormField label="Availability Status" labelClassName="font-semibold block text-slate-700">
            <ComboBox
              value={status}
              onChange={(v) => setStatus(v as 'ACTIVE' | 'INACTIVE')}
              options={[
                { value: 'ACTIVE', label: 'ACTIVE' },
                { value: 'INACTIVE', label: 'INACTIVE' },
              ]}
            />
          </FormField>

          <FormField label="E-mail Address" labelClassName="font-semibold block text-slate-700">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. j.doe@sengjie.com"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <FormField label="Phone Contact" labelClassName="font-semibold block text-slate-700">
            <input
              type="text"
              value={contactNo}
              onChange={(e) => setContactNo(e.target.value)}
              placeholder="e.g. +60 12-345-6789"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <DialogFooter>
            <DialogCancelButton onClick={() => setIsFormOpen(false)} />
            <DialogSubmitButton className="shadow-sm">
              {editingEmployee ? 'Save Changes' : 'Create Record'}
            </DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

    </div>
  );
}

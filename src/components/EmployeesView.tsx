import React, { useState, useEffect } from 'react';
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
import { Employee } from '../types';
import { saveEmployees } from '../services/db';
import { useTableData } from '../hooks/useTableData';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField } from './ui';

const employeeFieldInputClassName = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800';

export default function EmployeesView() {
  const { data: employeesData, loading } = useTableData<Employee>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  useEffect(() => { setEmployees(employeesData); }, [employeesData]);
  
  // Search and Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Form States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('Operations');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Departments list for filter and dropdowns
  const departments = ['Operations', 'Quality', 'Machining', 'Logistics', 'Administration', 'Engineering'];

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          emp.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (emp.email && emp.email.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesDept = deptFilter === 'ALL' || emp.department === deptFilter;
    const matchesStatus = statusFilter === 'ALL' || emp.status === statusFilter;
    return matchesSearch && matchesDept && matchesStatus;
  });

  const handleOpenAddForm = () => {
    setEditingEmployee(null);
    setName('');
    setRole('');
    setDepartment('Operations');
    setStatus('ACTIVE');
    setEmail('');
    setPhone('');
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (emp: Employee) => {
    setEditingEmployee(emp);
    setName(emp.name);
    setRole(emp.role);
    setDepartment(emp.department);
    setStatus(emp.status);
    setEmail(emp.email || '');
    setPhone(emp.phone || '');
    setIsFormOpen(true);
  };

  const handleDelete = (id: string, empName: string) => {
    if (confirm(`Are you sure you want to delete ${empName}? This employee will no longer be listed in the team catalog.`)) {
      const updated = employees.filter(e => e.id !== id);
      setEmployees(updated);
      saveEmployees(updated, undefined, id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;

    let updatedList: Employee[];

    if (editingEmployee) {
      updatedList = employees.map(emp => {
        if (emp.id === editingEmployee.id) {
          return {
            ...emp,
            name: name.trim(),
            role: role.trim(),
            department,
            status,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined
          };
        }
        return emp;
      });
    } else {
      const newEmployee: Employee = {
        id: `emp-${Date.now()}`,
        name: name.trim(),
        role: role.trim(),
        department,
        status,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined
      };
      updatedList = [...employees, newEmployee];
    }

    const changedEmp = editingEmployee
      ? updatedList.find(e => e.id === editingEmployee.id)
      : updatedList[updatedList.length - 1];
    setEmployees(updatedList);
    saveEmployees(updatedList, changedEmp);
    setIsFormOpen(false);
  };

  if (loading) {
    return <LoadingSpinner message="Accessing workforce roster..." subtitle="TEAM_CATALOG" />;
  }

  return (
    <div className="space-y-6">
      
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
      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
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
            id="select-dept-filter"
            value={deptFilter}
            onChange={setDeptFilter}
            options={[{ value: 'ALL', label: 'All Departments' }, ...departments.map(d => ({ value: d, label: d }))]}
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
                      {emp.name.split(' ').map(n => n[0]).join('').substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-sans font-bold text-slate-900 text-sm truncate">{emp.name}</h4>
                      <p className="text-[11px] text-slate-500 font-semibold truncate flex items-center space-x-1">
                        <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{emp.role}</span>
                      </p>
                    </div>
                  </div>
                  
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    emp.status === 'ACTIVE' 
                      ? 'bg-emerald-50 text-emerald-700' 
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {emp.status}
                  </span>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center space-x-2 text-slate-500">
                    <span className="font-semibold text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 uppercase tracking-tight">{emp.department}</span>
                  </div>
                  {emp.email && (
                    <div className="flex items-center space-x-2 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono text-[11px] truncate">{emp.email}</span>
                    </div>
                  )}
                  {emp.phone && (
                    <div className="flex items-center space-x-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono text-[11px]">{emp.phone}</span>
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
                  onClick={() => handleDelete(emp.id, emp.name)}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <FormField label="Designation / Role *" labelClassName="font-semibold block text-slate-700">
            <input
              type="text"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Mechanical Engineer, QC Lead"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Department" labelClassName="font-semibold block text-slate-700">
              <ComboBox
                value={department}
                onChange={setDepartment}
                options={departments.map(d => ({ value: d, label: d }))}
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
          </div>

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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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

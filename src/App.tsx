/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  FileSpreadsheet, 
  ShoppingBag, 
  Shuffle, 
  BarChart3, 
  Database, 
  Download, 
  Upload, 
  BookOpen, 
  Menu, 
  X, 
  ArrowUpRight,
  Factory,
  Cpu,
  Wrench,
  Camera,
  Briefcase,
  Sun,
  Moon
} from 'lucide-react';
import { getCompanyProfile, saveCompanyProfile, loadInitialDataFromSupabase, useSyncStore } from './services/db';
import { CompanyProfile } from './types';
import SignaturePad from './components/SignaturePad';

import DashboardView from './components/DashboardView';
import InventoryView from './components/InventoryView';
import ContactsView from './components/ContactsView';
import OrdersView from './components/OrdersView';
import PurchasesView from './components/PurchasesView';
import WorkflowsView from './components/WorkflowsView';
import ReportsView from './components/ReportsView';
import ExportGuide from './components/ExportGuide';
import ImportExportModal from './components/ImportExportModal';
import EmployeesView from './components/EmployeesView';

type TabType = 'DASHBOARD' | 'INVENTORY' | 'CONTACTS' | 'EMPLOYEES' | 'ORDERS' | 'PURCHASES' | 'WORKFLOWS' | 'REPORTS' | 'EXPORT_GUIDE';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('DASHBOARD');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Dark mode state and persistence
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('erp_dark_mode');
    if (stored) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('erp_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('erp_dark_mode', 'false');
    }
  }, [darkMode]);

  // Cross-component quick-procure state
  // If user clicks "Procure" on inventory, we pass it down to Purchase orders and switch the tab
  const [quickProcureItem, setQuickProcureItem] = useState<{ itemId: string; itemName: string; vendorId: string } | null>(null);

  // Company Profile states
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(() => getCompanyProfile());
  const [showBrandingModal, setShowBrandingModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isAppLoaded, setIsAppLoaded] = useState(false);
  const isSyncing = useSyncStore((state: any) => state.isSyncing);
  
  useEffect(() => {
    loadInitialDataFromSupabase().then(() => {
       setIsAppLoaded(true);
       setRefreshKey(prev => prev + 1);
       setCompanyProfile(getCompanyProfile());
    });
  }, []);


  // For the form inside the branding settings modal:
  const [brandingName, setBrandingName] = useState(companyProfile.name);
  const [brandingIconType, setBrandingIconType] = useState(companyProfile.iconType);
  const [brandingIconDataUrl, setBrandingIconDataUrl] = useState(companyProfile.iconDataUrl);
  const [brandingAddress, setBrandingAddress] = useState(companyProfile.address || '');
  const [brandingPhone, setBrandingPhone] = useState(companyProfile.phone || '');
  const [brandingEmail, setBrandingEmail] = useState(companyProfile.email || '');
  const [brandingBankName, setBrandingBankName] = useState(companyProfile.bankName || '');
  const [brandingBankAccount, setBrandingBankAccount] = useState(companyProfile.bankAccount || '');
  const [brandingSignatureUrl, setBrandingSignatureUrl] = useState(companyProfile.signatureUrl || '');
  const [brandingChopUrl, setBrandingChopUrl] = useState(companyProfile.chopUrl || '');
  const [brandingError, setBrandingError] = useState('');

  const renderCompanyIcon = (sizeClass = "w-5 h-5") => {
    if (companyProfile.iconType === 'custom_image' && companyProfile.iconDataUrl) {
      return (
        <img 
          src={companyProfile.iconDataUrl} 
          alt="Company logo" 
          className={`${sizeClass} object-contain rounded`}
          referrerPolicy="no-referrer"
        />
      );
    }
    
    switch (companyProfile.iconType) {
      case 'factory':
        return <Factory className={sizeClass} />;
      case 'cpu':
        return <Cpu className={sizeClass} />;
      case 'wrench':
        return <Wrench className={sizeClass} />;
      case 'database':
      default:
        return <Database className={sizeClass} />;
    }
  };

  const handleQuickProcure = (itemId: string, itemName: string, vendorId: string) => {
    setQuickProcureItem({ itemId, itemName, vendorId });
    setActiveTab('PURCHASES');
  };

  const clearQuickProcure = () => {
    setQuickProcureItem(null);
  };

  // Automated Excel data backup helper
  const downloadBackup = () => {
    const keys = ['erp_inventory', 'erp_vendors', 'erp_clients', 'erp_employees', 'erp_sales_orders', 'erp_purchase_orders', 'erp_workflow_tasks'];
    const wb = XLSX.utils.book_new();
    let hasData = false;
    
    keys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
        try {
          const data = JSON.parse(value);
          if (Array.isArray(data) && data.length > 0) {
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, key);
            hasData = true;
          }
        } catch (e) {
          // ignore
        }
      }
    });

    if (hasData) {
      XLSX.writeFile(wb, `ERP_Backup_${new Date().toISOString().split('T')[0]}.xlsx`);
    } else {
      alert("No data found to export.");
    }
  };

  // Reset local storage to seed defaults
  const resetDatabase = () => {
    if (confirm('WARNING: This will reset all current changes back to seed default data. Proceed?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  // Define Navigation Items
  const navItems = [
    { id: 'DASHBOARD' as TabType, label: 'Operations Board', icon: LayoutDashboard },
    { id: 'INVENTORY' as TabType, label: 'Inventory Stock', icon: Package },
    { id: 'CONTACTS' as TabType, label: 'Vendors & Clients', icon: Users },
    { id: 'EMPLOYEES' as TabType, label: 'Employee Directory', icon: Briefcase },
    { id: 'ORDERS' as TabType, label: 'Sales Contracts', icon: FileSpreadsheet },
    { id: 'PURCHASES' as TabType, label: 'Material purchases', icon: ShoppingBag },
    { id: 'WORKFLOWS' as TabType, label: 'Production Kanban', icon: Shuffle },
    { id: 'REPORTS' as TabType, label: 'AI Automated Reports', icon: BarChart3 },
    { id: 'EXPORT_GUIDE' as TabType, label: 'Desktop/Mobile Export', icon: BookOpen }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row text-slate-900 font-sans">
      
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-slate-300 border-r border-slate-800 shrink-0 select-none">
        
        {/* Sidebar Header Brand */}
        <div 
          onClick={() => {
            setBrandingName(companyProfile.name);
            setBrandingIconType(companyProfile.iconType);
            setBrandingIconDataUrl(companyProfile.iconDataUrl);
            setBrandingAddress(companyProfile.address || '');
            setBrandingPhone(companyProfile.phone || '');
            setBrandingEmail(companyProfile.email || '');
            setBrandingBankName(companyProfile.bankName || '');
            setBrandingBankAccount(companyProfile.bankAccount || '');
            setBrandingSignatureUrl(companyProfile.signatureUrl || '');
            setBrandingChopUrl(companyProfile.chopUrl || '');
            setBrandingError('');
            setShowBrandingModal(true);
          }}
          className="p-6 border-b border-slate-800 cursor-pointer hover:bg-slate-800/30 transition-colors group select-none"
          title="Click to edit company branding"
        >
          <div className="flex items-center space-x-2.5">
            <span className="p-1.5 bg-blue-600 rounded text-white shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
              {renderCompanyIcon("w-4.5 h-4.5")}
            </span>
            <div className="min-w-0">
              <h1 className="font-sans font-bold text-white text-xs tracking-tight truncate group-hover:text-blue-400 transition-colors">
                {companyProfile.name}
              </h1>
              <p className="text-[9px] text-slate-500 font-mono flex items-center space-x-1">
                <span>Machinery & Parts</span>
                <span className="text-slate-600 group-hover:text-slate-400 font-sans text-[8px]">(edit)</span>
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive 
                    ? 'bg-blue-600/10 text-blue-400 font-semibold border-l-4 border-blue-500' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className="w-4.5 h-4.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer Operations */}
        <div className="p-4 border-t border-slate-800 space-y-2 text-[10px] text-slate-500 font-mono">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-sans pb-1 font-semibold border-b border-slate-800/60">
            <span>Database Backup</span>
            <span className="text-[9px] bg-slate-800 text-emerald-400 px-1 py-0.5 rounded uppercase">Local SQL Ready</span>
          </div>
          <button
            onClick={() => setShowImportModal(true)}
            className="w-full flex items-center space-x-2 px-2.5 py-1.5 text-blue-400 hover:text-white hover:bg-blue-600/10 rounded transition-colors text-left font-semibold"
          >
            <Upload className="w-3.5 h-3.5 animate-bounce-subtle" />
            <span>Import & Integration Hub</span>
          </button>
          <button
            onClick={downloadBackup}
            className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:text-white hover:bg-slate-800 rounded transition-colors text-left"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Excel Backup</span>
          </button>
          <button
            onClick={resetDatabase}
            className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors text-left"
          >
            <X className="w-3.5 h-3.5 text-red-500/80" />
            <span>Reset Default Seeds</span>
          </button>
        </div>

      </aside>

      {/* Mobile Top Bar */}
      <header className="md:hidden bg-slate-900 text-slate-300 p-4 border-b border-slate-800 flex items-center justify-between select-none shrink-0">
        <div 
          onClick={() => {
            setBrandingName(companyProfile.name);
            setBrandingIconType(companyProfile.iconType);
            setBrandingIconDataUrl(companyProfile.iconDataUrl);
            setBrandingAddress(companyProfile.address || '');
            setBrandingPhone(companyProfile.phone || '');
            setBrandingEmail(companyProfile.email || '');
            setBrandingBankName(companyProfile.bankName || '');
            setBrandingBankAccount(companyProfile.bankAccount || '');
            setBrandingSignatureUrl(companyProfile.signatureUrl || '');
            setBrandingChopUrl(companyProfile.chopUrl || '');
            setBrandingError('');
            setShowBrandingModal(true);
          }}
          className="flex items-center space-x-2 cursor-pointer active:bg-slate-800/50 rounded p-1 transition-colors select-none"
          title="Tap to edit company branding"
        >
          <span className="p-1 bg-blue-600 rounded text-white shrink-0 flex items-center justify-center">
            {renderCompanyIcon("w-4 h-4")}
          </span>
          <div>
            <h1 className="font-sans font-bold text-white text-xs tracking-tight">{companyProfile.name}</h1>
            <p className="text-[9px] text-slate-500 font-mono">Machinery & Parts • Tap to edit</p>
          </div>
        </div>

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1 hover:text-white transition-colors"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="w-64 bg-slate-900 text-slate-300 p-4 flex flex-col justify-between animate-fade-in-left">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-semibold text-white text-xs">Menu Navigations</span>
                <button onClick={() => setMobileMenuOpen(false)}>
                  <X className="w-5 h-5 hover:text-white" />
                </button>
              </div>
              <nav className="space-y-1.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        isActive 
                          ? 'bg-blue-600/10 text-blue-400 font-semibold border-l-4 border-blue-500' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      <Icon className="w-4.5 h-4.5 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-4 text-[10px] text-slate-500 font-mono">
              <button
                onClick={() => { setDarkMode(!darkMode); setMobileMenuOpen(false); }}
                className="w-full flex items-center space-x-2 px-2.5 py-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors text-left font-semibold text-[11px]"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-400" />}
                <span>{darkMode ? "Switch to Light Theme" : "Switch to Dark Theme"}</span>
              </button>
              <button
                onClick={() => { setShowImportModal(true); setMobileMenuOpen(false); }}
                className="w-full flex items-center space-x-2 px-2.5 py-1.5 text-blue-400 hover:text-white hover:bg-blue-600/10 rounded transition-colors text-left font-semibold"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import & Integration Hub</span>
              </button>
              <button
                onClick={downloadBackup}
                className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:text-white hover:bg-slate-800 rounded transition-colors text-left"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Excel Backup</span>
              </button>
              <button
                onClick={resetDatabase}
                className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors text-left"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset Default Seeds</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 relative overflow-y-auto">
        
        {/* Main Content Top Global Status Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0 select-none">
          <div className="space-y-0.5">
            <h2 className="font-sans font-bold text-slate-900 text-base leading-tight">
              {navItems.find(i => i.id === activeTab)?.label}
            </h2>
            <p className="text-xs text-slate-400 font-sans">
              Operational Hub • Standard local timezone logging.
            </p>
          </div>

          <div className="flex items-center space-x-4">
            {/* Supabase Sync Indicator */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs font-semibold text-emerald-700 shadow-sm">
              <Database className="w-3.5 h-3.5 text-emerald-500" />
              <span>{isSyncing ? 'Syncing...' : 'Supabase Connected'}</span>
            </div>
            
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300 transition-all font-sans text-xs font-medium cursor-pointer"
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-500" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-600" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>

            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block"></div>

            <div className="flex items-center space-x-2 text-xs font-mono">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-slate-500">Offline-First Local Storage Sandbox</span>
            </div>
          </div>
        </header>

        {/* Render Active Tab View */}
        <div className="p-6 flex-1 min-w-0">
          {activeTab === 'DASHBOARD' && <DashboardView key={refreshKey} />}
          {activeTab === 'INVENTORY' && <InventoryView key={refreshKey} onQuickProcure={handleQuickProcure} />}
          {activeTab === 'CONTACTS' && <ContactsView key={refreshKey} />}
          {activeTab === 'EMPLOYEES' && <EmployeesView key={refreshKey} />}
          {activeTab === 'ORDERS' && <OrdersView key={refreshKey} />}
          {activeTab === 'PURCHASES' && (
            <PurchasesView 
              key={refreshKey}
              quickProcureState={quickProcureItem} 
              clearQuickProcure={clearQuickProcure} 
            />
          )}
          {activeTab === 'WORKFLOWS' && <WorkflowsView key={refreshKey} />}
          {activeTab === 'REPORTS' && <ReportsView key={refreshKey} />}
          {activeTab === 'EXPORT_GUIDE' && <ExportGuide key={refreshKey} />}
        </div>

      </main>

      {/* Company Branding Settings Modal */}
      {showBrandingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-sans font-bold text-slate-900 text-sm flex items-center space-x-2">
                <span className="p-1 bg-blue-50 text-blue-600 rounded">
                  <Wrench className="w-4 h-4" />
                </span>
                <span>Company Profile & Branding</span>
              </h3>
              <button 
                type="button" 
                onClick={() => {
                  setBrandingName(companyProfile.name);
                  setBrandingIconType(companyProfile.iconType);
                  setBrandingIconDataUrl(companyProfile.iconDataUrl);
                  setBrandingAddress(companyProfile.address || '');
                  setBrandingPhone(companyProfile.phone || '');
                  setBrandingEmail(companyProfile.email || '');
                  setBrandingBankName(companyProfile.bankName || '');
                  setBrandingBankAccount(companyProfile.bankAccount || '');
                  setBrandingSignatureUrl(companyProfile.signatureUrl || '');
                  setBrandingChopUrl(companyProfile.chopUrl || '');
                  setBrandingError('');
                  setShowBrandingModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold text-base p-1 leading-none"
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!brandingName.trim()) {
                setBrandingError('Company name is required');
                return;
              }
              const updatedProfile: CompanyProfile = {
                name: brandingName.trim(),
                iconType: brandingIconType,
                iconDataUrl: brandingIconDataUrl,
                address: brandingAddress.trim(),
                phone: brandingPhone.trim(),
                email: brandingEmail.trim(),
                bankName: brandingBankName.trim(),
                bankAccount: brandingBankAccount.trim(),
                signatureUrl: brandingSignatureUrl || undefined,
                chopUrl: brandingChopUrl || undefined
              };
              setCompanyProfile(updatedProfile);
              saveCompanyProfile(updatedProfile);
              setRefreshKey(prev => prev + 1); // Refresh views that rely on company profile
              setShowBrandingModal(false);
            }} className="p-5 space-y-4 text-xs text-slate-600 max-h-[85vh] overflow-y-auto">
              
              {brandingError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 font-medium">
                  {brandingError}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold block text-slate-700">Company Name *</label>
                <input
                  type="text"
                  required
                  value={brandingName}
                  onChange={(e) => setBrandingName(e.target.value)}
                  placeholder="e.g. Seng Jie Engineering"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold block text-slate-700">System or Logo Icon</label>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { type: 'database' as const, label: 'DB', icon: Database },
                    { type: 'factory' as const, label: 'Factory', icon: Factory },
                    { type: 'cpu' as const, label: 'CPU', icon: Cpu },
                    { type: 'wrench' as const, label: 'Wrench', icon: Wrench },
                    { type: 'custom_image' as const, label: 'Custom', icon: Camera }
                  ].map((preset) => {
                    const PresetIcon = preset.icon;
                    const isSelected = brandingIconType === preset.type;
                    return (
                      <button
                        key={preset.type}
                        type="button"
                        onClick={() => setBrandingIconType(preset.type)}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${
                          isSelected 
                            ? 'bg-blue-50 border-blue-500 text-blue-600 font-semibold' 
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <PresetIcon className="w-4 h-4 mb-1 shrink-0" />
                        <span className="text-[9px] truncate max-w-full">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {brandingIconType === 'custom_image' && (
                <div className="space-y-2 border border-dashed border-slate-200 rounded-lg p-3 bg-slate-50/50">
                  <span className="font-semibold block text-slate-700">Upload Company Logo Icon</span>
                  
                  <div className="flex items-center space-x-3">
                    {brandingIconDataUrl ? (
                      <div className="relative shrink-0">
                        <img 
                          src={brandingIconDataUrl} 
                          alt="Custom logo preview" 
                          className="w-12 h-12 rounded-lg border border-slate-200 object-contain bg-white p-0.5"
                          referrerPolicy="no-referrer"
                        />
                        <button
                          type="button"
                          onClick={() => setBrandingIconDataUrl(undefined)}
                          className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold text-[9px] hover:bg-red-600 transition-colors"
                          title="Remove custom logo"
                        >
                          &times;
                        </button>
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-400 shrink-0">
                        <Camera className="w-5 h-5 stroke-1" />
                      </div>
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          if (!file.type.startsWith('image/')) {
                            setBrandingError('Only image files are allowed');
                            return;
                          }
                          if (file.size > 500 * 1024) {
                            setBrandingError('Logo image must be smaller than 500KB');
                            return;
                          }
                          
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            setBrandingIconDataUrl(event.target?.result as string);
                            setBrandingError('');
                          };
                          reader.readAsDataURL(file);
                        }}
                        className="text-[10px] text-slate-500 block w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      />
                      <span className="text-[8px] text-slate-400 block mt-1">Recommended square format (Max 500KB)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Invoicing and Contact Details Section */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <span className="font-bold text-slate-800 text-[11px] block uppercase tracking-wider">Invoicing & Contact Details</span>
                
                <div className="space-y-1">
                  <label className="font-semibold block text-slate-700">Company Address</label>
                  <textarea
                    value={brandingAddress}
                    onChange={(e) => setBrandingAddress(e.target.value)}
                    placeholder="e.g. Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor"
                    rows={2}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold block text-slate-700">Phone Number</label>
                    <input
                      type="text"
                      value={brandingPhone}
                      onChange={(e) => setBrandingPhone(e.target.value)}
                      placeholder="e.g. +60 3-8012 3456"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold block text-slate-700">Email / Gmail</label>
                    <input
                      type="email"
                      value={brandingEmail}
                      onChange={(e) => setBrandingEmail(e.target.value)}
                      placeholder="e.g. finance@company.com"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold block text-slate-700">Bank Name</label>
                    <input
                      type="text"
                      value={brandingBankName}
                      onChange={(e) => setBrandingBankName(e.target.value)}
                      placeholder="e.g. Maybank Berhad"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold block text-slate-700">Bank Account No.</label>
                    <input
                      type="text"
                      value={brandingBankAccount}
                      onChange={(e) => setBrandingBankAccount(e.target.value)}
                      placeholder="e.g. 5142-8821-3956"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* Handwritten Authorized Signature Section */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <span className="font-bold text-slate-800 text-[11px] block uppercase tracking-wider">Authorized Signature</span>
                
                <div className="border border-slate-100 bg-slate-50/50 rounded-lg p-3 space-y-3">
                  <SignaturePad 
                    value={brandingSignatureUrl} 
                    onChange={(dataUrl) => setBrandingSignatureUrl(dataUrl)} 
                  />
                  
                  {brandingSignatureUrl && (
                    <div className="space-y-1">
                      <span className="font-semibold block text-slate-500 text-[9px] uppercase tracking-wider">Current Signature Preview</span>
                      <div className="bg-white border border-slate-200 rounded-lg p-2 flex justify-center items-center">
                        <img 
                          src={brandingSignatureUrl} 
                          alt="Signature Preview" 
                          className="h-14 max-w-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 text-xs mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setBrandingName(companyProfile.name);
                    setBrandingIconType(companyProfile.iconType);
                    setBrandingIconDataUrl(companyProfile.iconDataUrl);
                    setBrandingAddress(companyProfile.address || '');
                    setBrandingPhone(companyProfile.phone || '');
                    setBrandingEmail(companyProfile.email || '');
                    setBrandingBankName(companyProfile.bankName || '');
                    setBrandingBankAccount(companyProfile.bankAccount || '');
                    setBrandingSignatureUrl(companyProfile.signatureUrl || '');
                    setBrandingChopUrl(companyProfile.chopUrl || '');
                    setBrandingError('');
                    setShowBrandingModal(false);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm"
                >
                  Save Branding
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ImportExportModal 
        isOpen={showImportModal} 
        onClose={() => setShowImportModal(false)} 
        onDataImported={() => setRefreshKey(prev => prev + 1)}
      />

    </div>
  );
}

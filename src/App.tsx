/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Package,
  Users,
  FileSpreadsheet,
  ShoppingBag,
  Shuffle,
  Database,
  Upload,
  Menu,
  X,
  Factory,
  Cpu,
  Wrench,
  Camera,
  Briefcase,
  Settings,
  Sun,
  Moon,
  Boxes,
  Tag,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useSyncStore } from './helper';
import { CompanyProfile } from './types';
import SignaturePad from './components/SignaturePad';
import { Button, Sheet, FormField, fieldInputClassName } from './components/ui';
import { useFadeInOnMount } from './hooks/useFadeInOnMount';

import DashboardView from './components/DashboardView';
import InventoryView from './components/InventoryView';
import MaterialView from './components/MaterialView';
import ProductView from './components/ProductView';
import ContactsView from './components/ContactsView';
import OrdersView from './components/OrdersView';
import PurchasesView from './components/PurchasesView';
import WorkflowsView from './components/WorkflowsView';
import ImportExportModal from './components/ImportExportModal';
import EmployeesView from './components/EmployeesView';
import SystemAdminView from './components/SystemAdminView';
import { getCompanyProfile, saveCompanyProfile } from './services/CompanyProfileService';
import { CallAPI } from './components/UIHelper';

type TabType = 'DASHBOARD' | 'INVENTORY' | 'MATERIAL' | 'PRODUCT' | 'CONTACTS' | 'EMPLOYEES' | 'ORDERS' | 'PURCHASES' | 'WORKFLOWS' | 'SYSTEM_ADMIN';

// Keep in sync with the latest release header in version.txt
const APP_VERSION = '1.0.5';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('DASHBOARD');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Cross-tab drill-in: ProductView.tsx's/MaterialView.tsx's/InventoryView.tsx's
  // inventory list links jump here — switch tabs and tell the destination
  // view which header to open, since these are separate top-level tabs with
  // no shared router. The "return to" origin is remembered so the detail
  // page's Back button can restore the originating Product/Material detail
  // panel (or the Inventory tab) instead of just showing that tab's list. A
  // material row can link to a sales order too (production consumption
  // against that sale), hence the multiple origins.
  const [pendingSalesOrderId, setPendingSalesOrderId] = useState<string | null>(null);
  const [salesOrderReturnTo, setSalesOrderReturnTo] = useState<{ type: 'PRODUCT' | 'MATERIAL' | 'INVENTORY' | 'PURCHASES'; id: string } | null>(null);
  const navigateToSalesOrder = (salesHeaderId: string, fromProductId?: string, fromMaterialId?: string, fromInventory?: boolean, fromPurchaseId?: string) => {
    setPendingSalesOrderId(salesHeaderId);
    setSalesOrderReturnTo(
      fromMaterialId ? { type: 'MATERIAL', id: fromMaterialId }
        : fromProductId ? { type: 'PRODUCT', id: fromProductId }
          : fromInventory ? { type: 'INVENTORY', id: '' }
            : fromPurchaseId ? { type: 'PURCHASES', id: fromPurchaseId }
              : null
    );
    setActiveTab('ORDERS');
  };
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const returnFromSalesOrder = () => {
    const returnTo = salesOrderReturnTo;
    setSalesOrderReturnTo(null);
    if (returnTo?.type === 'PRODUCT') {
      setPendingProductId(returnTo.id);
      setActiveTab('PRODUCT');
    } else if (returnTo?.type === 'MATERIAL') {
      setPendingMaterialId(returnTo.id);
      setActiveTab('MATERIAL');
    } else if (returnTo?.type === 'INVENTORY') {
      setActiveTab('INVENTORY');
    } else if (returnTo?.type === 'PURCHASES') {
      setPendingPurchaseId(returnTo.id);
      setActiveTab('PURCHASES');
    }
  };

  const [pendingPurchaseId, setPendingPurchaseId] = useState<string | null>(null);
  const [purchaseReturnTo, setPurchaseReturnTo] = useState<{ type: 'MATERIAL' | 'INVENTORY'; id: string } | null>(null);
  const navigateToPurchaseOrder = (purchaseHeaderId: string, fromMaterialId?: string, fromInventory?: boolean) => {
    setPendingPurchaseId(purchaseHeaderId);
    setPurchaseReturnTo(fromMaterialId ? { type: 'MATERIAL', id: fromMaterialId } : fromInventory ? { type: 'INVENTORY', id: '' } : null);
    setActiveTab('PURCHASES');
  };
  const [pendingMaterialId, setPendingMaterialId] = useState<string | null>(null);
  const returnFromPurchaseOrder = () => {
    const returnTo = purchaseReturnTo;
    setPurchaseReturnTo(null);
    if (returnTo?.type === 'MATERIAL') {
      setPendingMaterialId(returnTo.id);
      setActiveTab('MATERIAL');
    } else if (returnTo?.type === 'INVENTORY') {
      setActiveTab('INVENTORY');
    }
  };

  // Cross-tab drill-in to an employee's detail page (from Material's Usage
  // History employee link). Same pattern as sales/purchase above; only origin
  // is Material.
  const [pendingEmployeeId, setPendingEmployeeId] = useState<string | null>(null);
  const [employeeReturnTo, setEmployeeReturnTo] = useState<{ type: 'MATERIAL'; id: string } | null>(null);
  const navigateToEmployee = (employeeId: string, fromMaterialId?: string) => {
    setPendingEmployeeId(employeeId);
    setEmployeeReturnTo(fromMaterialId ? { type: 'MATERIAL', id: fromMaterialId } : null);
    setActiveTab('EMPLOYEES');
  };
  const returnFromEmployee = () => {
    const returnTo = employeeReturnTo;
    setEmployeeReturnTo(null);
    if (returnTo?.type === 'MATERIAL') {
      setPendingMaterialId(returnTo.id);
      setActiveTab('MATERIAL');
    }
  };

  // Dark mode state and persistence
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('erp_dark_mode');
    if (stored) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Desktop sidebar collapse (icon-only rail) — persisted like dark mode.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('erp_sidebar_collapsed') === 'true');
  useEffect(() => { localStorage.setItem('erp_sidebar_collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('erp_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('erp_dark_mode', 'false');
    }
  }, [darkMode]);

  // Company Profile states
  const EMPTY_PROFILE: CompanyProfile = { name: '', icon_type: 'database' };
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [showBrandingModal, setShowBrandingModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isSyncing = useSyncStore((state: any) => state.isSyncing);
  const tabContentRef = useFadeInOnMount<HTMLDivElement>([activeTab, refreshKey]);

  // Fetch company profile — localStorage first, fallback to API
  const loadData = async () => {
    const cachedProfile = JSON.parse(localStorage.getItem('erp_company_profile') || '{}');
    if (cachedProfile && cachedProfile.id) {
      setCompanyProfile(cachedProfile);
      return;
    }
    await CallAPI(getCompanyProfile, {
      onCompleted: setCompanyProfile,
      onError: console.error,
    });
  }
  useEffect(() => {
    loadData();
  }, [])

  const submitData = async (e) => {
    e.preventDefault();
    if (!brandingName.trim()) {
      setBrandingError('Company name is required');
      return;
    }
    const updatedProfile: CompanyProfile = {
      id: brandingID,
      name: brandingName.trim(),
      icon_type: brandingIconType,
      icon_data_url: brandingIconDataUrl,
      address: brandingAddress.trim(),
      phone: brandingPhone.trim(),
      email: brandingEmail.trim(),
      bank_name: brandingBankName.trim(),
      bank_account: brandingBankAccount.trim(),
      signature_url: brandingSignatureUrl || undefined,
    };
    // await saveCompanyProfile(updatedProfile);
    await CallAPI(() => saveCompanyProfile(updatedProfile), {
      onCompleted: () => {
        loadData();
        setRefreshKey(prev => prev + 1);
        setShowBrandingModal(false);
      },
      onError: (error) => setBrandingError(error.message),
    })
  }

  // Discard unsaved edits and close — shared by the drawer's X, backdrop and Cancel.
  const closeBrandingModal = () => {
    setBrandingID(companyProfile.id);
    setBrandingName(companyProfile.name);
    setBrandingIconType(companyProfile.icon_type);
    setBrandingIconDataUrl(companyProfile.icon_data_url);
    setBrandingAddress(companyProfile.address || '');
    setBrandingPhone(companyProfile.phone || '');
    setBrandingEmail(companyProfile.email || '');
    setBrandingBankName(companyProfile.bank_name || '');
    setBrandingBankAccount(companyProfile.bank_account || '');
    setBrandingSignatureUrl(companyProfile.signature_url || '');
    setBrandingError('');
    setShowBrandingModal(false);
  };

  // For the form inside the branding settings modal:
  const [brandingID, setBrandingID] = useState(companyProfile.id);
  const [brandingName, setBrandingName] = useState(companyProfile.name);
  const [brandingIconType, setBrandingIconType] = useState(companyProfile.icon_type);
  const [brandingIconDataUrl, setBrandingIconDataUrl] = useState(companyProfile.icon_data_url);
  const [brandingAddress, setBrandingAddress] = useState(companyProfile.address || '');
  const [brandingPhone, setBrandingPhone] = useState(companyProfile.phone || '');
  const [brandingEmail, setBrandingEmail] = useState(companyProfile.email || '');
  const [brandingBankName, setBrandingBankName] = useState(companyProfile.bank_name || '');
  const [brandingBankAccount, setBrandingBankAccount] = useState(companyProfile.bank_account || '');
  const [brandingSignatureUrl, setBrandingSignatureUrl] = useState(companyProfile.signature_url || '');
  const [brandingError, setBrandingError] = useState('');

  const renderCompanyIcon = (sizeClass = "w-5 h-5") => {
    if (companyProfile.icon_type === 'custom_image' && companyProfile.icon_data_url) {
      return (
        <img
          src={companyProfile.icon_data_url}
          alt="Company logo"
          className={`${sizeClass} object-contain rounded`}
          referrerPolicy="no-referrer"
        />
      );
    }

    switch (companyProfile.icon_type) {
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

  // Define Navigation Items
  const navItems = [
    { id: 'DASHBOARD' as TabType, label: 'Operations Board', icon: LayoutDashboard },
    { id: 'SYSTEM_ADMIN' as TabType, label: 'System Admin', icon: Settings },
    { id: 'CONTACTS' as TabType, label: 'Vendors & Clients', icon: Users },
    { id: 'EMPLOYEES' as TabType, label: 'Employee Directory', icon: Briefcase },
    { id: 'MATERIAL' as TabType, label: 'Material Catalog', icon: Boxes },
    { id: 'PRODUCT' as TabType, label: 'Product Catalog', icon: Tag },
    { id: 'INVENTORY' as TabType, label: 'Inventory Stock', icon: Package },
    { id: 'PURCHASES' as TabType, label: 'Material purchases', icon: ShoppingBag },
    { id: 'ORDERS' as TabType, label: 'Sales Contracts', icon: FileSpreadsheet },
    { id: 'WORKFLOWS' as TabType, label: 'Production Kanban', icon: Shuffle },
  ];

  return (
    <div className="h-dvh max-h-dvh bg-background flex flex-col md:flex-row text-foreground font-sans overflow-hidden">

      {/* Sidebar - Desktop */}
      <aside className={`hidden md:flex flex-col ${sidebarCollapsed ? 'w-16' : 'w-64'} h-dvh shrink-0 select-none overflow-hidden bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200`}>
        {/* Sidebar Header Brand */}
        <div className="flex items-center border-b border-sidebar-foreground/10">
          <div
            onClick={() => {
              setBrandingID(companyProfile.id);
              setBrandingName(companyProfile.name);
              setBrandingIconType(companyProfile.icon_type);
              setBrandingIconDataUrl(companyProfile.icon_data_url);
              setBrandingAddress(companyProfile.address || '');
              setBrandingPhone(companyProfile.phone || '');
              setBrandingEmail(companyProfile.email || '');
              setBrandingBankName(companyProfile.bank_name || '');
              setBrandingBankAccount(companyProfile.bank_account || '');
              setBrandingSignatureUrl(companyProfile.signature_url || '');
              setBrandingError('');
              setShowBrandingModal(true);
            }}
            className="flex-1 min-w-0 p-4 cursor-pointer hover:bg-sidebar-hover/5 transition-colors group select-none"
            title="Click to edit company branding"
          >
            <div className="flex items-center space-x-2.5">
              <span className="p-1 rounded-lg text-sidebar-foreground dark:bg-white shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
                {renderCompanyIcon("w-9 h-9")}
              </span>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="font-sans font-bold text-xs tracking-tight truncate group-hover:text-sidebar-foreground transition-colors text-sidebar-foreground hover:bg-sidebar-hover">
                    {companyProfile.name}
                  </h1>
                  <p className="text-[9px] font-mono flex items-center space-x-1 text-sidebar-foreground hover:bg-sidebar-hover">
                    <span>Machinery & Parts</span>
                    <span className="text-sidebar-foreground/30 group-hover:text-sidebar-foreground/50 font-sans text-[8px]">(edit)</span>
                  </p>
                </div>
              )}
            </div>
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="shrink-0 mr-2 p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 transition-colors"
              title="Collapse sidebar"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          )}
        </div>
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="mx-auto mt-2 p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 transition-colors"
            title="Expand sidebar"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        )}

        {/* Navigation Section */}
        <nav className="flex-1 min-h-0 p-4 space-y-1 overflow-y-auto overscroll-contain">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-xs font-medium transition-all text-sidebar-foreground hover:bg-sidebar-hover transition-colors ${sidebarCollapsed ? 'justify-center px-0' : ''} ${isActive
                  ? 'bg-sidebar-active text-sidebar-foreground font-semibold'
                  : 'text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10'
                  }`}
              >
                <Icon className="w-4.5 h-4.5 shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer Operations */}
        <div className="p-4 border-t border-sidebar-foreground/10 space-y-2 text-[10px] text-sidebar-foreground/40 font-mono">
          <button
            onClick={() => setShowImportModal(true)}
            title={sidebarCollapsed ? 'Import / Export Hub' : undefined}
            className={`w-full flex items-center space-x-2 px-2.5 py-1.5 text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 rounded-lg transition-colors text-left font-semibold ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
          >
            <Upload className="w-3.5 h-3.5 animate-bounce-subtle shrink-0" />
            {!sidebarCollapsed && <span>Import / Export Hub</span>}
          </button>
          {!sidebarCollapsed && <p className="px-2.5 text-right">v{APP_VERSION}</p>}
        </div>

      </aside>

      {/* Mobile Top Bar — same sidebar tokens as the desktop aside, so the app looks consistent between viewports */}
      <header className="md:hidden bg-sidebar text-sidebar-foreground p-4 border-b border-sidebar-foreground/10 flex items-center justify-between select-none shrink-0">
        <div
          onClick={() => {
            setBrandingID(companyProfile.id);
            setBrandingName(companyProfile.name);
            setBrandingIconType(companyProfile.icon_type);
            setBrandingIconDataUrl(companyProfile.icon_data_url);
            setBrandingAddress(companyProfile.address || '');
            setBrandingPhone(companyProfile.phone || '');
            setBrandingEmail(companyProfile.email || '');
            setBrandingBankName(companyProfile.bank_name || '');
            setBrandingBankAccount(companyProfile.bank_account || '');
            setBrandingSignatureUrl(companyProfile.signature_url || '');
            setBrandingError('');
            setShowBrandingModal(true);
          }}
          className="flex items-center space-x-2 cursor-pointer active:bg-sidebar-foreground/10 rounded-md p-1 transition-colors select-none"
          title="Tap to edit company branding"
        >
          <span className="p-1 rounded-lg text-sidebar-foreground dark:bg-white shrink-0 flex items-center justify-center">
            {renderCompanyIcon("w-6 h-6")}
          </span>
          <div>
            <h1 className="font-sans font-bold text-sidebar-foreground text-xs tracking-tight">{companyProfile.name}</h1>
            <p className="text-[9px] text-sidebar-foreground/40 font-mono">Machinery & Parts • Tap to edit</p>
          </div>
        </div>

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1 hover:text-sidebar-foreground transition-colors"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      {/* Mobile Menu Drawer — same sidebar tokens as the desktop aside */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-foreground/60 backdrop-blur-sm flex justify-end overflow-hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-64 h-dvh bg-sidebar text-sidebar-foreground p-4 flex flex-col justify-between animate-fade-in-left overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between border-b border-sidebar-foreground/10 pb-3">
                <span className="font-semibold text-sidebar-foreground text-xs">Menu Navigations</span>
                <button onClick={() => setMobileMenuOpen(false)}>
                  <X className="w-5 h-5 hover:text-sidebar-foreground" />
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
                      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-xs font-medium transition-all ${isActive
                        ? 'bg-sidebar-active text-sidebar-foreground font-semibold'
                        : 'text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10'
                        }`}
                    >
                      <Icon className="w-4.5 h-4.5 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="space-y-2 border-t border-sidebar-foreground/10 pt-4 text-[10px] text-sidebar-foreground/40 font-mono">
              <button
                onClick={() => { setDarkMode(!darkMode); setMobileMenuOpen(false); }}
                className="w-full flex items-center space-x-2 px-2.5 py-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 rounded-md transition-colors text-left font-semibold text-[11px]"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5 text-warning" /> : <Moon className="w-3.5 h-3.5 text-sidebar-foreground" />}
                <span>{darkMode ? "Switch to Light Theme" : "Switch to Dark Theme"}</span>
              </button>
              <button
                onClick={() => { setShowImportModal(true); setMobileMenuOpen(false); }}
                className="w-full flex items-center space-x-2 px-2.5 py-1.5 text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 rounded-md transition-colors text-left font-semibold"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import / Export Hub</span>
              </button>
              <p className="px-2.5 text-right">v{APP_VERSION}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 flex flex-col min-w-0 bg-background relative overflow-hidden">

        {/* Main Content Top Global Status Header */}
        <header className="bg-card border-b border-border px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0 select-none">
          <div className="space-y-0.5">
            <h2 className="font-sans font-bold text-card-foreground text-base leading-tight">
              {navItems.find(i => i.id === activeTab)?.label}
            </h2>
            <p className="text-xs text-muted-foreground font-sans">
              Operational Hub • Standard local timezone logging.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDarkMode(!darkMode)}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? (
                <>
                  <Sun className="w-4 h-4 text-warning" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-sidebar-foreground" />
                  <span>Dark Mode</span>
                </>
              )}
            </Button>
            {/* Supabase Sync Indicator */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-success/10 border border-success/20 rounded-lg text-xs font-semibold text-success shadow-sm">
              <Database className="w-3.5 h-3.5" />
              <span>{isSyncing ? 'Syncing...' : 'Online'}</span>
            </div>
          </div>
        </header>

        {/* Render Active Tab View */}
        <div ref={tabContentRef} className="p-6 flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain">
          <div data-fade-item key={activeTab} className="contents">
            {activeTab === 'DASHBOARD' && (
              <DashboardView
                key={refreshKey}
                onNavigate={setActiveTab}
                onViewSalesOrder={(id) => navigateToSalesOrder(id)}
                onViewPurchaseOrder={(id) => navigateToPurchaseOrder(id)}
              />
            )}
            {activeTab === 'INVENTORY' && (
              <InventoryView
                key={refreshKey}
                onViewPurchaseOrder={(purchaseHeaderId) => navigateToPurchaseOrder(purchaseHeaderId, undefined, true)}
                onViewSalesOrder={(salesHeaderId) => navigateToSalesOrder(salesHeaderId, undefined, undefined, true)}
              />
            )}
            {activeTab === 'MATERIAL' && (
              <MaterialView
                onViewEmployee={navigateToEmployee}
                key={refreshKey}
                onViewPurchaseOrder={navigateToPurchaseOrder}
                onViewSalesOrder={navigateToSalesOrder}
                initialMaterialId={pendingMaterialId}
                onInitialMaterialHandled={() => setPendingMaterialId(null)}
              />
            )}
            {activeTab === 'PRODUCT' && (
              <ProductView
                key={refreshKey}
                onViewSalesOrder={navigateToSalesOrder}
                initialProductId={pendingProductId}
                onInitialProductHandled={() => setPendingProductId(null)}
              />
            )}
            {activeTab === 'CONTACTS' && <ContactsView key={refreshKey} />}
            {activeTab === 'EMPLOYEES' && (
              <EmployeesView
                key={refreshKey}
                initialEmployeeId={pendingEmployeeId}
                onInitialEmployeeHandled={() => setPendingEmployeeId(null)}
                onReturnToOrigin={returnFromEmployee}
                onViewSalesOrder={(salesHeaderId) => navigateToSalesOrder(salesHeaderId)}
              />
            )}
            {activeTab === 'ORDERS' && (
              <OrdersView
                key={refreshKey}
                initialOrderId={pendingSalesOrderId}
                onInitialOrderHandled={() => setPendingSalesOrderId(null)}
                initialOrderOrigin={salesOrderReturnTo?.type}
                onReturnToOrigin={returnFromSalesOrder}
              />
            )}
            {activeTab === 'PURCHASES' && (
              <PurchasesView
                key={refreshKey}
                initialPurchaseId={pendingPurchaseId}
                onInitialPurchaseHandled={() => setPendingPurchaseId(null)}
                initialPurchaseOrigin={purchaseReturnTo?.type}
                onReturnToOrigin={returnFromPurchaseOrder}
                onViewSalesOrder={(salesHeaderId, purchaseHeaderId) => navigateToSalesOrder(salesHeaderId, undefined, undefined, undefined, purchaseHeaderId)}
              />
            )}
            {activeTab === 'WORKFLOWS' && <WorkflowsView key={refreshKey} />}
            {activeTab === 'SYSTEM_ADMIN' && <SystemAdminView key={refreshKey} />}
          </div>
        </div>

      </main>

      {/* Company Profile & Branding drawer */}
      <Sheet
        open={showBrandingModal}
        onClose={closeBrandingModal}
        title="Company Profile & Branding"
        description="Shown on the sidebar, printed quotations and invoices."
        width="w-full max-w-md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={closeBrandingModal}>Cancel</Button>
            <Button type="submit" form="branding-form">Save Branding</Button>
          </div>
        }
      >
        <form id="branding-form" onSubmit={async (e) => { submitData(e) }} className="p-5 space-y-4 text-xs">

          {brandingError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg font-medium">
              {brandingError}
            </div>
          )}

          <FormField label="Company Name *">
            <input
              type="text"
              required
              value={brandingName}
              onChange={(e) => setBrandingName(e.target.value)}
              placeholder="e.g. Seng Jie Engineering"
              className={fieldInputClassName}
            />
          </FormField>

          <div className="space-y-1.5">
            <label className="font-semibold block">System or Logo Icon</label>
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
                    className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${isSelected
                      ? 'bg-primary/10 border-primary text-primary font-semibold'
                      : 'bg-secondary/30 border-border text-muted-foreground hover:border-ring'
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
            <div className="space-y-2 border border-dashed border-border rounded-lg p-3 bg-secondary/30">
              <span className="font-semibold block text-foreground">Upload Company Logo Icon</span>

              <div className="flex items-center space-x-3">
                {brandingIconDataUrl ? (
                  <div className="relative shrink-0">
                    <img
                      src={brandingIconDataUrl}
                      alt="Custom logo preview"
                      className="w-12 h-12 rounded-lg border border-border object-contain bg-card p-0.5"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      type="button"
                      onClick={() => setBrandingIconDataUrl(undefined)}
                      className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center font-bold text-[9px] hover:bg-destructive/80 transition-colors"
                      title="Remove custom logo"
                    >
                      &times;
                    </button>
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-lg border border-border bg-card flex items-center justify-center text-muted-foreground shrink-0">
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
                    className="text-[10px] text-muted-foreground block w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                  />
                  <span className="text-[8px] text-muted-foreground block mt-1">Recommended square format (Max 500KB)</span>
                </div>
              </div>
            </div>
          )}

          {/* Invoicing and Contact Details Section */}
          <div className="pt-3 border-t border-border space-y-3">
            <span className="font-bold text-foreground text-[11px] block uppercase tracking-wider">Invoicing & Contact Details</span>

            <FormField label="Company Address">
              <textarea
                value={brandingAddress}
                onChange={(e) => setBrandingAddress(e.target.value)}
                placeholder="e.g. Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor"
                rows={2}
                className={`${fieldInputClassName} resize-none`}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Phone Number">
                <input
                  type="text"
                  value={brandingPhone}
                  onChange={(e) => setBrandingPhone(e.target.value)}
                  placeholder="e.g. +60 3-8012 3456"
                  className={fieldInputClassName}
                />
              </FormField>

              <FormField label="Email / Gmail">
                <input
                  type="email"
                  value={brandingEmail}
                  onChange={(e) => setBrandingEmail(e.target.value.toLowerCase())}
                  placeholder="e.g. finance@company.com"
                  className={fieldInputClassName}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Bank Name">
                <input
                  type="text"
                  value={brandingBankName}
                  onChange={(e) => setBrandingBankName(e.target.value)}
                  placeholder="e.g. Maybank Berhad"
                  className={fieldInputClassName}
                />
              </FormField>

              <FormField label="Bank Account No.">
                <input
                  type="text"
                  value={brandingBankAccount}
                  onChange={(e) => setBrandingBankAccount(e.target.value)}
                  placeholder="e.g. 5142-8821-3956"
                  className={fieldInputClassName}
                />
              </FormField>
            </div>
          </div>

          {/* Handwritten Authorized Signature Section */}
          <div className="pt-3 border-t border-border space-y-3">
            <span className="font-bold text-foreground text-[11px] block uppercase tracking-wider">Authorized Signature</span>

            <div className="border border-border bg-secondary/30 rounded-lg p-3 space-y-3">
              <SignaturePad
                value={brandingSignatureUrl}
                onChange={(dataUrl) => setBrandingSignatureUrl(dataUrl)}
              />

              {brandingSignatureUrl && (
                <div className="space-y-1">
                  <span className="font-semibold block text-muted-foreground text-[9px] uppercase tracking-wider">Current Signature Preview</span>
                  {/* Signature preview stays white — the PNG is placed onto white printed documents. */}
                  <div className="bg-white border border-border rounded-lg p-2 flex justify-center items-center">
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
        </form>
      </Sheet>

      <ImportExportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onDataImported={() => setRefreshKey(prev => prev + 1)}
      />

    </div>
  );
}

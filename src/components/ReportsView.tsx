/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { getInventory, getSalesOrders, getPurchaseOrders, getDashboardStats, getVendors, addPurchaseOrder } from '../services/db';
import { getWorkflowTasks } from '../services/WorkflowsService';
import { WorkflowTask } from '../types';
import { Sparkles, AlertTriangle, RefreshCw, ChevronRight, FileText, BrainCircuit, Play, ShoppingCart } from 'lucide-react';
import Markdown from 'react-markdown';
import LoadingSpinner from './LoadingSpinner';

export default function ReportsView() {
  const [stats, setStats] = useState(() => getDashboardStats());
  const [inventory, setInventory] = useState(() => getInventory());
  const [salesOrders, setSalesOrders] = useState(() => getSalesOrders());
  const [purchaseOrders, setPurchaseOrders] = useState(() => getPurchaseOrders());
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTask[]>([]);

  useEffect(() => {
    getWorkflowTasks().then(setWorkflowTasks).catch(console.error);
  }, []);

  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  // Find all low stock materials
  const lowStockMaterials = useMemo(() => {
    return inventory.filter(item => item.type === 'RAW_MATERIAL' && item.quantity <= item.reorderPoint);
  }, [inventory]);

  // Handle auto-replenish all low stock
  const handleAutoReplenishAll = () => {
    if (lowStockMaterials.length === 0) return;

    const vendors = getVendors();
    let poCreatedCount = 0;
    lowStockMaterials.forEach(item => {
      if (item.supplierId) {
        const vendor = vendors.find(v => v.id === item.supplierId);
        // Create ordered PO for 2x reorder point or minimum 50 units
        const purchaseQty = Math.max(50, item.reorderPoint * 2);
        addPurchaseOrder({
          vendorId: item.supplierId,
          vendorName: vendor ? vendor.companyName : 'Unknown Supplier',
          itemId: item.id,
          itemName: item.name,
          quantity: purchaseQty,
          unitCost: item.unitCost,
          status: 'ORDERED'
        });
        poCreatedCount++;
      }
    });

    if (poCreatedCount > 0) {
      alert(`Successfully generated ${poCreatedCount} Purchase Orders for critical raw materials! Check the Purchase Orders tab.`);
      // Refresh local states
      setInventory(getInventory());
      setPurchaseOrders(getPurchaseOrders());
      setStats(getDashboardStats());
    } else {
      alert('Could not find suppliers assigned to low-stock items to auto-generate POs.');
    }
  };

  // Run AI operations analyst
  const runAiAnalysis = async () => {
    setIsLoading(true);
    setAiReport(null);

    const steps = [
      'Ingesting current warehouse inventory records...',
      'Mapping pending sales contract requirements...',
      'Simulating machinery recipe consumption levels...',
      'Evaluating vendor delivery lead performances...',
      'Running operations diagnosis with Gemini AI...'
    ];

    let currentStepIdx = 0;
    setLoadingStep(steps[currentStepIdx]);

    const stepInterval = setInterval(() => {
      currentStepIdx++;
      if (currentStepIdx < steps.length) {
        setLoadingStep(steps[currentStepIdx]);
      }
    }, 1200);

    try {
      const response = await fetch('/api/reports/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory,
          salesOrders,
          purchaseOrders,
          workflowTasks,
          stats: { ...stats, activeWorkflowsCount: workflowTasks.filter(t => t.stage !== 'COMPLETED').length }
        })
      });

      const data = await response.json();
      clearInterval(stepInterval);

      if (data.error) {
        setAiReport(`### ❌ Analytical Server Error\n\nFailed to complete diagnosis: ${data.error}`);
      } else {
        setAiReport(data.report);
      }
    } catch (error: any) {
      clearInterval(stepInterval);
      setAiReport(`### ❌ Connection Error\n\nFailed to establish connection with the AI server: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8" id="reports-view">
      
      {/* Top section: Raw Stock Auto-Replenishment */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 max-w-4xl">
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div className="space-y-1">
            <h3 className="font-sans font-semibold text-slate-900 flex items-center space-x-2">
              <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0" />
              <span>Automated Material Restocking Tool</span>
            </h3>
            <p className="text-xs text-slate-500">
              Scans inventory levels and allows you to instantly generate purchase orders for materials that are below safety limits.
            </p>
          </div>

          {lowStockMaterials.length > 0 && (
            <button
              onClick={handleAutoReplenishAll}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Auto-Restock All</span>
            </button>
          )}
        </div>

        {lowStockMaterials.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400 font-sans">
            ✓ All raw stocks are at safe operational limits. No restocks required.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {lowStockMaterials.map(item => (
              <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{item.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono">Current: {item.quantity} {item.unit} / Min: {item.reorderPoint}</div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded font-mono font-bold border border-red-100">
                    -{item.reorderPoint - item.quantity} units short
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main AI Diagnostic Section */}
      <div className="space-y-4 max-w-4xl">
        <div className="flex items-center space-x-2 text-slate-800">
          <BrainCircuit className="w-5 h-5 text-indigo-500" />
          <h3 className="font-sans font-semibold text-slate-900">Gemini Automated Operations Analyst</h3>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-white shadow-xl space-y-6 relative overflow-hidden">
          {/* Accent Glow */}
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-2xl" />

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative z-10">
            <div className="space-y-1">
              <h4 className="font-sans font-semibold text-white flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
                <span>Small Business Operations Diagnosis</span>
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                By sending current stock metrics, sales contracts, open suppliers purchases, and active workers workflows to Gemini, this tool generates a comprehensive logistics audit and forecasts stock safety levels.
              </p>
            </div>

            <button
              onClick={runAiAnalysis}
              disabled={isLoading}
              className={`flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold shadow-md transition-all font-sans self-start ${
                isLoading 
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700' 
                  : 'bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white border border-indigo-400/20'
              }`}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Diagnosing Operations...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>Run Operations Diagnosis</span>
                </>
              )}
            </button>
          </div>

          {/* Report Display or Loading State */}
          {isLoading && (
            <LoadingSpinner 
              message={loadingStep} 
              subtitle="GEMINI_COGNITION_ACTIVE" 
            />
          )}

          {!isLoading && aiReport && (
            <div className="border border-slate-800 bg-slate-950/70 rounded-xl p-6 font-sans text-xs text-slate-300 relative z-10 leading-relaxed overflow-x-auto select-text prose-invert max-h-[500px] overflow-y-auto">
              <div className="markdown-body">
                <Markdown>{aiReport}</Markdown>
              </div>
            </div>
          )}

          {!isLoading && !aiReport && (
            <div className="border border-slate-800/60 bg-slate-950/30 rounded-xl p-8 flex flex-col items-center justify-center space-y-2 text-center text-xs text-slate-500 relative z-10">
              <FileText className="w-10 h-10 text-slate-700" />
              <p className="font-semibold text-slate-400">No active operational diagnosis loaded.</p>
              <p className="max-w-xs text-[10px] text-slate-500">
                Click the button above to run our automated manufacturing analyst and audit your factory floor parameters.
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

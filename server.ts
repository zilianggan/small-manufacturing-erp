/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
if (typeof __dirname !== 'undefined') {
  dotenv.config({ path: path.join(__dirname, '../.env') });
}

const app = express();
const PORT = 3000;

// JSON parser middleware for API routes
app.use(express.json());

// Initialize Gemini Client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not defined in environment variables.');
  }
  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// Server-side Supabase client for paginated data endpoints
const supabaseServer = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

const ALLOWED_TABLES = [
  'inventory_items',
  'vendors',
  'clients',
  'sales_orders',
  'purchase_orders',
  'workflow_tasks',
  'employees'
];

// Columns searched (OR'd with ilike) when a `q` param is supplied.
const SEARCH_COLUMNS: Record<string, string[]> = {
  inventory_items: ['name', 'sku'],
  vendors: ['name', 'contact_name', 'email'],
  clients: ['name', 'company_name', 'contact_name'],
  sales_orders: ['client_name', 'item_name'],
  purchase_orders: ['vendor_name', 'item_name'],
  workflow_tasks: ['product_name'],
  employees: ['name', 'role', 'email'],
};

// Columns allowed as simple equality filters, e.g. ?type=RAW_MATERIAL
const FILTERABLE_COLUMNS: Record<string, string[]> = {
  inventory_items: ['type'],
  vendors: [],
  clients: [],
  sales_orders: ['status'],
  purchase_orders: ['status'],
  workflow_tasks: ['current_step'],
  employees: ['status', 'department'],
};

// 1. Health check API endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 1b. Data fetch endpoint - returns the full table (no limit/offset for now;
// pagination was causing issues and has been rolled back). Still supports
// optional `q` search and simple equality filters server-side.
app.get('/api/data/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!ALLOWED_TABLES.includes(table)) {
      res.status(400).json({ error: 'Invalid table' });
      return;
    }

    const search = ((req.query.q as string) || '').trim();

    let query = supabaseServer
      .from(table)
      .select('*')
      .order('created_at', { ascending: true });

    if (search && SEARCH_COLUMNS[table]?.length) {
      const orExpr = SEARCH_COLUMNS[table].map(col => `${col}.ilike.%${search}%`).join(',');
      query = query.or(orExpr);
    }

    for (const col of FILTERABLE_COLUMNS[table] || []) {
      const val = req.query[col] as string | undefined;
      if (val) query = query.eq(col, val);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      data,
      total: data?.length || 0,
      hasMore: false
    });
  } catch (error: any) {
    console.error('Data fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
});

// 1b-2. Aggregate dashboard stats — computed server-side so the dashboard
// never needs to pull full tables to the client just to sum numbers.
app.get('/api/stats', async (req, res) => {
  try {
    const [invRes, soRes, poRes, wfRes] = await Promise.all([
      supabaseServer.from('inventory_items').select('quantity, unit_cost, reorder_point, name, sku, unit, type'),
      supabaseServer.from('sales_orders').select('status, total_price'),
      supabaseServer.from('purchase_orders').select('status, total_cost'),
      supabaseServer.from('workflow_tasks').select('current_step, product_name, quantity, assigned_to')
    ]);

    if (invRes.error) throw invRes.error;
    if (soRes.error) throw soRes.error;
    if (poRes.error) throw poRes.error;
    if (wfRes.error) throw wfRes.error;

    const inventory = invRes.data || [];
    const salesOrders = soRes.data || [];
    const purchaseOrders = poRes.data || [];
    const workflows = wfRes.data || [];

    const totalSales = salesOrders
      .filter((s: any) => s.status !== 'CANCELLED')
      .reduce((sum: number, s: any) => sum + Number(s.total_price), 0);
    const totalPurchaseCosts = purchaseOrders
      .filter((p: any) => p.status === 'RECEIVED')
      .reduce((sum: number, p: any) => sum + Number(p.total_cost), 0);
    const inventoryValuation = inventory.reduce((sum: number, i: any) => sum + Number(i.quantity) * Number(i.unit_cost), 0);
    const lowStockItems = inventory
      .filter((i: any) => Number(i.quantity) <= Number(i.reorder_point))
      .slice(0, 5)
      .map((i: any) => ({ name: i.name, sku: i.sku, quantity: Number(i.quantity), unit: i.unit, reorderPoint: Number(i.reorder_point) }));
    const activeWorkflows = workflows
      .filter((w: any) => w.current_step !== 'COMPLETED')
      .slice(0, 5)
      .map((w: any) => ({ productName: w.product_name, quantity: Number(w.quantity), assignedTo: w.assigned_to, currentStep: w.current_step }));

    const rawMaterialsVal = inventory.filter((i: any) => i.type === 'RAW_MATERIAL').reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unit_cost), 0);
    const finishedGoodsVal = inventory.filter((i: any) => i.type === 'FINISHED_GOOD').reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unit_cost), 0);

    res.json({
      totalSales,
      totalPurchaseCosts,
      totalProfit: totalSales - totalPurchaseCosts,
      inventoryValuation,
      lowStockCount: inventory.filter((i: any) => Number(i.quantity) <= Number(i.reorder_point)).length,
      pendingOrdersCount: salesOrders.filter((s: any) => s.status === 'PENDING').length,
      activeWorkflowsCount: workflows.filter((w: any) => w.current_step !== 'COMPLETED').length,
      lowStockItems,
      activeWorkflows,
      inventoryBreakdown: { rawMaterialsVal, finishedGoodsVal }
    });
  } catch (error: any) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
});

// 1c. Company profile endpoint
app.get('/api/profile', async (req, res) => {
  try {
    const { data, error } = await supabaseServer
      .from('company_profile')
      .select('*')
      .eq('id', 'default')
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.json(null); return; }
    res.json({
      name: data.name,
      iconType: data.icon_type,
      iconDataUrl: data.icon_data_url,
      address: data.address,
      phone: data.phone,
      email: data.email,
      bankName: data.bank_name,
      bankAccount: data.bank_account,
      signatureUrl: data.signature_url,
      chopUrl: data.chop_url
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Automated Smart Manufacturing Report Generator Endpoint
app.post('/api/reports/analyze', async (req, res) => {
  try {
    const { inventory, salesOrders, purchaseOrders, workflowTasks, stats } = req.body;

    if (!inventory || !salesOrders) {
      res.status(400).json({ error: 'Missing business metrics for analysis' });
      return;
    }

    const ai = getGeminiClient();
    if (!process.env.GEMINI_API_KEY) {
      res.json({
        report: `## ⚠️ AI Analytical Service Offline

The Gemini AI Analyst is currently offline because the **GEMINI_API_KEY** is missing.

To enable full Automated Smart Reports:
1. Open the **Settings > Secrets** panel in AI Studio.
2. Add your **GEMINI_API_KEY** secret.
3. The server will automatically load the key!

### Simulated Manufacturing Insights (Mock Output)
- **Inventory Alert**: Raw material *Premium Oak Timber* is approaching reorder threshold (150 sq ft available, reorder point is 50).
- **Bottleneck Warning**: 1 pending task in *Assembly* phase. Jim Halpert is currently assigned.
- **Financial Status**: Sales are looking healthy at $7,510, with $1,750 in raw purchases, yielding a projected gross profit of $5,760.`
      });
      return;
    }

    const prompt = `You are an elite Operations Consultant and AI Manufacturing Analyst for a small furniture craft/manufacturing business.
Analyze our current business operations data below and generate a professional, highly actionable Automated Manufacturing Performance & Stock Forecasting Report.

### CURRENT MANUFACTURING ERP DATA:

1. Inventory Stock:
${JSON.stringify(inventory, null, 2)}

2. Sales Orders (Customer Orders):
${JSON.stringify(salesOrders, null, 2)}

3. Purchase Orders (Raw material supply):
${JSON.stringify(purchaseOrders, null, 2)}

4. Active Workflows (Manufacturing queue):
${JSON.stringify(workflowTasks, null, 2)}

5. Business Metrics:
- Total Sales Revenue: $${stats?.totalSales || 0}
- Total Purchase Cost: $${stats?.totalPurchaseCosts || 0}
- Valuation of current inventory (raw + finished): $${stats?.inventoryValuation || 0}
- Low Stock Alerts: ${stats?.lowStockCount || 0} items
- Active production runs: ${stats?.activeWorkflowsCount || 0}

Please generate the report in a clear, clean Markdown format with the following specific sections:
- **📊 Executive Operational Summary**: A fast executive overview of current factory health and financial performance.
- **🚨 Stock Alert & Raw Materials Procurement Plan**: Identify materials near or below their reorder points. Give precise reorder recommendations (item, quantity, suggested supplier based on vendor listings in data).
- **🔧 Manufacturing Workflows & Bottlenecks**: Analyze active workflow tasks. Highlight which step is currently the bottleneck, and provide a strategy to optimize production flow.
- **💡 Revenue & Demand Forecasting**: Identify our best-selling finished items vs highest-cost components. Forecast what materials we need to order immediately to fulfill pending Sales Orders in "PENDING" or "IN_PRODUCTION" status.
- **🎯 Immediate Action Checklist**: A clear, numbered checklist of things the operations manager must do today.

Be objective, helpful, precise, and use clean formatting. Avoid generic fluff.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    res.json({ report: response.text });
  } catch (error: any) {
    console.error('Gemini Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate automated report', details: error.message });
  }
});

// Start server function incorporating Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = __dirname;
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

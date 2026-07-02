/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
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

// 1. Health check API endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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

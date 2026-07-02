/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Shield, Smartphone, Monitor, Database, Settings, ArrowRight, CheckCircle } from 'lucide-react';

export default function ExportGuide() {
  return (
    <div className="space-y-8 max-w-4xl" id="export-guide">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
          <Settings className="w-64 h-64 rotate-12" />
        </div>
        <div className="relative z-10 space-y-4">
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-mono rounded-full border border-emerald-500/20">
            Technology Consultation & Roadmap
          </span>
          <h2 className="text-3xl font-sans font-medium tracking-tight">
            How to Build & Compile This ERP into Desktop (Electron) or Mobile (Capacitor)
          </h2>
          <p className="text-slate-400 max-w-2xl text-sm leading-relaxed">
            Because this ERP is engineered using <strong>React, TypeScript, and Tailwind CSS</strong>, it compiles into 100% standard web assets inside the <code className="bg-slate-800 text-slate-200 px-1.5 py-0.5 rounded text-xs font-mono">dist/</code> directory. Both Electron and Capacitor wrap these assets directly, making your transition seamless.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Electron Section */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center space-x-3 text-indigo-600">
            <Monitor className="w-6 h-6" />
            <h3 className="font-sans font-semibold text-lg text-slate-900">1. Desktop Program (Electron)</h3>
          </div>
          <p className="text-slate-600 text-xs leading-relaxed">
            Best for a dedicated office computer or factory terminal. Allows direct hardware access (barcode scanners, label printers) and offline-first file storage.
          </p>
          <div className="space-y-3 pt-2">
            <div className="text-xs font-semibold text-slate-800 font-mono">Implementation Plan:</div>
            <ol className="space-y-2 text-xs text-slate-600 list-decimal pl-4">
              <li>Initialize Electron in your root: <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">npm install electron electron-builder --save-dev</code></li>
              <li>Create a simple main process script <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">electron-main.js</code> that creates a window and loads <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">dist/index.html</code>.</li>
              <li>Configure packaging in <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">package.json</code> pointing to your built files.</li>
              <li>Compile and package with one command: <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">electron-builder</code> to produce <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">.exe</code> or <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">.dmg</code> apps.</li>
            </ol>
          </div>
        </div>

        {/* Capacitor Section */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center space-x-3 text-emerald-600">
            <Smartphone className="w-6 h-6" />
            <h3 className="font-sans font-semibold text-lg text-slate-900">2. Mobile App (Capacitor)</h3>
          </div>
          <p className="text-slate-600 text-xs leading-relaxed">
            Perfect for factory floor operators updating task stages via tablet, or warehouse workers scanning inventory barcodes on the go.
          </p>
          <div className="space-y-3 pt-2">
            <div className="text-xs font-semibold text-slate-800 font-mono">Implementation Plan:</div>
            <ol className="space-y-2 text-xs text-slate-600 list-decimal pl-4">
              <li>Add Capacitor to your project: <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">npm install @capacitor/core @capacitor/cli</code></li>
              <li>Initialize: <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">npx cap init</code> and set web-dir to <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">dist</code>.</li>
              <li>Add platforms: <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">npm install @capacitor/android @capacitor/ios</code> followed by <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">npx cap add android</code> or <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">ios</code>.</li>
              <li>Sync changes whenever you build your React app: <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono">npm run build && npx cap sync</code>. Open in Xcode/Android Studio to run!</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-6">
        <h3 className="font-sans font-semibold text-slate-900 flex items-center space-x-2">
          <Database className="w-5 h-5 text-indigo-500" />
          <span>Recommended Database Architecture for Manufacturing</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 shadow-sm">
            <h4 className="font-semibold text-slate-800 flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>1. Cloud Firestore (Default)</span>
            </h4>
            <p className="text-slate-600 leading-relaxed">
              <strong>Ideal for cross-device synchronization</strong>. Operators on mobile tablets and managers on desktop computers can view and update the factory queue in real-time. Firestore provides seamless offline caching natively.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 shadow-sm">
            <h4 className="font-semibold text-slate-800 flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
              <span>2. Local SQLite</span>
            </h4>
            <p className="text-slate-600 leading-relaxed">
              <strong>Best for strict local-only security</strong>. Inside Electron, use <code className="bg-slate-100 px-1 rounded font-mono">better-sqlite3</code>. Inside Capacitor, use <code className="bg-slate-100 px-1 rounded font-mono">cordova-sqlite-storage</code>. This stores all data directly in a fast, robust relational file on the device.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 shadow-sm">
            <h4 className="font-semibold text-slate-800 flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>3. Hybrid PostgreSQL API</span>
            </h4>
            <p className="text-slate-600 leading-relaxed">
              <strong>Best for scalable multi-plant setups</strong>. Build a centralized Express API with a PostgreSQL database (e.g. hosted on Google Cloud SQL). Both Capacitor and Electron make REST API requests securely over HTTPS to query data.
            </p>
          </div>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 flex items-start space-x-3 text-xs text-indigo-900 leading-relaxed">
          <Shield className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">How we structured this application for you:</span>
            <p className="text-indigo-800">
              We implemented a <strong>modular database service layer</strong> in <code className="bg-indigo-100/60 px-1 rounded font-mono">src/services/db.ts</code>. Currently, it automatically saves states into <code className="bg-indigo-100/60 px-1 rounded font-mono">localStorage</code> for immediate zero-config persistence. When you transition to SQLite or an API, you only have to rewrite the getter/setter functions in that single file — all component logic will remain 100% untouched!
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="font-sans font-semibold text-slate-900 flex items-center space-x-2">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          <span>Recommended Technical Stack Summary</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider">
                <th className="py-2.5">Platform</th>
                <th className="py-2.5">Language</th>
                <th className="py-2.5">Database</th>
                <th className="py-2.5">Wrapper Tool</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-3 font-semibold text-slate-900">Desktop App</td>
                <td className="py-3">TypeScript / React</td>
                <td className="py-3 font-mono">SQLite (better-sqlite3)</td>
                <td className="py-3 font-mono text-indigo-600">Electron</td>
              </tr>
              <tr>
                <td className="py-3 font-semibold text-slate-900">Mobile Tablet App</td>
                <td className="py-3">TypeScript / React</td>
                <td className="py-3 font-mono">Capacitor SQLite Plugin</td>
                <td className="py-3 font-mono text-emerald-600">Capacitor</td>
              </tr>
              <tr>
                <td className="py-3 font-semibold text-slate-900">Cloud Multi-device</td>
                <td className="py-3">TypeScript / React</td>
                <td className="py-3 font-mono">Cloud Firestore / Cloud SQL</td>
                <td className="py-3 font-mono text-indigo-600">Web / Electron / Capacitor</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

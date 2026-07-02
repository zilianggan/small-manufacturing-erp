const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `<div className="flex items-center space-x-4">
            <button
              onClick={() => setDarkMode(!darkMode)}`;
              
const replacement = `<div className="flex items-center space-x-4">
            {/* Supabase Sync Indicator */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs font-semibold text-emerald-700 shadow-sm">
              <Database className="w-3.5 h-3.5 text-emerald-500" />
              <span>{isSyncing ? 'Syncing...' : 'Supabase Connected'}</span>
            </div>
            
            <button
              onClick={() => setDarkMode(!darkMode)}`;

content = content.replace(target, replacement);
fs.writeFileSync('src/App.tsx', content);
console.log("Updated App.tsx header");

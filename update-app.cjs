const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// Add imports
if (!content.includes('loadInitialDataFromSupabase')) {
   content = content.replace(/import \{ getCompanyProfile, saveCompanyProfile \} from '\.\/services\/db';/, "import { getCompanyProfile, saveCompanyProfile, loadInitialDataFromSupabase, useSyncStore } from './services/db';");
}

// Add state and useEffect for loading
if (!content.includes('isAppLoaded')) {
   const stateToAdd = `
  const [isAppLoaded, setIsAppLoaded] = useState(false);
  const isSyncing = useSyncStore((state: any) => state.isSyncing);
  
  useEffect(() => {
    loadInitialDataFromSupabase().then(() => {
       setIsAppLoaded(true);
       setRefreshKey(prev => prev + 1);
       setCompanyProfile(getCompanyProfile());
    });
  }, []);
`;
   content = content.replace(/const \[activeTab, setActiveTab\] = useState<TabType>\('DASHBOARD'\);/, "const [activeTab, setActiveTab] = useState<TabType>('DASHBOARD');" + stateToAdd);
}

// Add Loading overlay
if (!content.includes('Initializing Supabase')) {
   const returnOverlay = `
  if (!isAppLoaded) {
     return <div className="min-h-screen bg-slate-50 flex items-center justify-center flex-col space-y-4">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-600 font-medium">Initializing Supabase PostgreSQL...</p>
     </div>;
  }
`;
   content = content.replace(/return \(\s*<div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans">/, returnOverlay + '\n  return (\n    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans">');
}

// Add Sync status indicator to top bar
if (!content.includes('Supabase Sync')) {
   const headerTarget = `<div className="flex-1 flex justify-between items-center bg-white border-b border-slate-200 p-4 sticky top-0 z-20">`;
   const headerReplacement = `<div className="flex-1 flex justify-between items-center bg-white border-b border-slate-200 p-4 sticky top-0 z-20">
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-bold text-slate-800 tracking-tight hidden sm:block">
              {activeTab.replace('_', ' ')}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            {/* Supabase Sync Indicator */}
            <div className="flex items-center space-x-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] font-medium text-slate-500">
              <Database className="w-3 h-3 text-emerald-500" />
              <span>{isSyncing ? 'Syncing...' : 'Supabase Connected'}</span>
            </div>
`;
   content = content.replace(/<div className="flex-1 flex justify-between items-center bg-white border-b border-slate-200 p-4 sticky top-0 z-20">[\s\S]*?<div className="flex items-center space-x-2">/, headerReplacement);
}

fs.writeFileSync('src/App.tsx', content);
console.log("Updated App.tsx");

const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// Remove the injected block
const injectedBlock = `
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
content = content.replace(injectedBlock, '');

// Insert it AFTER refreshKey definition
const insertPoint = `  const [refreshKey, setRefreshKey] = useState(0);`;
content = content.replace(insertPoint, insertPoint + injectedBlock);

fs.writeFileSync('src/App.tsx', content);
console.log("Fixed App.tsx order");

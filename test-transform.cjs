const fs = require('fs');

function transformFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  
  const stateRegex = /const\s+\[(\w+),\s*(set\w+)\]\s*=\s*useState(?:<[^>]+>)?\(\s*\(\)\s*=>\s*(get\w+)\(\)\s*\);/g;
  
  let newContent = content;
  let matches = [];
  let match;
  while ((match = stateRegex.exec(content)) !== null) {
    matches.push(match);
  }
  
  if (matches.length > 0) {
    if (!newContent.includes('useEffect')) {
       newContent = newContent.replace(/import React, \{([^}]+)\}/, 'import React, { $1, useEffect }');
    }
    
    newContent = newContent.replace(stateRegex, (full, stateVar, setter, getter) => {
      let typeMatch = full.match(/useState(<[^>]+>)/);
      let typeStr = typeMatch ? typeMatch[1] : '';
      let defaultVal = '[]';
      if (getter === 'getDashboardStats' || getter === 'getCompanyProfile') {
         defaultVal = 'null as any';
      }
      return `const [${stateVar}, ${setter}] = useState${typeStr}(${defaultVal});\n  useEffect(() => {\n    ${getter}().then(${setter});\n  }, []);`;
    });
  }
  
  fs.writeFileSync(path + '.out', newContent);
  console.log(`Transformed ${path}, matches: ${matches.length}`);
}

transformFile('src/components/ReportsView.tsx');

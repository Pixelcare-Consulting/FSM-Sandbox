const fs = require('fs');
const path = require('path');

// Resolve bootstrap/scss without glob (glob is a devDependency and may be skipped on Vercel when NODE_ENV=production).
const findBootstrapScss = () => {
  const candidates = [
    path.join(__dirname, '../node_modules/bootstrap/scss'),
  ];

  try {
    const bootstrapPkg = require.resolve('bootstrap/package.json');
    candidates.push(path.join(path.dirname(bootstrapPkg), 'scss'));
  } catch {
    // bootstrap not installed yet
  }

  for (const testPath of candidates) {
    if (fs.existsSync(testPath)) {
      return testPath;
    }
  }
  return null;
};

const bootstrapScssDir = findBootstrapScss();

if (!bootstrapScssDir) {
  console.log('Bootstrap scss directory not found, skipping patch');
  process.exit(0);
}

// Patch _variables.scss
const variablesPath = path.join(bootstrapScssDir, '_variables.scss');
if (fs.existsSync(variablesPath)) {
  try {
    let content = fs.readFileSync(variablesPath, 'utf8');
    
    // Check if already patched
    if (!content.includes('// Commented out to fix Turbopack build issue')) {
      // Patch the problematic import
      content = content.replace(
        /@import "variables-dark"; \/\/ TODO: can be removed safely in v6, only here to avoid breaking changes in v5\.3/,
        '// @import "variables-dark"; // TODO: can be removed safely in v6, only here to avoid breaking changes in v5.3\n// Commented out to fix Turbopack build issue - variables-dark is imported separately in theme files'
      );
      
      fs.writeFileSync(variablesPath, content, 'utf8');
      console.log('Successfully patched Bootstrap _variables.scss');
    } else {
      console.log('Bootstrap _variables.scss already patched');
    }
  } catch (error) {
    console.error('Error patching Bootstrap _variables.scss:', error);
  }
}

// Patch all Bootstrap SCSS files with relative imports
const patchBootstrapFile = (filePath, fileName) => {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    const originalContent = content;
    
    // Patch all relative imports
    // Match: @import "something" or @import "dir/file"
    const relativeImportPattern = /@import\s+["']([^"']+)["'];?/g;
    
    content = content.replace(relativeImportPattern, (match, importPath) => {
      // Skip if already using ~bootstrap or absolute path
      if (match.includes('~bootstrap') || match.includes('// Patched')) {
        return match;
      }
      // Skip if it's a relative path like ../ or ./
      if (importPath.startsWith('.') || importPath.startsWith('/')) {
        return match;
      }
      // Skip if it's an external package (starts with ~)
      if (importPath.startsWith('~')) {
        return match;
      }
      modified = true;
      // Handle both "file" and "dir/file" patterns
      const fullPath = importPath.includes('/') 
        ? `~bootstrap/scss/${importPath}`
        : `~bootstrap/scss/${importPath}`;
      return `@import "${fullPath}"; // Patched for Turbopack`;
    });
    
    if (modified && content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Successfully patched Bootstrap ${fileName}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error patching Bootstrap ${fileName}:`, error);
    return false;
  }
};

// Patch all Bootstrap SCSS files that might have relative imports
const filesToPatch = [
  '_mixins.scss',
  'bootstrap.scss',
  'bootstrap-grid.scss',
  'bootstrap-reboot.scss',
  'bootstrap-utilities.scss',
  '_helpers.scss',
  '_forms.scss',
];

let patchedCount = 0;
for (const fileName of filesToPatch) {
  const filePath = path.join(bootstrapScssDir, fileName);
  if (patchBootstrapFile(filePath, fileName)) {
    patchedCount++;
  }
}

if (patchedCount === 0) {
  console.log('All Bootstrap SCSS files already patched');
}


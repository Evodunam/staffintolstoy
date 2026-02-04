# Fix React Hooks Error

## Issue
"Invalid hook call" and "Cannot read properties of null (reading 'useMemo')" errors in the browser console.

## Solution

The issue is caused by multiple React instances or Vite cache issues. Follow these steps:

### 1. Clear Vite Cache
```bash
# Delete Vite cache
rm -rf node_modules/.vite
# On Windows PowerShell:
Remove-Item -Recurse -Force node_modules\.vite
```

### 2. Clear Node Modules Cache (if needed)
```bash
# Delete node_modules and reinstall
rm -rf node_modules
npm install
```

### 3. Restart Dev Server
```bash
# Stop the current server (Ctrl+C)
# Then restart
npm run dev
```

### 4. Hard Refresh Browser
- Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Or open DevTools and right-click the refresh button > "Empty Cache and Hard Reload"

## What Was Fixed

1. **Vite Config**: Added React deduplication in `vite.config.ts`:
   - Added `dedupe: ["react", "react-dom"]` to resolve
   - Added explicit React aliases
   - Added `optimizeDeps.include` for React

2. **HMR Configuration**: Updated `server/vite.ts` to use correct port for HMR

3. **React Plugin**: Configured React plugin with proper settings

## If Error Persists

1. Check for multiple React versions:
   ```bash
   npm list react react-dom
   ```

2. Ensure all packages use the same React version:
   ```bash
   npm dedupe
   ```

3. Check `package-lock.json` for duplicate React entries

4. Try removing `node_modules/.vite` and restarting

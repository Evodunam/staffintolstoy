# Restart Instructions - Fix "Outdated Optimize Dep" Error

## Issue
"Outdated Optimize Dep" errors occur when Vite's dependency cache is out of sync after clearing the cache.

## Solution

### Step 1: Restart the Dev Server
The server has been stopped. Restart it with:
```bash
npm run dev
```

**Important**: The first startup after clearing cache will take longer as Vite re-optimizes all dependencies. Wait for the message:
```
[vite] Optimizing dependencies...
[vite] Dependencies optimized
```

### Step 2: Hard Refresh Browser
After the server starts:
1. Open `http://localhost:2000`
2. Press `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac) to hard refresh
3. Or open DevTools → right-click refresh → "Empty Cache and Hard Reload"

### Step 3: Verify
- The "Outdated Optimize Dep" errors should be gone
- HMR WebSocket should connect to `localhost:2000/vite-hmr`
- No React hooks errors

## If Errors Persist

### Option 1: Force Re-optimization
Temporarily set `force: true` in `vite.config.ts`:
```typescript
optimizeDeps: {
  include: ["react", "react-dom"],
  exclude: [],
  force: true, // Force re-optimization
},
```
Then restart the server. After it works, set it back to `false`.

### Option 2: Clear Everything
```bash
# Stop server first (Ctrl+C)

# Clear Vite cache
Remove-Item -Recurse -Force node_modules\.vite

# Clear node_modules (optional, takes longer)
# Remove-Item -Recurse -Force node_modules
# npm install

# Restart
npm run dev
```

## What Was Fixed

1. ✅ **HMR Configuration**: Added `path: "/vite-hmr"` to server config
2. ✅ **React Deduplication**: Configured in `vite.config.ts`
3. ✅ **Vite Cache**: Cleared (needs server restart to re-optimize)

## Expected Behavior After Restart

- Server starts on port 2000
- Vite optimizes dependencies (first time takes 30-60 seconds)
- Browser connects to HMR on `ws://localhost:2000/vite-hmr`
- No "Outdated Optimize Dep" errors
- No React hooks errors

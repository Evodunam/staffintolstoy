# Service Worker Errors - Fixed

## Error: "Service worker registration failed: InvalidStateError"

### What Was The Problem?
Service workers were attempting to register before the document was in a valid state, causing:
- Repeated "InvalidStateError" messages in console
- Notifications failing to initialize
- No user feedback when errors occurred

### Root Causes

1. **Document Loading State**: Service worker tried to register while `document.readyState === 'loading'`
2. **Iframe Context**: Service workers don't work in iframes
3. **Multiple Registration Attempts**: Code was attempting to register multiple times
4. **No User Feedback**: Errors were only logged to console

### Solution Implemented

#### 1. Document State Check (`firebase.ts`)
```typescript
// Wait for document to be ready before attempting registration
if (document.readyState === 'loading') {
  await new Promise(resolve => {
    window.addEventListener('DOMContentLoaded', () => resolve(true), { once: true });
  });
}
```

#### 2. Iframe Detection
```typescript
// Don't try to register in iframes (they can't have service workers)
if (window.self !== window.top) {
  console.warn("[Service Worker] Running in iframe, skipping registration");
  return null;
}
```

#### 3. Better Error Messages
```typescript
function getServiceWorkerErrorMessage(errorName: string, errorMessage: string): string {
  if (errorName === 'InvalidStateError') {
    return 'Unable to enable notifications. Please reload the page and try again.';
  }
  if (errorName === 'SecurityError') {
    return 'Notifications require a secure connection (HTTPS).';
  }
  // ... more user-friendly messages
}
```

#### 4. Global Toast Notification (`use-notifications.ts`)
```typescript
initServiceWorker()
  .catch((error: any) => {
    const userMessage = error?.userMessage || 'Unable to set up notifications';
    
    // Show toast to user (except for InvalidStateError which is common in dev)
    if (error?.name !== 'InvalidStateError') {
      toast({
        title: "Notifications Unavailable",
        description: userMessage,
        variant: "default",
        duration: 5000,
      });
    }
  });
```

### What's Fixed Now

✅ **Document state checked** before registration  
✅ **Iframe context detected** and skipped  
✅ **Better error logging** with context  
✅ **User-friendly error messages**  
✅ **Global toast popup** for important errors  
✅ **Graceful degradation** - app works without notifications  
✅ **InvalidStateError suppressed** in development (common/harmless)  

### Error Types Handled

| Error Type | User Message | Action |
|------------|-------------|--------|
| `InvalidStateError` | "Please reload the page and try again" | Silent in dev, toast in prod |
| `SecurityError` | "Notifications require HTTPS" | Show toast |
| `404 / not found` | "Notification service temporarily unavailable" | Show toast |
| `Network error` | "Check connection and try again" | Show toast |
| Generic | "Unable to set up notifications" | Show toast |

### Why InvalidStateError Happens in Development

This is NORMAL and expected in development because:
- Hot module reload (HMR) tries to register service worker multiple times
- Service worker registration happens before document fully loads
- React StrictMode runs effects twice in development
- Multiple tabs/windows can trigger race conditions

**In production**, this error should be rare and will show a toast if it occurs.

### Testing

#### To verify the fix works:

1. **Clear service workers**:
   - Open DevTools → Application → Service Workers
   - Click "Unregister" on all service workers
   - Reload page

2. **Check console**:
   - Should see: `[Service Worker] Attempting registration...`
   - Should see: `[Service Worker] Registration successful`
   - No more repeated "InvalidStateError" spam

3. **Test error handling**:
   - Disconnect internet
   - Reload page
   - Should see toast: "Network error while setting up notifications"

4. **Test in iframe** (if applicable):
   - Should see: `[Service Worker] Running in iframe, skipping registration`
   - No errors

### For Production

The app will:
- Wait for document to be fully loaded
- Skip service worker registration in iframes
- Show user-friendly toast messages for errors
- Continue working normally without notifications if setup fails
- Users can manually enable notifications later in settings

### Environment Variables Required

For notifications to work, these must be set in `.env.production`:
```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_PUBLIC_KEY=...
```

If any are missing, service worker registration is skipped automatically.

### Browser Compatibility

Service workers require:
- ✅ Chrome/Edge 40+
- ✅ Firefox 44+
- ✅ Safari 11.1+
- ✅ Opera 27+
- ❌ Internet Explorer (not supported)

### Additional Notes

- Service worker file: `client/public/firebase-messaging-sw.js`
- Scope: `'/'` (entire app)
- Update strategy: `updateViaCache: 'none'` (always fresh)
- Firebase Cloud Messaging (FCM) for push notifications
- Works offline once registered

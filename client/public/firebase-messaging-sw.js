importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

const ALLOWED_PATH_PREFIXES = [
  '/dashboard',
  '/company-dashboard',
  '/accepted-job',
  '/worker',
  '/company',
  '/jobs',
  '/job/',
  '/post-job',
  '/chats',
  '/'
];

function isValidAppUrl(url) {
  if (!url) return false;
  
  try {
    let pathname;
    
    if (url.startsWith('/')) {
      pathname = url.split('?')[0];
    } else {
      const parsedUrl = new URL(url, self.location.origin);
      if (parsedUrl.origin !== self.location.origin) {
        return false;
      }
      pathname = parsedUrl.pathname;
    }
    
    if (pathname === '/') return true;
    
    return ALLOWED_PATH_PREFIXES.some(prefix => 
      prefix !== '/' && pathname.startsWith(prefix)
    );
  } catch (e) {
    console.error('[firebase-messaging-sw.js] URL validation error:', e);
    return false;
  }
}

function getSafeUrl(url) {
  if (!url) return '/dashboard';
  
  try {
    if (isValidAppUrl(url)) {
      if (url.startsWith('/')) {
        return url;
      }
      const parsedUrl = new URL(url, self.location.origin);
      return parsedUrl.pathname + parsedUrl.search;
    }
  } catch (e) {
    console.error('[firebase-messaging-sw.js] getSafeUrl error:', e);
  }
  
  return '/dashboard';
}

// Initialize Firebase messaging variable
let messaging = null;
let firebaseInitialized = false;

// Register push event handler at top level (required for service worker)
self.addEventListener('push', (event) => {
  console.log('[firebase-messaging-sw.js] Push event received:', event);
  
  if (!firebaseInitialized || !messaging) {
    console.warn('[firebase-messaging-sw.js] Firebase not initialized yet, ignoring push event');
    return;
  }
  
  // Firebase messaging will handle the push event through onBackgroundMessage
  // This handler is registered to satisfy the service worker requirement
});

// Register pushsubscriptionchange event handler at top level (required for service worker)
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[firebase-messaging-sw.js] Push subscription change:', event);
  
  if (!firebaseInitialized || !messaging) {
    console.warn('[firebase-messaging-sw.js] Firebase not initialized yet, ignoring subscription change');
    return;
  }
  
  // Firebase messaging will handle subscription changes automatically
  // This handler is registered to satisfy the service worker requirement
});

// Register notificationclick event handler at top level (required for service worker)
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification click:', event);
  
  event.notification.close();
  
  if (event.action === 'dismiss') {
    return;
  }
  
  const rawUrl = event.notification.data?.url || event.notification.data?.path || '/dashboard';
  const safeUrl = getSafeUrl(rawUrl);
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: safeUrl
          });
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(safeUrl);
      }
    })
  );
});

// Handle messages from the main thread to initialize Firebase
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    const config = event.data.config;
    if (config && config.apiKey && config.projectId) {
      try {
        if (!firebaseInitialized && !firebase.apps.length) {
          firebase.initializeApp(config);
          firebaseInitialized = true;
          
          messaging = firebase.messaging();
          
          messaging.onBackgroundMessage((payload) => {
            console.log('[firebase-messaging-sw.js] Received background message:', payload);
            
            const notificationTitle = payload.notification?.title || 'Tolstoy Staffing';
            const notificationOptions = {
              body: payload.notification?.body || 'You have a new notification',
              icon: '/favicon.ico',
              badge: '/favicon.ico',
              tag: payload.data?.type || 'notification',
              data: payload.data,
              requireInteraction: true,
              actions: [
                { action: 'open', title: 'View' },
                { action: 'dismiss', title: 'Dismiss' }
              ]
            };
          
            self.registration.showNotification(notificationTitle, notificationOptions);
          });
          
          console.log('[firebase-messaging-sw.js] Firebase messaging initialized');
        }
      } catch (error) {
        console.error('[firebase-messaging-sw.js] Firebase init error:', error);
      }
    }
  }
});

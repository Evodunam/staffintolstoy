import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, getToken, onMessage, type Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const hasFirebaseConfig = firebaseConfig.apiKey && firebaseConfig.projectId;

function getFirebaseApp() {
  if (!hasFirebaseConfig) return null;
  
  try {
    if (getApps().length > 0) {
      return getApp();
    }
    return initializeApp(firebaseConfig);
  } catch (error) {
    console.warn("Firebase initialization failed:", error);
    return null;
  }
}

const firebaseApp = getFirebaseApp();

let messaging: Messaging | null = null;

export function getFirebaseMessaging(): Messaging | null {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }
  
  if (!hasFirebaseConfig || !firebaseApp) {
    return null;
  }
  
  if (!messaging) {
    try {
      messaging = getMessaging(firebaseApp);
    } catch (error) {
      console.error("Failed to initialize Firebase messaging:", error);
      return null;
    }
  }
  
  return messaging;
}

export async function requestNotificationPermission(): Promise<string | null> {
  const fbMessaging = getFirebaseMessaging();
  if (!fbMessaging) {
    console.warn("Firebase messaging not available");
    return null;
  }
  
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.warn("Firebase VAPID key not configured");
    return null;
  }
  
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("Notification permission denied");
      return null;
    }
    
    const token = await getToken(fbMessaging, { vapidKey });
    
    return token;
  } catch (error) {
    console.error("Error getting notification token:", error);
    return null;
  }
}

export function onForegroundMessage(callback: (payload: any) => void): () => void {
  const fbMessaging = getFirebaseMessaging();
  if (!fbMessaging) {
    return () => {};
  }
  
  return onMessage(fbMessaging, (payload) => {
    console.log("Foreground message received:", payload);
    callback(payload);
  });
}

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && 
         "Notification" in window && 
         "serviceWorker" in navigator &&
         hasFirebaseConfig;
}

export function getNotificationPermissionStatus(): NotificationPermission | null {
  if (!isNotificationSupported()) {
    return null;
  }
  return Notification.permission;
}

export function getDeviceInfo(): { deviceType: string; deviceName: string; userAgent: string } {
  const userAgent = navigator.userAgent;
  let deviceType = "web";
  let deviceName = "Unknown Device";
  
  if (/Android/i.test(userAgent)) {
    deviceType = "android";
    deviceName = "Android Browser";
  } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
    deviceType = "ios";
    deviceName = "iOS Browser";
  } else if (/Windows/i.test(userAgent)) {
    deviceName = "Windows Browser";
  } else if (/Mac/i.test(userAgent)) {
    deviceName = "Mac Browser";
  } else if (/Linux/i.test(userAgent)) {
    deviceName = "Linux Browser";
  }
  
  if (/Chrome/i.test(userAgent) && !/Edge/i.test(userAgent)) {
    deviceName = deviceName.replace("Browser", "Chrome");
  } else if (/Firefox/i.test(userAgent)) {
    deviceName = deviceName.replace("Browser", "Firefox");
  } else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) {
    deviceName = deviceName.replace("Browser", "Safari");
  } else if (/Edge/i.test(userAgent)) {
    deviceName = deviceName.replace("Browser", "Edge");
  }
  
  return { deviceType, deviceName, userAgent };
}

export async function initServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!hasFirebaseConfig) return null;
  if (!("serviceWorker" in navigator)) {
    console.warn("[Service Worker] Not supported in this browser");
    return null;
  }
  
  // Check if document is in valid state for service worker registration
  if (document.readyState === 'loading') {
    console.warn("[Service Worker] Document still loading, waiting for DOMContentLoaded");
    await new Promise(resolve => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        resolve(true);
      } else {
        window.addEventListener('DOMContentLoaded', () => resolve(true), { once: true });
      }
    });
  }
  
  // Check if running in an iframe (service workers don't work well in iframes)
  if (window.self !== window.top) {
    console.warn("[Service Worker] Running in iframe, skipping registration");
    return null;
  }
  
  try {
    console.log("[Service Worker] Attempting registration...");
    
    // Check if service worker file exists before registering
    const swPath = "/firebase-messaging-sw.js";
    const swUrl = new URL(swPath, location.origin);
    
    const registration = await navigator.serviceWorker.register(swPath, {
      scope: '/',
      updateViaCache: 'none' // Always fetch latest version
    });
    
    console.log("[Service Worker] Registration successful:", registration.scope);
    
    if (registration.active) {
      registration.active.postMessage({
        type: "FIREBASE_CONFIG",
        config: firebaseConfig
      });
    }
    
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "activated") {
            console.log("[Service Worker] New worker activated");
            newWorker.postMessage({
              type: "FIREBASE_CONFIG",
              config: firebaseConfig
            });
          }
        });
      }
    });
    
    return registration;
  } catch (error: any) {
    // Determine error type for better user feedback
    const errorName = error?.name || 'UnknownError';
    const errorMessage = error?.message || 'Unknown error';
    
    console.error("[Service Worker] Registration failed:", {
      name: errorName,
      message: errorMessage,
      error
    });
    
    // Return error info for caller to handle
    throw {
      name: errorName,
      message: errorMessage,
      userMessage: getServiceWorkerErrorMessage(errorName, errorMessage)
    };
  }
}

function getServiceWorkerErrorMessage(errorName: string, errorMessage: string): string {
  if (errorName === 'InvalidStateError') {
    return 'Unable to enable notifications. Please reload the page and try again.';
  }
  if (errorName === 'SecurityError') {
    return 'Notifications require a secure connection (HTTPS). This feature is unavailable in development mode.';
  }
  if (errorMessage.includes('not found') || errorMessage.includes('404')) {
    return 'Notification service is temporarily unavailable. You can still use the app without notifications.';
  }
  if (errorMessage.includes('network')) {
    return 'Network error while setting up notifications. Please check your connection and try again.';
  }
  return 'Unable to set up notifications. You can still use the app without them.';
}

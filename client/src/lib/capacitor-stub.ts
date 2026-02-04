// Stub module for Capacitor when it's not installed
// This allows Vite to resolve the import without errors
export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
};

export const registerPlugin = () => null;

// Mark that this is a stub so we can detect it
export const __isStub = true;

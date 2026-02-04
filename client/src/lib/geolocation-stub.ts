// Stub module for Capacitor Geolocation when it's not installed
export const Geolocation = {
  checkPermissions: async () => ({ location: 'granted' }),
  requestPermissions: async () => ({ location: 'granted' }),
  getCurrentPosition: async () => null,
  watchPosition: async () => '',
  clearWatch: async () => {},
};

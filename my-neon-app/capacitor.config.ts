import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.tolstoy.staffing',
  appName: 'Tolstoy Staffing',
  webDir: 'dist',
  android: {
    useLegacyBridge: true,
  },
}

export default config

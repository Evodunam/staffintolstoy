import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: process.env.APPLE_BUNDLE_ID || 'com.tolstoy.staffing',
  appName: 'Tolstoy Staffing',
  webDir: 'dist/public',
  server: {
    url: process.env.DEV_SERVER_URL || undefined,
    cleartext: false,
    androidScheme: 'https'
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    BackgroundGeolocation: {
      mode: 'location',
      desiredAccuracy: 10,
      distanceFilter: 10,
      stopOnTerminate: false,
      startOnBoot: true,
      foregroundService: true,
      notificationTitle: 'Tolstoy Staffing',
      notificationText: 'Location tracking active for job site verification'
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#488AFF'
    }
  },
  ios: {
    contentInset: 'always',
    allowsLinkPreview: true,
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: true,
    handleApplicationNotifications: true
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    loggingBehavior: 'production',
    backgroundColor: '#ffffff',
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK'
    }
  }
};

export default config;

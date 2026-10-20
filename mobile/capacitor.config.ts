import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Parley is self-hosted, so the app does not bake a server in: it ships a small connect screen (www/) and then
 * navigates the native WebView to the chosen server, where the normal web client runs with the Capacitor bridge
 * available (push, keep-awake, haptics, status bar, back button). `allowNavigation: ['*']` keeps the bridge
 * injected on whatever server the user picks; the web client only uses it when `Capacitor.isNativePlatform()`.
 */
const config: CapacitorConfig = {
  appId: 'us.vic10.parley',
  appName: 'Parley',
  webDir: 'www',
  server: { allowNavigation: ['*'], androidScheme: 'https' },
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#0b0c10', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#0b0c10' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config

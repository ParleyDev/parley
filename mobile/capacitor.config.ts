import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The app ships a small connect screen (www/) that defaults to the hosted service (app.runparley.com) and also
 * takes any self-hosted address, then navigates the native WebView to the chosen server, where the normal web client runs with the Capacitor bridge
 * available (push, keep-awake, haptics, status bar, back button). `allowNavigation: ['*']` keeps the bridge
 * injected on whatever server the user picks; the web client only uses it when `Capacitor.isNativePlatform()`.
 */
const config: CapacitorConfig = {
  appId: 'com.runparley.app',
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

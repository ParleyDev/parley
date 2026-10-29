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
    // The keyboard shrinks the web view instead of iOS scrolling the whole page up to reveal the text box (the page
    // jumping and the messages ending up behind the keyboard). The web app hides iOS's form accessory bar.
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
  },
}

export default config

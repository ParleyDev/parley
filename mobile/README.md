# Parley for iOS and Android

Native shells built with [Capacitor](https://capacitorjs.com). The app ships a small **connect screen** (`www/index.html`) where the user continues to the hosted service (app.runparley.com) or enters a self-hosted server's address; after a quick `/api/instance` check it navigates the native WebView to that server, so the full Parley web client runs inside the app with the native bridge available. Apart from that hosted default nothing about a server is baked in: one build works for every instance. Addresses typed without a scheme try https first and fall back to plain http (the screen says so; cleartext is allowed in the manifest / ATS for LAN servers). The last server is remembered and reopened on launch; User Settings → Switch server returns to the connect screen.

What the native side adds (all from `frontend/src/lib/native.ts`, no-ops in a browser):

- **Push notifications** for DMs and mentions while you have no socket open (see "Push" below).
- **Keep awake** during voice channels, calls and studio sessions.
- **Hardware back button** (Android): closes modals, returns to the channel list, then exits.
- Status bar styling, haptics, safe areas, microphone/camera permissions for voice, video and studio recording.

## Build

```bash
cd mobile
npm ci
npx cap sync                  # copies www/ and plugin config into android/ and ios/

# Android (needs Java 17 + Android SDK; ANDROID_HOME or android/local.properties)
cd android && ./gradlew assembleDebug           # app/build/outputs/apk/debug/app-debug.apk
cd android && ./gradlew assembleRelease         # sign with your keystore (android/app/build.gradle signingConfigs)

# iOS (macOS + Xcode)
cd ios/App && pod install && open App.xcworkspace   # pick your team, then Run / Archive
```

`.github/workflows/mobile.yml` builds a debug APK and an unsigned iOS simulator build on every change under `mobile/`.

Icons and splash: drop a 1024×1024 `assets/icon.png` and `assets/splash.png` in `mobile/` and run `npx @capacitor/assets generate`.

## Push

The server sends through Firebase Cloud Messaging (HTTP v1). Create a Firebase project, add the Android app (`us.vic10.parley`) and download `google-services.json` into `mobile/android/app/`; add the iOS app, upload your APNs key in Firebase, and put `GoogleService-Info.plist` into `mobile/ios/App/App/` (enable the Push Notifications capability and Background Modes → Remote notifications in Xcode). Then paste the Firebase **service account** JSON (Project settings → Service accounts → Generate new private key) into Admin Console → Instance Settings → Push notifications (no restart needed). The app registers its token after login (`PUT /users/@me/push-tokens`), forgets it on logout, and taps on a notification open the right channel.

## Permissions

Android: `RECORD_AUDIO`, `CAMERA`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `WAKE_LOCK`. iOS: microphone and camera usage strings, background audio and remote notifications (Info.plist).

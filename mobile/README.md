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

Release signing locally: set `PARLEY_KEYSTORE_FILE`, `PARLEY_KEYSTORE_PASSWORD`, `PARLEY_KEY_ALIAS` (and `PARLEY_KEY_PASSWORD` if it differs) before `./gradlew bundleRelease` (needs a full JDK 21).

## Store builds

`.github/workflows/mobile.yml` runs on every published GitHub release (and by hand from Actions → mobile → Run workflow; tick *upload* to send a development build to testers too). With the secrets below it builds signed store builds and sends them to **Play internal testing** and **TestFlight**; promoting a build to production is done by hand in Play Console and App Store Connect. Without them it falls back to a debug APK and an unsigned simulator build.

Android (Play Console app `com.runparley.app`, Play App Signing on, `parley-upload.jks` is the upload key, never committed):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 parley-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias (`keytool -list -keystore parley-upload.jks`) |
| `ANDROID_KEY_PASSWORD` | key password, if different from the keystore's |
| `PLAY_SERVICE_ACCOUNT_JSON` | JSON key of a Google Cloud service account invited in Play Console → Users and permissions with release rights for the app |

Until the app's first release has passed review, Play only accepts draft releases: set the repository **variable** `PLAY_RELEASE_STATUS=draft`, and delete it afterwards. Play also needs each upload's version code to be higher than any before; the workflow derives it from the commit count (`scripts/version.mjs`).

iOS (bundle ID `com.runparley.app`; create the app record in App Store Connect first):

| Secret | Value |
|---|---|
| `APPLE_TEAM_ID` | Team ID (developer.apple.com → Membership) |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API: a team key with the **Admin** role (cloud signing creates the distribution certificate and profile) |
| `ASC_KEY_P8` | `base64 -w0 AuthKey_XXXX.p8` |

Builds appear in TestFlight after Apple's processing (10–30 minutes). The first build also needs the export-compliance answer, which `ITSAppUsesNonExemptEncryption = NO` in Info.plist gives.

Icons and splash: drop a 1024×1024 `assets/icon.png` and `assets/splash.png` in `mobile/` and run `npx @capacitor/assets generate`.

## Push

The server sends through Firebase Cloud Messaging (HTTP v1). Create a Firebase project, add the Android app (`com.runparley.app`) and download `google-services.json` into `mobile/android/app/`; add the iOS app, upload your APNs key in Firebase, and put `GoogleService-Info.plist` into `mobile/ios/App/App/` (enable the Push Notifications capability and Background Modes → Remote notifications in Xcode). Then paste the Firebase **service account** JSON (Project settings → Service accounts → Generate new private key) into Admin Console → Instance Settings → Push notifications (no restart needed). The app registers its token after login (`PUT /users/@me/push-tokens`), forgets it on logout, and taps on a notification open the right channel.

## Permissions

Android: `RECORD_AUDIO`, `CAMERA`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `WAKE_LOCK`. iOS: microphone and camera usage strings, background audio and remote notifications (Info.plist).

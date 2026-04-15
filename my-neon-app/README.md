# Tolstoy Staffing Mobile Build

This app is now configured with Capacitor Android support and a native background location runner for timekeeping.

## What is wired

- Capacitor Android project lives in `android/`
- Background location plugin: `@capacitor-community/background-geolocation`
- Timekeeping runner logic: `src/lib/timekeeping-location.ts`
- Control UI (start/stop/check queue): `src/pages/account.tsx`
- Required Android location + foreground service permissions are declared in `android/app/src/main/AndroidManifest.xml`
- Plugin service is registered by the plugin manifest with `android:foregroundServiceType="location"`

## Verified checklist

- `npm run build` passes (web bundle builds successfully)
- `npm run cap:sync` passes and detects plugin
- `android/app/src/main/assets/capacitor.plugins.json` includes background geolocation classpath
- `android/app/src/main/AndroidManifest.xml` includes:
  - `ACCESS_COARSE_LOCATION`
  - `ACCESS_FINE_LOCATION`
  - `ACCESS_BACKGROUND_LOCATION`
  - `FOREGROUND_SERVICE`
  - `FOREGROUND_SERVICE_LOCATION`
  - `POST_NOTIFICATIONS`
  - `WAKE_LOCK`
- `npx cap doctor` reports Android environment looks good

## Java env fix (required for Gradle build)

If `./gradlew.bat assembleDebug` fails with invalid `JAVA_HOME`, point it to your real JDK path:

```powershell
# Example (update to your installed JDK path)
setx JAVA_HOME "C:\Program Files\Java\jdk-21"
```

Then open a new terminal and re-run:

```bash
cd android
./gradlew.bat assembleDebug
```

## Run locally

```bash
npm install
npm run dev
```

## Build Android App Bundle (`.aab`)

```bash
npm run android:bundle
```

This script does:

1. `npm run build` (Vite production output to `dist/`)
2. `npm run cap:sync` (copies web build into native Android app)
3. `gradlew.bat bundleRelease` (creates Play Store bundle)

Resulting bundle path:

`android/app/build/outputs/bundle/release/app-release.aab`

## Signing setup for Google Play

Before uploading to Play Console, configure release signing in `android/app/build.gradle`:

1. Create/upload key:
   - `keytool -genkey -v -keystore my-release-key.jks -alias tolstoy-staffing -keyalg RSA -keysize 2048 -validity 10000`
2. Put keystore in a safe private location.
3. Add `key.properties` in `android/`:

```properties
storeFile=../my-release-key.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=tolstoy-staffing
keyPassword=YOUR_KEY_PASSWORD
```

4. Reference `key.properties` from `android/app/build.gradle` release config.
5. Re-run `npm run android:bundle`.

## Background location behavior

- Tracking is native-only (`Capacitor` Android build). Browser builds intentionally do not start background tracking.
- The watcher runs with a foreground notification so Android allows location updates while the app is backgrounded.
- Samples are queued to local storage for later sync to your timekeeping backend.

## Important production hardening (next)

- Add backend endpoint to ingest queued location pings and drain the queue after successful upload.
- Start/stop tracking automatically from clock-in/clock-out events (instead of manual button control).
- Add battery optimization guidance screen for Android OEMs that aggressively kill background services.

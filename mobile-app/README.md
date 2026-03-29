# NeuroTrace Mobile

React Native mobile companion app for the `client` web experience.

## What it includes

- Brand/story-driven landing screen based on the web client content
- Mobile dashboard screen that can fetch the cognitive dashboard API
- Offline/sample dashboard data so the app still presents well in demos

## Run

```bash
npm install
npm run start
```

## Android APK

For a local APK build, Android SDK / `adb` / Gradle setup is required on this machine.

Typical path after installing dependencies:

```bash
npx expo prebuild
npx expo run:android
```

Or use EAS for cloud APK builds:

```bash
npx eas build -p android --profile preview
```

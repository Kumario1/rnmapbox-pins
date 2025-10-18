## rnmapbox-pins

Simple Expo app using `@rnmapbox/maps` that lets you tap to add pins.

### Requirements
- Mapbox account with:
  - Public access token (for runtime map access)
  - Secret downloads token (for native SDK downloads)
- Xcode (for iOS) and/or Android SDKs

### Configure tokens
1) Edit `app.json` and set:
   - `expo.extra.MAPBOX_PUBLIC_TOKEN` to your Mapbox public token (starts with `pk.`)

2) For native SDK downloads, prefer the environment variable during prebuild/build:
   - `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` set to your Mapbox secret token (starts with `sk.`)

### Install and prebuild (development build)
```bash
cd rnmapbox-pins
npm install

# Ensure the plugin packages are installed
npm install @rnmapbox/maps expo-dev-client expo-build-properties expo-constants

# Run prebuild with your secret downloads token
RNMAPBOX_MAPS_DOWNLOAD_TOKEN=sk.your_secret_token_here npx expo prebuild --clean

# iOS pods
npx pod-install

# Run on simulator / device
npm run ios   # or: npm run android
```

### Notes
- This does not run in Expo Go because `@rnmapbox/maps` is a native module. You must use a development build (local `expo run:ios|android` or EAS dev build).
- The app reads the public token from `expo.extra.MAPBOX_PUBLIC_TOKEN` and sets it via `MapboxGL.setAccessToken(...)`.
- Tapping the map adds a pin; pins are rendered via a `ShapeSource` + `SymbolLayer` using the built-in `marker-15` sprite.

### EAS (optional)
If you prefer EAS builds, configure an EAS secret named `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` and build with a Development profile.



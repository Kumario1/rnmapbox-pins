## rnmapbox-pins

React Native skate spot mapping app with AI-powered spot analysis using `@rnmapbox/maps`, Supabase, and Google Cloud Vision API.

### Features
- 🗺️ Interactive map with skate spot pins
- 📸 Photo upload for skate spots
- 🤖 AI-powered spot analysis (smoothness, hazards, etc.)
- 👤 Google Sign-In authentication
- 📊 Detailed spot ratings and safety warnings

### Requirements
- Mapbox account with:
  - Public access token (for runtime map access)
  - Secret downloads token (for native SDK downloads)
- Google Cloud account with Vision API enabled
- Supabase project with database and storage configured
- Xcode (for iOS) and/or Android SDKs

### Configure tokens
1) Edit `app.json` and set:
   - `expo.extra.MAPBOX_PUBLIC_TOKEN` to your Mapbox public token (starts with `pk.`)

2) For native SDK downloads, prefer the environment variable during prebuild/build:
   - `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` set to your Mapbox secret token (starts with `sk.`)

### AI Setup (Google Cloud Vision API)
1) Go to [Google Cloud Console](https://console.cloud.google.com/)
2) Create a new project or select an existing one
3) Enable the Vision API:
   - Go to "APIs & Services" > "Library"
   - Search for "Vision API" and enable it
4) Create credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy the API key
5) Configure Supabase Edge Function secrets:
   - Go to your Supabase dashboard
   - Navigate to "Edge Functions" > "Settings"
   - Add these secrets:
     - `GCLOUD_VISION_API_KEY` = Your Google Cloud Vision API key
     - `SUPABASE_SERVICE_ROLE_KEY` = Your Supabase service role key (from Project Settings > API)

### Database Setup (Supabase)
1) Create the required tables by running the migration in `supabase/migrations/20241218000000_create_skate_spot_ratings.sql`
2) Deploy the Edge Function:
   - Go to Supabase dashboard > Edge Functions
   - Create new function named `evaluate-spot`
   - Copy the code from `supabase/functions/evaluate-spot/index.ts`
   - Deploy the function
3) Configure storage bucket:
   - Create a storage bucket named `spot-media`
   - Set appropriate RLS policies for public access

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
- AI analysis is triggered automatically when adding a pin with photos.
- Developer controls are available in development mode for re-evaluating spots.
- The app uses Google Cloud Vision API for AI-powered skate spot analysis including hazard detection, surface quality assessment, and safety warnings.

### EAS (optional)
If you prefer EAS builds, configure an EAS secret named `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` and build with a Development profile.



# Supabase OAuth Setup Guide

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note down your project URL and anon key from the project settings

## 2. Configure Supabase Client

Update the `supabase.js` file with your actual Supabase credentials:

```javascript
const supabaseUrl = 'YOUR_SUPABASE_URL'; // Replace with your project URL
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY'; // Replace with your anon key
```

## 3. Enable OAuth Providers

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to "Credentials" and create OAuth 2.0 Client IDs
5. Add your app's bundle identifier and redirect URIs:
   - For iOS: `com.yourapp://auth/callback`
   - For Android: `com.yourapp://auth/callback`
6. Copy the Client ID and Client Secret
7. In Supabase Dashboard:
   - Go to Authentication > Providers
   - Enable Google provider
   - Add your Google Client ID and Client Secret

### Apple OAuth Setup

1. Go to [Apple Developer Console](https://developer.apple.com/)
2. Create a new App ID with Sign In with Apple capability
3. Create a Service ID for your app
4. Configure the Service ID with your app's bundle identifier
5. Create a private key for Sign In with Apple
6. In Supabase Dashboard:
   - Go to Authentication > Providers
   - Enable Apple provider
   - Add your Apple Client ID, Team ID, and private key

## 4. Configure App Scheme

Update your `app.json` to include the correct scheme:

```json
{
  "expo": {
    "scheme": "com.yourapp", // Replace with your app's bundle identifier
    // ... other config
  }
}
```

## 5. Update Redirect URLs

In your `supabase.js` file, update the redirect URLs to match your app:

```javascript
redirectTo: 'com.yourapp://auth/callback', // Replace with your actual scheme
```

## 6. Test the Implementation

1. Run your app: `npm start`
2. Try signing in with Google or Apple
3. The authentication should redirect to the OAuth provider and back to your app

## Troubleshooting

- Make sure your redirect URLs match exactly in both Supabase and OAuth provider settings
- Check that your app scheme is correctly configured
- Verify that your OAuth provider credentials are correct
- Check the console for any error messages

## Security Notes

- Never commit your actual Supabase credentials to version control
- Use environment variables for production builds
- Consider using Expo's secure store for sensitive data

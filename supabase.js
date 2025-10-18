import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

// Supabase project URL and anon key
const supabaseUrl = 'https://iijsgwiqbemgaugwgrbx.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpanNnd2lxYmVtZ2F1Z3dncmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3OTA0NzAsImV4cCI6MjA3NjM2NjQ3MH0.r5xYYjPzZfCvRtVcLHRUfknuzaey1geTx9vQfGX-_cs';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // Enable URL detection for OAuth
  },
});

// Initialize Google Sign-In
GoogleSignin.configure({
  // iOS Client ID (for native sign-in)
  iosClientId: '709669612971-ljh1fqrqsobrsv5ijtks69ra8p7mcc1l.apps.googleusercontent.com',
  // Web Client ID (for Supabase)
  webClientId: '709669612971-40l3iaj54ljq9hkgpmnd8hgj6clggqdd.apps.googleusercontent.com',
  offlineAccess: true,
  forceCodeForRefreshToken: true,
});

// Auth helper functions
export const signInWithGoogle = async () => {
  try {
    // Check if your device supports Google Play
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    
    // Sign out first to ensure clean state
    await GoogleSignin.signOut();
    
    // Get the users ID token with native UI (no web view)
    const signInResult = await GoogleSignin.signIn();
    console.log('Google Sign-In result:', signInResult);
    
    // The result is nested in a data object
    const { idToken, user, serverAuthCode } = signInResult.data || signInResult;
    
    console.log('Google Sign-In details:', { 
      idToken: idToken ? 'present' : 'missing', 
      user: user?.email,
      tokenLength: idToken?.length,
      serverAuthCode: serverAuthCode ? 'present' : 'missing',
      userInfo: user
    });
    
    if (!idToken) {
      throw new Error('No ID token received from Google Sign-In');
    }
    
    // Try using server auth code first (avoids nonce issues)
    if (serverAuthCode) {
      console.log('Using server auth code for authentication...');
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: serverAuthCode,
      });
      
      if (!error) {
        console.log('Server auth code authentication successful:', data);
        return { data, error: null };
      }
      console.log('Server auth code failed, trying ID token...');
    }
    
    // Fallback to ID token
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    
    if (error) {
      console.error('Supabase auth error:', error);
      throw error;
    }
    
    console.log('Supabase auth successful:', data);
    return { data, error: null };
  } catch (error) {
    console.error('Google sign in error:', error);
    // Make sure to sign out from Google if there's an error
    try {
      await GoogleSignin.signOut();
    } catch (signOutError) {
      console.log('Error signing out from Google:', signOutError);
    }
    return { data: null, error };
  }
};

export const signInWithApple = async () => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: 'com.yourapp://auth/callback', // Replace with your app's scheme
      },
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Apple sign in error:', error);
    return { data: null, error };
  }
};

export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Sign out error:', error);
    return { error };
  }
};

export const getCurrentUser = () => {
  return supabase.auth.getUser();
};

export const getCurrentSession = () => {
  return supabase.auth.getSession();
};

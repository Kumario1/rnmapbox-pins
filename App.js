import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import LoginScreen from './LoginScreen';
import MapScreen from './MapScreen';

const USER_KEY = '@skate_spots_user';

export default function App() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user was previously logged in
    loadUser();
    
    // Listen for authentication state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session?.user?.email);
        if (event === 'SIGNED_IN' && session?.user) {
          const userData = {
            id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0],
            avatar_url: session.user.user_metadata?.avatar_url,
          };
          await handleLoginSuccess(userData);
        }
        // Note: We don't handle SIGNED_OUT here anymore since handleLogout does it directly
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const loadUser = async () => {
    try {
      // First check Supabase session
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.log('Error getting session:', error);
      }
      
      if (session?.user) {
        const userData = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0],
          avatar_url: session.user.user_metadata?.avatar_url,
        };
        setUser(userData);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
      } else {
        // Fallback to AsyncStorage for demo users
        const userData = await AsyncStorage.getItem(USER_KEY);
        if (userData) {
          setUser(JSON.parse(userData));
        }
      }
    } catch (error) {
      console.log('Error loading user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSuccess = async (userData) => {
    try {
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
      setUser(userData);
    } catch (error) {
      console.log('Error saving user:', error);
    }
  };

  const handleLogout = async () => {
    try {
      console.log('Starting logout process...');
      
      // Sign out from Google Sign-In first
      try {
        await GoogleSignin.signOut();
        console.log('Google Sign-In signed out successfully');
      } catch (googleError) {
        console.log('Google Sign-In sign out error:', googleError);
      }
      
      // Sign out from Supabase
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.log('Supabase sign out error:', error);
      }
      
      // Always clear the user state and storage to ensure UI updates
      console.log('Clearing user state...');
      setUser(null);
      await AsyncStorage.removeItem(USER_KEY);
      
      console.log('Logout completed successfully - UI should update now');
    } catch (error) {
      console.log('Error logging out:', error);
      // Ensure UI updates even if there's an error
      setUser(null);
      await AsyncStorage.removeItem(USER_KEY);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1c1c1e" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return <MapScreen user={user} onLogout={handleLogout} />;
}

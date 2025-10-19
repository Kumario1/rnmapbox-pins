import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { signInWithGoogle } from './supabase';

export default function LoginScreen({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  // Dummy credentials for testing
  const DUMMY_EMAIL = 'demo@skate.com';
  const DUMMY_PASSWORD = 'password123';

  const handleLogin = () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    // Dummy validation
    if (email === DUMMY_EMAIL && password === DUMMY_PASSWORD) {
      onLoginSuccess({ email, name: 'Demo User' });
    } else {
      Alert.alert('Error', 'Invalid credentials. Try:\nEmail: demo@skate.com\nPassword: password123');
    }
  };

  const handleSignUp = () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    // For demo purposes, any email/password combo works for sign up
    Alert.alert('Success', 'Account created!', [
      {
        text: 'OK',
        onPress: () => onLoginSuccess({ email, name: email.split('@')[0] }),
      },
    ]);
  };

  const handleOAuthLogin = async (provider) => {
    try {
      let result;
      
      if (provider === 'Google') {
        result = await signInWithGoogle();
      }
      
      if (result.error) {
        Alert.alert('Error', `Failed to sign in with ${provider}: ${result.error.message}`);
        return;
      }
      
      // The authentication will be handled by the auth state listener in App.js
      // This will automatically trigger onLoginSuccess when the user is authenticated
      
    } catch (error) {
      console.error(`${provider} OAuth error:`, error);
      Alert.alert('Error', `An unexpected error occurred during ${provider} sign in`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.logo}>🛹</Text>
              <Text style={styles.title}>Skate Spots</Text>
              <Text style={styles.subtitle}>Discover and share the best spots</Text>
            </View>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#a0a0a0"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />

              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#a0a0a0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
              />

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={isSignUp ? handleSignUp : handleLogin}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>
                  {isSignUp ? 'Sign Up' : 'Log In'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)}>
                <Text style={styles.switchText}>
                  {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.oauthButtons}>
              <TouchableOpacity
                style={styles.oauthButton}
                onPress={() => handleOAuthLogin('Google')}
                activeOpacity={0.8}
              >
                <Text style={styles.oauthIcon}>G</Text>
                <Text style={styles.oauthButtonText}>Continue with Google</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.demoHint}>
              Demo: demo@skate.com / password123
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  content: {
    paddingHorizontal: 32,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 56,
  },
  logo: {
    fontSize: 72,
    marginBottom: 24,
    textShadowColor: 'rgba(255, 255, 255, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 18,
    color: '#a0a0a0',
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 24,
  },
  form: {
    marginBottom: 32,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: 20,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    color: '#ffffff',
    fontWeight: '500',
  },
  primaryButton: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  primaryButtonText: {
    color: '#0a0a0f',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  switchText: {
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 15,
    marginTop: 20,
    fontWeight: '500',
    opacity: 0.8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 32,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  dividerText: {
    marginHorizontal: 20,
    color: '#a0a0a0',
    fontSize: 14,
    fontWeight: '500',
  },
  oauthButtons: {
    gap: 16,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    padding: 20,
  },
  oauthIcon: {
    fontSize: 20,
    marginRight: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  oauthButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  demoHint: {
    textAlign: 'center',
    color: '#a0a0a0',
    fontSize: 13,
    marginTop: 32,
    fontWeight: '400',
    opacity: 0.7,
  },
});


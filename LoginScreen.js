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
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />

              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#999"
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
    backgroundColor: '#fafafa',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 20,
  },
  content: {
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1c1c1e',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  form: {
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  primaryButton: {
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  switchText: {
    textAlign: 'center',
    color: '#007AFF',
    fontSize: 14,
    marginTop: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#999',
    fontSize: 14,
  },
  oauthButtons: {
    gap: 12,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 16,
  },
  oauthIcon: {
    fontSize: 20,
    marginRight: 12,
    fontWeight: '700',
  },
  oauthButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1c1c1e',
  },
  demoHint: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    marginTop: 24,
  },
});


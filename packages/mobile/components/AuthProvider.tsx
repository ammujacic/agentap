/**
 * Auth provider component
 */

import React, { createContext, useContext, useEffect, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuthStore, usePreferencesStore, createApiClient } from '@agentap-dev/shared';
import { API_URL, API_HEADERS } from '../constants/Config';
import { storage } from '../utils/storage';

WebBrowser.maybeCompleteAuthSession();

interface AuthContextType {
  signIn: (provider: 'github' | 'google' | 'apple') => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
  verifyBackupCode: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const router = useRouter();
  const segments = useSegments();
  const api = createApiClient(API_URL, API_HEADERS);

  // Handle deep link auth callback
  useEffect(() => {
    const handleUrl = async (url: string) => {
      const expectedPrefix = Linking.createURL('auth/success');
      if (url.startsWith(expectedPrefix)) {
        // Fetch user info after successful auth
        try {
          const { user } = await api.getMe();
          await storage.setItem('user', JSON.stringify(user));
          useAuthStore.getState().setUser(user);
        } catch (error) {
          console.error('Failed to fetch user:', error);
        }
      }
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    // Check initial URL
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    return () => subscription.remove();
  }, []);

  // Protected route handling
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login if not authenticated
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect to main app if authenticated
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  // Periodic session check — verifies auth token is still valid every 5 minutes.
  // Also checks when the app returns to the foreground.
  const sessionCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const checkSession = async () => {
      try {
        await api.getMe();
      } catch (error: unknown) {
        const status = (error as { status?: number })?.status;
        if (status === 401) {
          // Token is no longer valid — sign out
          await storage.deleteItem('user');
          await storage.deleteItem('token');
          await storage.deleteItem('machines');
          useAuthStore.getState().logout();
          usePreferencesStore.getState().reset();
          router.replace('/(auth)/login');
        }
      }
    };

    // Check every 5 minutes
    sessionCheckRef.current = setInterval(checkSession, 5 * 60 * 1000);

    // Also check when app comes back to foreground
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        checkSession();
      }
    };
    const subscription = AppState.addEventListener('change', handleAppState);

    return () => {
      if (sessionCheckRef.current) clearInterval(sessionCheckRef.current);
      subscription.remove();
    };
  }, [isAuthenticated]);

  const signIn = useCallback(async (provider: 'github' | 'google' | 'apple') => {
    const redirectUrl = Linking.createURL('auth/success');
    const authUrl = api.getAuthUrl(provider, redirectUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

    if (result.type === 'success' && result.url) {
      // The URL listener will handle the callback
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    try {
      const result = await api.signInWithEmail(email, password);
      if (result.twoFactorRedirect) {
        useAuthStore.getState().setTwoFactorPending(true);
        router.push('/(auth)/verify-2fa');
        return;
      }
      await storage.setItem('user', JSON.stringify(result.user));
      if (result.token) await storage.setItem('token', result.token);
      useAuthStore.getState().setUser(result.user ?? null, result.token);
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : 'Invalid email or password');
    }
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string) => {
    try {
      const result = await api.signUpWithEmail(email, password, name);
      await storage.setItem('user', JSON.stringify(result.user));
      if (result.token) await storage.setItem('token', result.token);
      useAuthStore.getState().setUser(result.user, result.token);
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : 'Sign up failed');
    }
  }, []);

  const verifyTotp = useCallback(async (code: string) => {
    try {
      const result = await api.verifyTotp(code);
      if (result.user) {
        await storage.setItem('user', JSON.stringify(result.user));
        if (result.token) await storage.setItem('token', result.token);
        useAuthStore.getState().setUser(result.user, result.token);
      }
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : 'Invalid verification code');
    }
  }, []);

  const verifyBackupCode = useCallback(async (code: string) => {
    try {
      const result = await api.verifyBackupCode(code);
      if (result.user) {
        await storage.setItem('user', JSON.stringify(result.user));
        if (result.token) await storage.setItem('token', result.token);
        useAuthStore.getState().setUser(result.user, result.token);
      }
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : 'Invalid backup code');
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Ignore logout errors
    }

    await storage.deleteItem('user');
    await storage.deleteItem('token');
    await storage.deleteItem('machines');
    useAuthStore.getState().logout();
    usePreferencesStore.getState().reset();
    router.replace('/(auth)/login');
  }, []);

  return (
    <AuthContext.Provider
      value={{ signIn, signInWithEmail, signUpWithEmail, signOut, verifyTotp, verifyBackupCode }}
    >
      {children}
    </AuthContext.Provider>
  );
}

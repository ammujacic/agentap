/**
 * Root layout for the app
 */

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '@agentap-dev/shared';
import { AuthProvider } from '../components/AuthProvider';
import { WebSocketProvider } from '../components/WebSocketProvider';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { Colors } from '../constants/Colors';
import { storage } from '../utils/storage';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      const { setUser, setLoading } = useAuthStore.getState();
      try {
        // Check for stored auth
        const storedUser = await storage.getItem('user');
        const storedToken = await storage.getItem('token');
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
          if (parsed && typeof parsed === 'object' && 'id' in parsed && 'email' in parsed) {
            setUser(parsed, storedToken);
          } else {
            await storage.deleteItem('user');
            await storage.deleteItem('token');
            setLoading(false);
          }
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error loading auth:', error);
        setLoading(false);
      } finally {
        setIsReady(true);
      }
    }

    prepare();
  }, []);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <WebSocketProvider>
        <AppContent />
      </WebSocketProvider>
    </AuthProvider>
  );
}

function AppContent() {
  usePushNotifications();

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerBackTitle: 'Back',
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="scan"
          options={{
            title: 'Link Machine',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="machine/[id]"
          options={{
            title: 'Sessions',
          }}
        />
        <Stack.Screen
          name="session/[id]"
          options={{
            title: 'Session',
            headerBackVisible: false,
          }}
        />
        <Stack.Screen
          name="settings/sessions"
          options={{
            title: 'Active Sessions',
          }}
        />
        <Stack.Screen
          name="settings/two-factor"
          options={{
            title: 'Two-Factor Authentication',
          }}
        />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});

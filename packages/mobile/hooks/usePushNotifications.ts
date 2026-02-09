/**
 * Push notifications hook — registers device and handles incoming notifications
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@agentap-dev/shared';

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushNotifications() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const router = useRouter();
  const notificationResponseRef = useRef<Notifications.Subscription | null>(null);
  const notificationReceivedRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    registerForPushNotifications();

    // Listen for notification taps
    notificationResponseRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.type === 'approval') {
          router.push('/(tabs)/approvals');
        }
      }
    );

    // Listen for received notifications (foreground)
    notificationReceivedRef.current = Notifications.addNotificationReceivedListener(() => {
      // Notification displayed via handler above
    });

    return () => {
      notificationResponseRef.current?.remove();
      notificationReceivedRef.current?.remove();
    };
  }, [isAuthenticated, router]);
}

async function registerForPushNotifications(): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return;
    }

    // Get Expo push token
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn('No EAS project ID found, skipping push registration');
      return;
    }

    const pushToken = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    // Register with API
    const apiUrl = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:8787';

    await fetch(`${apiUrl}/api/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        pushToken: pushToken.data,
        type: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });

    // Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('approval', {
        name: 'Approval Requests',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3B82F6',
      });
    }
  } catch (error) {
    console.error('Push notification registration failed:', error);
  }
}

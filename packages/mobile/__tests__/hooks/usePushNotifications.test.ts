/**
 * Tests for usePushNotifications hook
 */
import { renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { usePushNotifications } from '../../hooks/usePushNotifications';

const { mockAuthStore, mockRouter } = require('../setup');

// Capture module-level setNotificationHandler call before clearAllMocks wipes it.
// The hook module is imported above, which triggers the module-level call.
const setNotificationHandlerWasCalled =
  (Notifications.setNotificationHandler as jest.Mock).mock.calls.length > 0;
const setNotificationHandlerFirstCallArg = (Notifications.setNotificationHandler as jest.Mock).mock
  .calls[0]?.[0];

// ── helpers ──────────────────────────────────────────────────────────

function resetStores() {
  mockAuthStore._state = {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    twoFactorPending: false,
  };
}

function authenticateUser() {
  mockAuthStore._state.isAuthenticated = true;
  mockAuthStore._state.token = 'test-token';
}

// ── setup ────────────────────────────────────────────────────────────

// Keep a reference to the original Platform.OS
const originalPlatformOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  // Reset Platform.OS to default
  Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, writable: true });
  // Reset global.fetch
  global.fetch = jest.fn(() => Promise.resolve({ ok: true } as Response));
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, writable: true });
});

// ── tests ────────────────────────────────────────────────────────────

describe('usePushNotifications', () => {
  describe('module-level setup', () => {
    it('calls setNotificationHandler on module import', () => {
      // setNotificationHandler is called at module level when usePushNotifications.ts
      // is first imported. We captured the call info before beforeEach/clearAllMocks.
      expect(setNotificationHandlerWasCalled).toBe(true);
      expect(setNotificationHandlerFirstCallArg).toEqual({
        handleNotification: expect.any(Function),
      });
    });
  });

  describe('when not authenticated', () => {
    it('does nothing when not authenticated', () => {
      renderHook(() => usePushNotifications());

      expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
      expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    });
  });

  describe('when authenticated', () => {
    it('registers for push notifications', async () => {
      authenticateUser();

      renderHook(() => usePushNotifications());

      // Flush microtasks for async registration
      await new Promise(process.nextTick);

      expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
      expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
        projectId: 'test-project-id',
      });
    });

    it('skips registration when permissions denied', async () => {
      authenticateUser();
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'denied',
      });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'denied',
      });

      renderHook(() => usePushNotifications());
      await new Promise(process.nextTick);

      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('requests permissions if not already granted', async () => {
      authenticateUser();
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'undetermined',
      });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
      });

      renderHook(() => usePushNotifications());
      await new Promise(process.nextTick);

      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
      expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalled();
    });

    it('registers push token with API', async () => {
      authenticateUser();
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });

      renderHook(() => usePushNotifications());
      await new Promise(process.nextTick);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/devices/register',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            pushToken: 'ExponentPushToken[test]',
            type: 'ios',
          }),
        })
      );
    });

    it('sets up Android notification channel on Android', async () => {
      authenticateUser();
      Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });

      renderHook(() => usePushNotifications());
      await new Promise(process.nextTick);

      expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('approval', {
        name: 'Approval Requests',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3B82F6',
      });
    });

    it('does not set up Android channel on iOS', async () => {
      authenticateUser();
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });

      renderHook(() => usePushNotifications());
      await new Promise(process.nextTick);

      expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    });

    it('handles notification tap and navigates to approvals', () => {
      authenticateUser();

      renderHook(() => usePushNotifications());

      // Extract the listener callback
      const responseListenerMock =
        Notifications.addNotificationResponseReceivedListener as jest.Mock;
      expect(responseListenerMock).toHaveBeenCalled();

      const callback = responseListenerMock.mock.calls[0][0];

      // Simulate a notification tap with approval data
      callback({
        notification: {
          request: {
            content: {
              data: { type: 'approval' },
            },
          },
        },
      });

      expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/approvals');
    });

    it('does not navigate for non-approval notification taps', () => {
      authenticateUser();

      renderHook(() => usePushNotifications());

      const responseListenerMock =
        Notifications.addNotificationResponseReceivedListener as jest.Mock;
      const callback = responseListenerMock.mock.calls[0][0];

      // Simulate a notification tap without approval type
      callback({
        notification: {
          request: {
            content: {
              data: { type: 'message' },
            },
          },
        },
      });

      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('cleans up listeners on unmount', () => {
      authenticateUser();

      const responseRemove = jest.fn();
      const receivedRemove = jest.fn();

      (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValueOnce({
        remove: responseRemove,
      });
      (Notifications.addNotificationReceivedListener as jest.Mock).mockReturnValueOnce({
        remove: receivedRemove,
      });

      const { unmount } = renderHook(() => usePushNotifications());

      unmount();

      expect(responseRemove).toHaveBeenCalled();
      expect(receivedRemove).toHaveBeenCalled();
    });

    it('handles registration errors gracefully', async () => {
      authenticateUser();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValueOnce(
        new Error('Permission check failed')
      );

      renderHook(() => usePushNotifications());
      await new Promise(process.nextTick);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Push notification registration failed:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('skips when no project ID is available', async () => {
      authenticateUser();
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Override expo-constants mock for this test
      const Constants = require('expo-constants').default;
      const originalConfig = Constants.expoConfig;
      const originalEasConfig = Constants.easConfig;
      Constants.expoConfig = { extra: { eas: {} } };
      Constants.easConfig = {};

      renderHook(() => usePushNotifications());
      await new Promise(process.nextTick);

      expect(consoleSpy).toHaveBeenCalledWith(
        'No EAS project ID found, skipping push registration'
      );
      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();

      // Restore
      Constants.expoConfig = originalConfig;
      Constants.easConfig = originalEasConfig;
      consoleSpy.mockRestore();
    });
  });
});

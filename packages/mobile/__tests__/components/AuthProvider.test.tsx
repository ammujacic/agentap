/**
 * Tests for AuthProvider and useAuth hook
 */

import React from 'react';
import { Text } from 'react-native';
import { render, renderHook, act, waitFor } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../../components/AuthProvider';
import { mockRouter, mockAuthStore, mockPreferencesStore, mockApiClient } from '../setup';

// Access the mocked modules
const Linking = require('expo-linking');
const WebBrowser = require('expo-web-browser');
const SecureStore = require('expo-secure-store');
const { useSegments } = require('expo-router');

// Helper: wrapper component for renderHook
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

// Helper: consumer component to test useAuth context
function TestConsumer() {
  const auth = useAuth();
  return <Text testID="consumer">{auth ? 'ok' : 'no'}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Reset auth store state with required methods
  mockAuthStore._state = {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    twoFactorPending: false,
    setUser: jest.fn(),
    setTwoFactorPending: jest.fn(),
    logout: jest.fn(),
  };

  // Reset preferences store state
  mockPreferencesStore._state = {
    preferences: {
      autoApproveLow: false,
      autoApproveMedium: false,
      autoApproveHigh: false,
      autoApproveCritical: false,
    },
    isLoaded: false,
    setPreferences: jest.fn(),
    shouldAutoApprove: jest.fn(() => false),
    reset: jest.fn(),
  };

  // Reset segments to empty
  useSegments.mockReturnValue([]);

  // Reset linking mocks
  Linking.getInitialURL.mockResolvedValue(null);
  Linking.addEventListener.mockReturnValue({ remove: jest.fn() });

  // Reset API client mocks to default resolves
  mockApiClient.getMe.mockResolvedValue({
    user: { id: '1', email: 'test@test.com', name: 'Test' },
  });
  mockApiClient.signInWithEmail.mockResolvedValue({
    user: { id: '1', email: 'test@test.com', name: 'Test' },
    token: 'tok',
  });
  mockApiClient.signUpWithEmail.mockResolvedValue({
    user: { id: '1', email: 'test@test.com', name: 'Test' },
    token: 'tok',
  });
  mockApiClient.verifyTotp.mockResolvedValue({
    user: { id: '1', email: 'test@test.com', name: 'Test' },
    token: 'tok',
  });
  mockApiClient.verifyBackupCode.mockResolvedValue({
    user: { id: '1', email: 'test@test.com', name: 'Test' },
    token: 'tok',
  });
  mockApiClient.logout.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── useAuth hook access ──────────────────────────────────────────────

describe('useAuth hook', () => {
  it('throws when used outside AuthProvider', () => {
    // Suppress console.error for the expected error boundary output
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within AuthProvider');
    spy.mockRestore();
  });

  it('returns context inside AuthProvider', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current).toBeDefined();
    expect(result.current.signIn).toBeInstanceOf(Function);
    expect(result.current.signInWithEmail).toBeInstanceOf(Function);
    expect(result.current.signUpWithEmail).toBeInstanceOf(Function);
    expect(result.current.signOut).toBeInstanceOf(Function);
    expect(result.current.verifyTotp).toBeInstanceOf(Function);
    expect(result.current.verifyBackupCode).toBeInstanceOf(Function);
  });
});

// ── AuthProvider rendering ───────────────────────────────────────────

describe('AuthProvider', () => {
  it('renders children', () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(getByTestId('consumer')).toBeTruthy();
  });
});

// ── signInWithEmail ──────────────────────────────────────────────────

describe('signInWithEmail', () => {
  it('calls API and stores user on success', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signInWithEmail('test@test.com', 'password');
    });

    expect(mockApiClient.signInWithEmail).toHaveBeenCalledWith('test@test.com', 'password');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'user',
      JSON.stringify({ id: '1', email: 'test@test.com', name: 'Test' })
    );
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('token', 'tok');
    expect(mockAuthStore._state.setUser).toHaveBeenCalledWith(
      { id: '1', email: 'test@test.com', name: 'Test' },
      'tok'
    );
  });

  it('handles 2FA redirect', async () => {
    mockApiClient.signInWithEmail.mockResolvedValue({
      twoFactorRedirect: true,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signInWithEmail('test@test.com', 'password');
    });

    expect(mockAuthStore._state.setTwoFactorPending).toHaveBeenCalledWith(true);
    expect(mockRouter.push).toHaveBeenCalledWith('/(auth)/verify-2fa');
  });

  it('throws on API error', async () => {
    mockApiClient.signInWithEmail.mockRejectedValue(new Error('Invalid credentials'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signInWithEmail('bad@test.com', 'wrong');
      })
    ).rejects.toThrow('Invalid credentials');
  });

  it('wraps non-Error objects in an Error', async () => {
    mockApiClient.signInWithEmail.mockRejectedValue('string error');

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signInWithEmail('bad@test.com', 'wrong');
      })
    ).rejects.toThrow('Invalid email or password');
  });

  it('does not store token when result.token is undefined', async () => {
    mockApiClient.signInWithEmail.mockResolvedValue({
      user: { id: '1', email: 'test@test.com', name: 'Test' },
      token: undefined,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signInWithEmail('test@test.com', 'password');
    });

    // setItemAsync should be called for 'user' but NOT for 'token'
    const tokenCalls = SecureStore.setItemAsync.mock.calls.filter(
      (c: string[]) => c[0] === 'token'
    );
    expect(tokenCalls).toHaveLength(0);
  });
});

// ── signUpWithEmail ──────────────────────────────────────────────────

describe('signUpWithEmail', () => {
  it('calls API and stores user on success', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signUpWithEmail('new@test.com', 'pass', 'New User');
    });

    expect(mockApiClient.signUpWithEmail).toHaveBeenCalledWith('new@test.com', 'pass', 'New User');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'user',
      JSON.stringify({ id: '1', email: 'test@test.com', name: 'Test' })
    );
    expect(mockAuthStore._state.setUser).toHaveBeenCalledWith(
      { id: '1', email: 'test@test.com', name: 'Test' },
      'tok'
    );
  });

  it('throws on API error', async () => {
    mockApiClient.signUpWithEmail.mockRejectedValue(new Error('Email already exists'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signUpWithEmail('dup@test.com', 'pass', 'Dup');
      })
    ).rejects.toThrow('Email already exists');
  });

  it('wraps non-Error objects in an Error', async () => {
    mockApiClient.signUpWithEmail.mockRejectedValue(42);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signUpWithEmail('dup@test.com', 'pass', 'Dup');
      })
    ).rejects.toThrow('Sign up failed');
  });
});

// ── verifyTotp ───────────────────────────────────────────────────────

describe('verifyTotp', () => {
  it('stores user on success', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.verifyTotp('123456');
    });

    expect(mockApiClient.verifyTotp).toHaveBeenCalledWith('123456');
    expect(mockAuthStore._state.setUser).toHaveBeenCalledWith(
      { id: '1', email: 'test@test.com', name: 'Test' },
      'tok'
    );
  });

  it('does not store user when result.user is falsy', async () => {
    mockApiClient.verifyTotp.mockResolvedValue({});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.verifyTotp('000000');
    });

    expect(mockAuthStore._state.setUser).not.toHaveBeenCalled();
  });

  it('throws on API error', async () => {
    mockApiClient.verifyTotp.mockRejectedValue(new Error('Bad code'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.verifyTotp('000000');
      })
    ).rejects.toThrow('Bad code');
  });

  it('wraps non-Error objects in an Error', async () => {
    mockApiClient.verifyTotp.mockRejectedValue({ detail: 'fail' });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.verifyTotp('000000');
      })
    ).rejects.toThrow('Invalid verification code');
  });
});

// ── verifyBackupCode ─────────────────────────────────────────────────

describe('verifyBackupCode', () => {
  it('stores user on success', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.verifyBackupCode('backup-code');
    });

    expect(mockApiClient.verifyBackupCode).toHaveBeenCalledWith('backup-code');
    expect(mockAuthStore._state.setUser).toHaveBeenCalledWith(
      { id: '1', email: 'test@test.com', name: 'Test' },
      'tok'
    );
  });

  it('throws on API error', async () => {
    mockApiClient.verifyBackupCode.mockRejectedValue(new Error('Invalid backup code'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.verifyBackupCode('bad-code');
      })
    ).rejects.toThrow('Invalid backup code');
  });

  it('wraps non-Error objects in an Error', async () => {
    mockApiClient.verifyBackupCode.mockRejectedValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.verifyBackupCode('bad-code');
      })
    ).rejects.toThrow('Invalid backup code');
  });
});

// ── signOut ──────────────────────────────────────────────────────────

describe('signOut', () => {
  it('clears storage, resets stores, and navigates to login', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockApiClient.logout).toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('user');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('token');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('machines');
    expect(mockAuthStore._state.logout).toHaveBeenCalled();
    expect(mockPreferencesStore._state.reset).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('ignores API logout error and still clears storage', async () => {
    mockApiClient.logout.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signOut();
    });

    // Should still clear everything despite logout error
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('user');
    expect(mockAuthStore._state.logout).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');
  });
});

// ── OAuth signIn ─────────────────────────────────────────────────────

describe('signIn (OAuth)', () => {
  it('opens WebBrowser auth session with correct URL', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signIn('github');
    });

    expect(mockApiClient.getAuthUrl).toHaveBeenCalledWith('github', 'agentap://auth/success');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:8787/auth'),
      'agentap://auth/success'
    );
  });
});

// ── Protected route handling ─────────────────────────────────────────

describe('protected route handling', () => {
  it('redirects unauthenticated user to login', () => {
    mockAuthStore._state.isAuthenticated = false;
    mockAuthStore._state.isLoading = false;
    useSegments.mockReturnValue(['(tabs)']);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('redirects authenticated user from auth group to tabs', () => {
    mockAuthStore._state.isAuthenticated = true;
    mockAuthStore._state.isLoading = false;
    useSegments.mockReturnValue(['(auth)']);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('does not redirect when isLoading is true', () => {
    mockAuthStore._state.isAuthenticated = false;
    mockAuthStore._state.isLoading = true;
    useSegments.mockReturnValue(['(tabs)']);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

// ── Session check ────────────────────────────────────────────────────

describe('periodic session check', () => {
  it('clears storage and redirects on 401 error', async () => {
    mockAuthStore._state.isAuthenticated = true;
    mockAuthStore._state.isLoading = false;
    useSegments.mockReturnValue(['(tabs)']);
    mockApiClient.getMe.mockRejectedValue({ status: 401 });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Advance past the 5-minute interval
    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000);
    });

    await waitFor(() => {
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('user');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('token');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('machines');
      expect(mockAuthStore._state.logout).toHaveBeenCalled();
      expect(mockPreferencesStore._state.reset).toHaveBeenCalled();
    });
  });
});

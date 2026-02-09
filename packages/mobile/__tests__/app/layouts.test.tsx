/**
 * Tests for layout files:
 *   - app/_layout.tsx (RootLayout)
 *   - app/index.tsx (IndexScreen)
 *   - app/(auth)/_layout.tsx (AuthLayout)
 *   - app/(tabs)/_layout.tsx (TabsLayout)
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

const { mockRouter, mockAuthStore, mockSessionsStore } = require('../setup');

// ── Mocks specific to layout tests ──────────────────────────────────

jest.mock('../../components/AuthProvider', () => {
  const React = require('react');
  return {
    useAuth: jest.fn(() => ({ signOut: jest.fn() })),
    AuthProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement('View', { testID: 'auth-provider' }, children),
  };
});

jest.mock('../../components/WebSocketProvider', () => {
  const React = require('react');
  return {
    useWebSocketContext: jest.fn(() => ({
      subscribeToSession: jest.fn(),
      sendMessage: jest.fn(),
      approveToolCall: jest.fn(),
      denyToolCall: jest.fn(),
      cancelSession: jest.fn(),
      refreshAll: jest.fn(),
    })),
    WebSocketProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement('View', { testID: 'ws-provider' }, children),
  };
});

jest.mock('../../hooks/usePushNotifications', () => ({
  usePushNotifications: jest.fn(),
}));

jest.mock('../../components/icons/AgentapLogo', () => {
  const React = require('react');
  return {
    AgentapLogo: (props: any) => React.createElement('View', { ...props, testID: 'agentap-logo' }),
  };
});

jest.mock('../../utils/storage', () => ({
  storage: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    deleteItem: jest.fn(() => Promise.resolve()),
  },
}));

import { storage } from '../../utils/storage';
import RootLayout from '../../app/_layout';
import IndexScreen from '../../app/index';
import AuthLayout from '../../app/(auth)/_layout';
import TabsLayout from '../../app/(tabs)/_layout';

// =====================================================================
// app/_layout.tsx — RootLayout
// =====================================================================

describe('RootLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset auth store
    mockAuthStore._state = {
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      twoFactorPending: false,
    };
    mockAuthStore._state.setUser = jest.fn();
    mockAuthStore._state.setLoading = jest.fn();
    mockAuthStore._state.logout = jest.fn();

    (storage.getItem as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows a loading indicator while preparing auth', () => {
    // Storage never resolves → isReady stays false
    (storage.getItem as jest.Mock).mockImplementation(() => new Promise(() => {}));

    const { getByTestId } = render(<RootLayout />);
    expect(() => getByTestId('auth-provider')).toThrow();
  });

  it('renders providers after ready', async () => {
    (storage.getItem as jest.Mock).mockResolvedValue(null);

    const result = render(<RootLayout />);
    await act(async () => {
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(result.getByTestId('auth-provider')).toBeTruthy();
    expect(result.getByTestId('ws-provider')).toBeTruthy();
  });

  it('restores user from storage when valid JSON is stored', async () => {
    const storedUser = { id: '1', email: 'test@example.com', name: 'Test' };
    (storage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'user') return JSON.stringify(storedUser);
      if (key === 'token') return 'stored-token';
      return null;
    });

    render(<RootLayout />);
    await act(async () => {
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(mockAuthStore._state.setUser).toHaveBeenCalledWith(storedUser, 'stored-token');
  });

  it('clears invalid stored user data', async () => {
    (storage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'user') return JSON.stringify('not-an-object');
      return null;
    });

    render(<RootLayout />);
    await act(async () => {
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(storage.deleteItem).toHaveBeenCalledWith('user');
    expect(storage.deleteItem).toHaveBeenCalledWith('token');
    expect(mockAuthStore._state.setLoading).toHaveBeenCalledWith(false);
  });

  it('calls setLoading(false) when no stored user exists', async () => {
    (storage.getItem as jest.Mock).mockResolvedValue(null);

    render(<RootLayout />);
    await act(async () => {
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(mockAuthStore._state.setLoading).toHaveBeenCalledWith(false);
  });

  it('handles storage errors gracefully', async () => {
    (storage.getItem as jest.Mock).mockRejectedValue(new Error('Storage error'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    render(<RootLayout />);
    await act(async () => {
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(mockAuthStore._state.setLoading).toHaveBeenCalledWith(false);
    consoleSpy.mockRestore();
  });
});

// =====================================================================
// app/index.tsx — IndexScreen
// =====================================================================

describe('IndexScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockAuthStore._state = {
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      twoFactorPending: false,
    };
  });

  it('renders without crashing', () => {
    expect(() => render(<IndexScreen />)).not.toThrow();
  });

  it('redirects to /(tabs) when authenticated', () => {
    mockAuthStore._state.isAuthenticated = true;
    mockAuthStore._state.isLoading = false;

    render(<IndexScreen />);

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('redirects to /(auth)/login when not authenticated', () => {
    mockAuthStore._state.isAuthenticated = false;
    mockAuthStore._state.isLoading = false;

    render(<IndexScreen />);

    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('does not redirect while loading', () => {
    mockAuthStore._state.isLoading = true;
    mockAuthStore._state.isAuthenticated = false;

    render(<IndexScreen />);

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

// =====================================================================
// app/(auth)/_layout.tsx — AuthLayout
// =====================================================================

describe('AuthLayout', () => {
  it('renders a Stack component', () => {
    const { getByTestId } = render(<AuthLayout />);
    expect(getByTestId('stack')).toBeTruthy();
  });

  it('renders without crashing', () => {
    expect(() => render(<AuthLayout />)).not.toThrow();
  });
});

// =====================================================================
// app/(tabs)/_layout.tsx — TabsLayout
// =====================================================================

describe('TabsLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockSessionsStore._state = {
      sessions: [],
      pendingApprovals: [],
      setSessionsForMachine: jest.fn(),
      handleACPEvent: jest.fn(),
      completeHistoryLoading: jest.fn(),
      startHistoryLoading: jest.fn(),
    };
  });

  it('renders a Tabs component', () => {
    const { getByTestId } = render(<TabsLayout />);
    expect(getByTestId('tabs')).toBeTruthy();
  });

  it('renders without crashing', () => {
    expect(() => render(<TabsLayout />)).not.toThrow();
  });

  it('renders when there are pending approvals', () => {
    mockSessionsStore._state.pendingApprovals = [{ id: '1' }, { id: '2' }, { id: '3' }];

    expect(() => render(<TabsLayout />)).not.toThrow();
  });

  it('renders when there are zero pending approvals', () => {
    mockSessionsStore._state.pendingApprovals = [];

    expect(() => render(<TabsLayout />)).not.toThrow();
  });
});

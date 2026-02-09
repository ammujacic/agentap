/**
 * Jest setup — centralized mocks for Expo, React Native, and shared modules
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// ── expo-router ─────────────────────────────────────────────────────
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
};

jest.mock('expo-router', () => {
  const React = require('react');
  const StackComponent = ({ children }: any) =>
    React.createElement('View', { testID: 'stack' }, children);
  StackComponent.Screen = ({ name }: any) =>
    React.createElement('View', { testID: `stack-screen-${name}` });
  const TabsComponent = ({ children }: any) =>
    React.createElement('View', { testID: 'tabs' }, children);
  TabsComponent.Screen = ({ name }: any) =>
    React.createElement('View', { testID: `tabs-screen-${name}` });
  return {
    useRouter: () => mockRouter,
    useSegments: jest.fn(() => []),
    useLocalSearchParams: jest.fn(() => ({})),
    useGlobalSearchParams: jest.fn(() => ({})),
    Link: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Stack: StackComponent,
    Tabs: TabsComponent,
    Slot: ({ children }: any) => React.createElement('View', { testID: 'slot' }, children),
  };
});

// ── expo-secure-store ───────────────────────────────────────────────
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// ── expo-notifications ──────────────────────────────────────────────
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  addNotificationReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { HIGH: 4 },
}));

// ── expo-web-browser ────────────────────────────────────────────────
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: 'cancel' })),
  maybeCompleteAuthSession: jest.fn(),
}));

// ── expo-linking ────────────────────────────────────────────────────
jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `agentap://${path}`),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialURL: jest.fn(() => Promise.resolve(null)),
}));

// ── expo-linear-gradient ────────────────────────────────────────────
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) =>
      React.createElement(
        'View',
        { ...props, testID: props.testID || 'linear-gradient' },
        children
      ),
  };
});

// ── expo-constants ──────────────────────────────────────────────────
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        eas: { projectId: 'test-project-id' },
        apiUrl: 'http://localhost:8787',
      },
    },
    easConfig: { projectId: 'test-project-id' },
  },
}));

// ── expo-camera ─────────────────────────────────────────────────────
jest.mock('expo-camera', () => {
  const React = require('react');
  return {
    CameraView: (props: any) => React.createElement('View', { ...props, testID: 'camera-view' }),
    useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn()]),
  };
});

// ── expo-clipboard ──────────────────────────────────────────────────
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

// ── expo-status-bar ─────────────────────────────────────────────────
jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// ── expo-speech ─────────────────────────────────────────────────────
jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn(() => Promise.resolve(false)),
}));

// ── react-native-svg ────────────────────────────────────────────────
jest.mock('react-native-svg', () => {
  const React = require('react');
  const make = (name: string) => (props: any) =>
    React.createElement(
      'View',
      { ...props, testID: props.testID || `svg-${name}` },
      props.children
    );
  return {
    __esModule: true,
    default: make('Svg'),
    Svg: make('Svg'),
    Path: make('Path'),
    Circle: make('Circle'),
    Rect: make('Rect'),
    Defs: make('Defs'),
    LinearGradient: make('LinearGradient'),
    Stop: make('Stop'),
  };
});

// ── react-native-markdown-display ───────────────────────────────────
jest.mock('react-native-markdown-display', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: any) => React.createElement('Text', { testID: 'markdown' }, children),
  };
});

// ── @expo/vector-icons ──────────────────────────────────────────────
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return {
    Ionicons: ({ name, ...props }: any) =>
      React.createElement('Text', { ...props, testID: `icon-${name}` }),
  };
});

// ── @agentap-dev/shared ─────────────────────────────────────────────

const mockAuthStore: any = Object.assign(
  jest.fn((selector?: any) => {
    const state = mockAuthStore._state;
    return selector ? selector(state) : state;
  }),
  {
    _state: {
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      twoFactorPending: false,
    },
    getState: () => mockAuthStore._state,
    setState: (partial: any) => {
      Object.assign(
        mockAuthStore._state,
        typeof partial === 'function' ? partial(mockAuthStore._state) : partial
      );
    },
    subscribe: jest.fn(() => jest.fn()),
  }
);

const mockMachinesStore: any = Object.assign(
  jest.fn((selector?: any) => {
    const state = mockMachinesStore._state;
    return selector ? selector(state) : state;
  }),
  {
    _state: {
      machines: [],
      setMachines: jest.fn(),
      addMachine: jest.fn(),
      removeMachine: jest.fn(),
      updateMachine: jest.fn(),
    },
    getState: () => mockMachinesStore._state,
    setState: (partial: any) => {
      Object.assign(
        mockMachinesStore._state,
        typeof partial === 'function' ? partial(mockMachinesStore._state) : partial
      );
    },
    subscribe: jest.fn(() => jest.fn()),
  }
);

const mockSessionsStore: any = Object.assign(
  jest.fn((selector?: any) => {
    const state = mockSessionsStore._state;
    return selector ? selector(state) : state;
  }),
  {
    _state: {
      sessions: [],
      pendingApprovals: [],
      setSessionsForMachine: jest.fn(),
      handleACPEvent: jest.fn(),
      completeHistoryLoading: jest.fn(),
      startHistoryLoading: jest.fn(),
    },
    getState: () => mockSessionsStore._state,
    setState: (partial: any) => {
      Object.assign(
        mockSessionsStore._state,
        typeof partial === 'function' ? partial(mockSessionsStore._state) : partial
      );
    },
    subscribe: jest.fn(() => jest.fn()),
  }
);

const mockConnectionStore: any = Object.assign(
  jest.fn((selector?: any) => {
    const state = mockConnectionStore._state;
    return selector ? selector(state) : state;
  }),
  {
    _state: {
      status: 'disconnected',
      error: null,
      setStatus: jest.fn(),
      setMachineStatus: jest.fn(),
      setError: jest.fn(),
    },
    getState: () => mockConnectionStore._state,
    setState: (partial: any) => {
      Object.assign(
        mockConnectionStore._state,
        typeof partial === 'function' ? partial(mockConnectionStore._state) : partial
      );
    },
    subscribe: jest.fn(() => jest.fn()),
  }
);

const mockPreferencesStore: any = Object.assign(
  jest.fn((selector?: any) => {
    const state = mockPreferencesStore._state;
    return selector ? selector(state) : state;
  }),
  {
    _state: {
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
    },
    getState: () => mockPreferencesStore._state,
    setState: (partial: any) => {
      Object.assign(
        mockPreferencesStore._state,
        typeof partial === 'function' ? partial(mockPreferencesStore._state) : partial
      );
    },
    subscribe: jest.fn(() => jest.fn()),
  }
);

const mockApiClient = {
  getMe: jest.fn(() =>
    Promise.resolve({ user: { id: '1', email: 'test@test.com', name: 'Test' } })
  ),
  getMachines: jest.fn(() => Promise.resolve({ machines: [] })),
  deleteMachine: jest.fn(() => Promise.resolve()),
  signInWithEmail: jest.fn(() =>
    Promise.resolve({ user: { id: '1', email: 'test@test.com', name: 'Test' }, token: 'tok' })
  ),
  signUpWithEmail: jest.fn(() =>
    Promise.resolve({ user: { id: '1', email: 'test@test.com', name: 'Test' }, token: 'tok' })
  ),
  verifyTotp: jest.fn(() =>
    Promise.resolve({ user: { id: '1', email: 'test@test.com', name: 'Test' }, token: 'tok' })
  ),
  verifyBackupCode: jest.fn(() =>
    Promise.resolve({ user: { id: '1', email: 'test@test.com', name: 'Test' }, token: 'tok' })
  ),
  logout: jest.fn(() => Promise.resolve()),
  getAuthUrl: jest.fn(
    (_provider: string, redirectUrl: string) => `http://localhost:8787/auth?redirect=${redirectUrl}`
  ),
  getPreferences: jest.fn(() =>
    Promise.resolve({
      preferences: {
        autoApproveLow: false,
        autoApproveMedium: false,
        autoApproveHigh: false,
        autoApproveCritical: false,
      },
    })
  ),
  updatePreferences: jest.fn(() => Promise.resolve()),
  linkMachine: jest.fn(() => Promise.resolve()),
  getSessions: jest.fn(() => Promise.resolve({ sessions: [] })),
  deleteAccount: jest.fn(() => Promise.resolve()),
};

const mockWsClient = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  sendMessage: jest.fn(),
  approveToolCall: jest.fn(),
  denyToolCall: jest.fn(),
  terminateSession: jest.fn(),
  getStatus: jest.fn(() => 'connected'),
};

jest.mock('@agentap-dev/shared', () => ({
  useAuthStore: mockAuthStore,
  useMachinesStore: mockMachinesStore,
  useSessionsStore: mockSessionsStore,
  useConnectionStore: mockConnectionStore,
  usePreferencesStore: mockPreferencesStore,
  createApiClient: jest.fn(() => mockApiClient),
  createWebSocketClient: jest.fn(() => mockWsClient),
  stripSystemTags: jest.fn((s: string) => s),
}));

// ── Export mocks for use in test files ──────────────────────────────
export {
  mockRouter,
  mockAuthStore,
  mockMachinesStore,
  mockSessionsStore,
  mockConnectionStore,
  mockPreferencesStore,
  mockApiClient,
  mockWsClient,
};

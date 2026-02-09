/**
 * Tests for useWebSocket hook
 */
import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useWebSocket } from '../../hooks/useWebSocket';

const {
  mockAuthStore,
  mockMachinesStore,
  mockSessionsStore,
  mockConnectionStore,
  mockPreferencesStore,
  mockWsClient,
} = require('../setup');

const { createWebSocketClient } = require('@agentap-dev/shared');

// ── helpers ──────────────────────────────────────────────────────────

/** Reset all mocks and stores to default state between tests. */
function resetStores() {
  mockAuthStore._state = {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    twoFactorPending: false,
  };
  mockMachinesStore._state = {
    machines: [],
    setMachines: jest.fn(),
    addMachine: jest.fn(),
    removeMachine: jest.fn(),
    updateMachine: jest.fn(),
  };
  mockSessionsStore._state = {
    sessions: [],
    pendingApprovals: [],
    setSessionsForMachine: jest.fn(),
    handleACPEvent: jest.fn(),
    completeHistoryLoading: jest.fn(),
    startHistoryLoading: jest.fn(),
  };
  mockConnectionStore._state = {
    status: 'disconnected',
    error: null,
    setStatus: jest.fn(),
    setMachineStatus: jest.fn(),
    setError: jest.fn(),
  };
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
}

function authenticateUser() {
  mockAuthStore._state.isAuthenticated = true;
  mockAuthStore._state.token = 'test-token';
}

function addOnlineMachine(id: string, tunnelUrl: string) {
  mockMachinesStore._state.machines.push({
    id,
    name: `Machine ${id}`,
    isOnline: true,
    tunnelUrl,
  });
}

// ── setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  resetStores();

  // Reset mockWsClient defaults
  mockWsClient.connect.mockReset();
  mockWsClient.disconnect.mockReset();
  mockWsClient.subscribe.mockReset();
  mockWsClient.sendMessage.mockReset();
  mockWsClient.approveToolCall.mockReset();
  mockWsClient.denyToolCall.mockReset();
  mockWsClient.terminateSession.mockReset();
  mockWsClient.getStatus.mockReset().mockReturnValue('connected');

  createWebSocketClient.mockClear().mockReturnValue(mockWsClient);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── connectMachine ───────────────────────────────────────────────────

describe('useWebSocket', () => {
  describe('connectMachine (via connectAll)', () => {
    it('creates a client and calls connect()', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      expect(createWebSocketClient).toHaveBeenCalledWith(
        'ws://m1.example.com',
        'test-token',
        expect.objectContaining({
          onStatusChange: expect.any(Function),
          onSessionsUpdate: expect.any(Function),
          onACPEvent: expect.any(Function),
          onHistoryComplete: expect.any(Function),
          onError: expect.any(Function),
        })
      );
      expect(mockWsClient.connect).toHaveBeenCalled();
    });

    it('skips if the machine is already connected', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      createWebSocketClient.mockClear();
      mockWsClient.connect.mockClear();

      // Connect again - should skip because getStatus() returns 'connected'
      act(() => {
        result.current.connectAll();
      });

      expect(createWebSocketClient).not.toHaveBeenCalled();
      expect(mockWsClient.connect).not.toHaveBeenCalled();
    });

    it('disconnects stale client before reconnecting', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      // Simulate the client being in a non-connected state
      mockWsClient.getStatus.mockReturnValue('disconnected');
      createWebSocketClient.mockClear();
      mockWsClient.disconnect.mockClear();
      mockWsClient.connect.mockClear();

      act(() => {
        result.current.connectAll();
      });

      // Should disconnect the stale client first, then create new one
      expect(mockWsClient.disconnect).toHaveBeenCalled();
      expect(createWebSocketClient).toHaveBeenCalled();
      expect(mockWsClient.connect).toHaveBeenCalled();
    });
  });

  // ── connectAll ──────────────────────────────────────────────────────

  describe('connectAll', () => {
    it('connects to online machines with tunnelUrl', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');
      addOnlineMachine('m2', 'ws://m2.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      expect(createWebSocketClient).toHaveBeenCalledTimes(2);
    });

    it('skips offline machines', () => {
      authenticateUser();
      mockMachinesStore._state.machines.push({
        id: 'offline',
        name: 'Offline Machine',
        isOnline: false,
        tunnelUrl: 'ws://offline.example.com',
      });

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      expect(createWebSocketClient).not.toHaveBeenCalled();
    });

    it('skips machines without tunnelUrl', () => {
      authenticateUser();
      mockMachinesStore._state.machines.push({
        id: 'no-tunnel',
        name: 'No Tunnel',
        isOnline: true,
        tunnelUrl: null,
      });

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      expect(createWebSocketClient).not.toHaveBeenCalled();
    });

    it('disconnects machines no longer connectable', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');
      addOnlineMachine('m2', 'ws://m2.example.com');

      const { result, rerender } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      expect(createWebSocketClient).toHaveBeenCalledTimes(2);

      // Remove m2 from connectable machines (went offline)
      mockMachinesStore._state.machines = [
        { id: 'm1', name: 'Machine m1', isOnline: true, tunnelUrl: 'ws://m1.example.com' },
      ];
      mockWsClient.disconnect.mockClear();

      // Re-render to pick up new machines state, then call connectAll
      rerender({});

      act(() => {
        result.current.connectAll();
      });

      // m2 should have been disconnected
      expect(mockWsClient.disconnect).toHaveBeenCalled();
    });

    it('does nothing when not authenticated', () => {
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      expect(createWebSocketClient).not.toHaveBeenCalled();
    });
  });

  // ── disconnectAll ──────────────────────────────────────────────────

  describe('disconnectAll', () => {
    it('disconnects all clients and sets status to disconnected', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      mockWsClient.disconnect.mockClear();

      act(() => {
        result.current.disconnectAll();
      });

      expect(mockWsClient.disconnect).toHaveBeenCalled();
      expect(mockConnectionStore._state.setStatus).toHaveBeenCalledWith('disconnected');
    });
  });

  // ── getClientForSession ────────────────────────────────────────────

  describe('getClientForSession (via subscribeToSession)', () => {
    it('finds client by machineId from session store', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      mockSessionsStore._state.sessions = [{ id: 'sess-1', machineId: 'm1' }];

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      act(() => {
        result.current.subscribeToSession('sess-1');
      });

      expect(mockSessionsStore._state.startHistoryLoading).toHaveBeenCalledWith('sess-1');
      expect(mockWsClient.subscribe).toHaveBeenCalledWith(['sess-1']);
    });

    it('falls back to first connected client', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      // Session is NOT in the store (no matching machineId)
      mockSessionsStore._state.sessions = [];

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      act(() => {
        result.current.subscribeToSession('unknown-sess');
      });

      // Should still call subscribe on the first connected client
      expect(mockWsClient.subscribe).toHaveBeenCalledWith(['unknown-sess']);
    });

    it('returns null when no clients are connected', () => {
      authenticateUser();
      // No machines connected
      mockSessionsStore._state.sessions = [];

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.subscribeToSession('sess-1');
      });

      // startHistoryLoading is always called, but subscribe should not
      expect(mockSessionsStore._state.startHistoryLoading).toHaveBeenCalledWith('sess-1');
      expect(mockWsClient.subscribe).not.toHaveBeenCalled();
    });
  });

  // ── delegation methods ─────────────────────────────────────────────

  describe('delegation methods', () => {
    beforeEach(() => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');
      mockSessionsStore._state.sessions = [{ id: 'sess-1', machineId: 'm1' }];
    });

    it('sendMessage delegates to client', () => {
      const { result } = renderHook(() => useWebSocket());
      act(() => {
        result.current.connectAll();
      });

      act(() => {
        result.current.sendMessage('sess-1', 'hello');
      });

      expect(mockWsClient.sendMessage).toHaveBeenCalledWith('sess-1', 'hello');
    });

    it('approveToolCall delegates to client', () => {
      const { result } = renderHook(() => useWebSocket());
      act(() => {
        result.current.connectAll();
      });

      act(() => {
        result.current.approveToolCall('sess-1', 'req-1', 'tc-1');
      });

      expect(mockWsClient.approveToolCall).toHaveBeenCalledWith('sess-1', 'req-1', 'tc-1');
    });

    it('denyToolCall delegates to client', () => {
      const { result } = renderHook(() => useWebSocket());
      act(() => {
        result.current.connectAll();
      });

      act(() => {
        result.current.denyToolCall('sess-1', 'req-1', 'tc-1', 'too risky');
      });

      expect(mockWsClient.denyToolCall).toHaveBeenCalledWith(
        'sess-1',
        'req-1',
        'tc-1',
        'too risky'
      );
    });

    it('cancelSession delegates to terminateSession on client', () => {
      const { result } = renderHook(() => useWebSocket());
      act(() => {
        result.current.connectAll();
      });

      act(() => {
        result.current.cancelSession('sess-1');
      });

      expect(mockWsClient.terminateSession).toHaveBeenCalledWith('sess-1');
    });
  });

  // ── auto-approve ───────────────────────────────────────────────────

  describe('auto-approve', () => {
    const approvalEvent = {
      type: 'approval:requested',
      sessionId: 'sess-1',
      requestId: 'req-1',
      toolCallId: 'tc-1',
      riskLevel: 'low',
    };

    it('fires for approval:requested events when shouldAutoApprove returns true', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');
      mockPreferencesStore._state.shouldAutoApprove.mockReturnValue(true);

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      // Extract the callbacks passed to createWebSocketClient
      const [, , callbacks] = createWebSocketClient.mock.calls[0];

      act(() => {
        callbacks.onACPEvent(approvalEvent);
      });

      // Auto-approve fires after 100ms setTimeout
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(mockWsClient.approveToolCall).toHaveBeenCalledWith('sess-1', 'req-1', 'tc-1');
    });

    it('does not fire when shouldAutoApprove returns false', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');
      mockPreferencesStore._state.shouldAutoApprove.mockReturnValue(false);

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      const [, , callbacks] = createWebSocketClient.mock.calls[0];

      act(() => {
        callbacks.onACPEvent(approvalEvent);
      });

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(mockWsClient.approveToolCall).not.toHaveBeenCalled();
    });

    it('does not fire twice for the same toolCallId', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');
      mockPreferencesStore._state.shouldAutoApprove.mockReturnValue(true);

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      const [, , callbacks] = createWebSocketClient.mock.calls[0];

      // Fire event twice with the same toolCallId
      act(() => {
        callbacks.onACPEvent(approvalEvent);
        callbacks.onACPEvent(approvalEvent);
      });

      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Should only be called once
      expect(mockWsClient.approveToolCall).toHaveBeenCalledTimes(1);
    });
  });

  // ── callbacks ──────────────────────────────────────────────────────

  describe('WebSocket callbacks', () => {
    it('onStatusChange calls setMachineStatus', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      const [, , callbacks] = createWebSocketClient.mock.calls[0];

      act(() => {
        callbacks.onStatusChange('connected');
      });

      expect(mockConnectionStore._state.setMachineStatus).toHaveBeenCalledWith('m1', 'connected');
    });

    it('onSessionsUpdate calls setSessionsForMachine', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      const [, , callbacks] = createWebSocketClient.mock.calls[0];
      const sessions = [{ id: 's1' }];

      act(() => {
        callbacks.onSessionsUpdate(sessions);
      });

      expect(mockSessionsStore._state.setSessionsForMachine).toHaveBeenCalledWith('m1', sessions);
    });

    it('onHistoryComplete calls completeHistoryLoading', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      const [, , callbacks] = createWebSocketClient.mock.calls[0];

      act(() => {
        callbacks.onHistoryComplete('sess-1');
      });

      expect(mockSessionsStore._state.completeHistoryLoading).toHaveBeenCalledWith('sess-1');
    });

    it('onError calls setError', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      const [, , callbacks] = createWebSocketClient.mock.calls[0];

      act(() => {
        callbacks.onError('something broke');
      });

      expect(mockConnectionStore._state.setError).toHaveBeenCalledWith('something broke');
    });
  });

  // ── AppState ───────────────────────────────────────────────────────

  describe('AppState handling', () => {
    it('triggers connectAll when app becomes active', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      renderHook(() => useWebSocket());

      // AppState.addEventListener is mocked by jest-expo / RN mock
      // Grab the listener
      const addEventListenerMock = AppState.addEventListener as jest.Mock;
      expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));

      const handler = addEventListenerMock.mock.calls[0][1];

      createWebSocketClient.mockClear();
      mockWsClient.connect.mockClear();

      act(() => {
        handler('active');
      });

      expect(createWebSocketClient).toHaveBeenCalled();
    });
  });

  // ── cleanup ────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('disconnects all on unmount', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result, unmount } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      mockWsClient.disconnect.mockClear();

      unmount();

      expect(mockWsClient.disconnect).toHaveBeenCalled();
    });
  });

  // ── refreshAll ─────────────────────────────────────────────────────

  describe('refreshAll', () => {
    it('disconnects all then reconnects after delay', () => {
      authenticateUser();
      addOnlineMachine('m1', 'ws://m1.example.com');

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connectAll();
      });

      mockWsClient.disconnect.mockClear();
      createWebSocketClient.mockClear();
      mockWsClient.connect.mockClear();

      act(() => {
        result.current.refreshAll();
      });

      // Should disconnect immediately
      expect(mockWsClient.disconnect).toHaveBeenCalled();
      // Should not reconnect yet
      expect(createWebSocketClient).not.toHaveBeenCalled();

      // After 100ms delay
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(createWebSocketClient).toHaveBeenCalled();
      expect(mockWsClient.connect).toHaveBeenCalled();
    });
  });
});

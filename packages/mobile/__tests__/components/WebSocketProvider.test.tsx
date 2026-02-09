/**
 * Tests for WebSocketProvider and useWebSocketContext hook
 */

import React from 'react';
import { Text } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import { WebSocketProvider, useWebSocketContext } from '../../components/WebSocketProvider';
import { mockAuthStore, mockMachinesStore } from '../setup';

// Mock the useWebSocket hook used internally by WebSocketProvider
const mockConnectAll = jest.fn();
const mockDisconnectAll = jest.fn();
const mockRefreshAll = jest.fn();
const mockSubscribeToSession = jest.fn();
const mockSendMessage = jest.fn();
const mockApproveToolCall = jest.fn();
const mockDenyToolCall = jest.fn();
const mockCancelSession = jest.fn();

jest.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connectAll: mockConnectAll,
    disconnectAll: mockDisconnectAll,
    refreshAll: mockRefreshAll,
    subscribeToSession: mockSubscribeToSession,
    sendMessage: mockSendMessage,
    approveToolCall: mockApproveToolCall,
    denyToolCall: mockDenyToolCall,
    cancelSession: mockCancelSession,
  }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WebSocketProvider>{children}</WebSocketProvider>
);

beforeEach(() => {
  jest.clearAllMocks();

  // Reset auth store state
  mockAuthStore._state = {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    twoFactorPending: false,
  };

  // Reset machines store state
  mockMachinesStore._state = {
    machines: [],
    setMachines: jest.fn(),
    addMachine: jest.fn(),
    removeMachine: jest.fn(),
    updateMachine: jest.fn(),
  };
});

// ── useWebSocketContext hook access ──────────────────────────────────

describe('useWebSocketContext hook', () => {
  it('throws when used outside WebSocketProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useWebSocketContext());
    }).toThrow('useWebSocketContext must be used within WebSocketProvider');
    spy.mockRestore();
  });
});

// ── Rendering ────────────────────────────────────────────────────────

describe('WebSocketProvider', () => {
  it('renders children', () => {
    const { getByTestId } = render(
      <WebSocketProvider>
        <Text testID="child">hello</Text>
      </WebSocketProvider>
    );
    expect(getByTestId('child')).toBeTruthy();
  });

  it('provides all context methods', () => {
    const { result } = renderHook(() => useWebSocketContext(), { wrapper });

    expect(typeof result.current.subscribeToSession).toBe('function');
    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.approveToolCall).toBe('function');
    expect(typeof result.current.denyToolCall).toBe('function');
    expect(typeof result.current.cancelSession).toBe('function');
    expect(typeof result.current.refreshAll).toBe('function');
  });
});

// ── Connection behavior ──────────────────────────────────────────────

describe('connection behavior', () => {
  it('calls connectAll when authenticated with connectable machines', () => {
    mockAuthStore._state.isAuthenticated = true;
    mockMachinesStore._state.machines = [
      { id: 'm1', name: 'Dev', isOnline: true, tunnelUrl: 'wss://m1.example.com' },
    ];

    render(
      <WebSocketProvider>
        <Text>test</Text>
      </WebSocketProvider>
    );

    expect(mockConnectAll).toHaveBeenCalled();
  });

  it('calls disconnectAll when not authenticated', () => {
    mockAuthStore._state.isAuthenticated = false;
    mockMachinesStore._state.machines = [
      { id: 'm1', name: 'Dev', isOnline: true, tunnelUrl: 'wss://m1.example.com' },
    ];

    render(
      <WebSocketProvider>
        <Text>test</Text>
      </WebSocketProvider>
    );

    expect(mockDisconnectAll).toHaveBeenCalled();
    expect(mockConnectAll).not.toHaveBeenCalled();
  });

  it('does not call connectAll when no connectable machines exist', () => {
    mockAuthStore._state.isAuthenticated = true;
    mockMachinesStore._state.machines = [
      { id: 'm1', name: 'Dev', isOnline: false, tunnelUrl: null },
    ];

    render(
      <WebSocketProvider>
        <Text>test</Text>
      </WebSocketProvider>
    );

    expect(mockConnectAll).not.toHaveBeenCalled();
  });

  it('does not call connectAll when machines are online but have no tunnelUrl', () => {
    mockAuthStore._state.isAuthenticated = true;
    mockMachinesStore._state.machines = [
      { id: 'm1', name: 'Dev', isOnline: true, tunnelUrl: null },
    ];

    render(
      <WebSocketProvider>
        <Text>test</Text>
      </WebSocketProvider>
    );

    expect(mockConnectAll).not.toHaveBeenCalled();
  });
});

/**
 * WebSocket connection hook — ACP-based, multi-machine
 *
 * Connects to ALL online machines simultaneously so approval requests
 * from any machine arrive in the app.
 */

import { useEffect, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  useConnectionStore,
  useSessionsStore,
  useAuthStore,
  useMachinesStore,
  usePreferencesStore,
  createWebSocketClient,
  type WebSocketClient,
} from '@agentap-dev/shared';

export function useWebSocket() {
  const clientsRef = useRef<Map<string, WebSocketClient>>(new Map());
  const autoApprovedRef = useRef<Set<string>>(new Set());

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);
  const machines = useMachinesStore((s) => s.machines);

  /**
   * Connect to a single machine
   */
  const connectMachine = useCallback(
    (machineId: string, tunnelUrl: string) => {
      if (!isAuthenticated) return;

      // Already connected to this machine
      if (clientsRef.current.has(machineId)) {
        const existing = clientsRef.current.get(machineId)!;
        if (existing.getStatus() === 'connected') return;
        existing.disconnect();
      }

      const { setMachineStatus, setError } = useConnectionStore.getState();
      const { setSessionsForMachine, handleACPEvent, completeHistoryLoading } =
        useSessionsStore.getState();

      const authToken = useAuthStore.getState().token ?? '';
      const client = createWebSocketClient(tunnelUrl, authToken, {
        onStatusChange: (status) => {
          setMachineStatus(machineId, status);
        },
        onSessionsUpdate: (sessions) => {
          setSessionsForMachine(machineId, sessions);
        },
        onACPEvent: (event) => {
          handleACPEvent(event);

          // Auto-approve if the risk level is configured for it
          if (event.type === 'approval:requested') {
            const { shouldAutoApprove } = usePreferencesStore.getState();
            if (
              shouldAutoApprove(event.riskLevel) &&
              !autoApprovedRef.current.has(event.toolCallId)
            ) {
              if (autoApprovedRef.current.size > 1000) autoApprovedRef.current.clear();
              autoApprovedRef.current.add(event.toolCallId);
              setTimeout(() => {
                client.approveToolCall(event.sessionId, event.requestId, event.toolCallId);
              }, 100);
            }
          }
        },
        onHistoryComplete: (sessionId) => {
          completeHistoryLoading(sessionId);
        },
        onError: (error) => {
          setError(error);
        },
      });

      clientsRef.current.set(machineId, client);
      client.connect();
    },
    [isAuthenticated, token]
  );

  /**
   * Disconnect from a single machine
   */
  const disconnectMachine = useCallback((machineId: string) => {
    const client = clientsRef.current.get(machineId);
    if (client) {
      client.disconnect();
      clientsRef.current.delete(machineId);
    }
  }, []);

  /**
   * Connect to all online machines with tunnel URLs
   */
  const connectAll = useCallback(() => {
    if (!isAuthenticated) return;

    const connectableMachines = machines.filter((m) => m.isOnline && m.tunnelUrl);

    // Disconnect from machines that are no longer connectable
    for (const [machineId] of clientsRef.current) {
      if (!connectableMachines.find((m) => m.id === machineId)) {
        disconnectMachine(machineId);
      }
    }

    // Connect to new machines
    for (const machine of connectableMachines) {
      connectMachine(machine.id, machine.tunnelUrl!);
    }
  }, [isAuthenticated, machines, connectMachine, disconnectMachine]);

  /**
   * Disconnect from all machines
   */
  const disconnectAll = useCallback(() => {
    for (const [machineId] of clientsRef.current) {
      disconnectMachine(machineId);
    }
    useConnectionStore.getState().setStatus('disconnected');
  }, [disconnectMachine]);

  /**
   * Find the client for a given session.
   * Falls back to trying all connected clients if session lookup fails
   * (handles hook-based approvals where the session may not be in the store).
   */
  const getClientForSession = useCallback((sessionId: string): WebSocketClient | null => {
    const sessions = useSessionsStore.getState().sessions;
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      const client = clientsRef.current.get(session.machineId);
      if (client) return client;
    }
    // Fallback: return first connected client
    for (const client of clientsRef.current.values()) {
      if (client.getStatus() === 'connected') return client;
    }
    return null;
  }, []);

  const subscribeToSession = useCallback(
    (sessionId: string) => {
      useSessionsStore.getState().startHistoryLoading(sessionId);
      getClientForSession(sessionId)?.subscribe([sessionId]);
    },
    [getClientForSession]
  );

  const sendMessage = useCallback(
    (sessionId: string, message: string) => {
      getClientForSession(sessionId)?.sendMessage(sessionId, message);
    },
    [getClientForSession]
  );

  const approveToolCall = useCallback(
    (sessionId: string, requestId: string, toolCallId: string) => {
      getClientForSession(sessionId)?.approveToolCall(sessionId, requestId, toolCallId);
    },
    [getClientForSession]
  );

  const denyToolCall = useCallback(
    (sessionId: string, requestId: string, toolCallId: string, reason?: string) => {
      getClientForSession(sessionId)?.denyToolCall(sessionId, requestId, toolCallId, reason);
    },
    [getClientForSession]
  );

  const cancelSession = useCallback(
    (sessionId: string) => {
      getClientForSession(sessionId)?.terminateSession(sessionId);
    },
    [getClientForSession]
  );

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        connectAll();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [connectAll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectAll();
    };
  }, [disconnectAll]);

  /**
   * Force-refresh: disconnect all and reconnect to get fresh session data
   */
  const refreshAll = useCallback(() => {
    disconnectAll();
    // Brief delay to ensure clean disconnect before reconnecting
    setTimeout(() => {
      connectAll();
    }, 100);
  }, [disconnectAll, connectAll]);

  return {
    connectAll,
    disconnectAll,
    refreshAll,
    subscribeToSession,
    sendMessage,
    approveToolCall,
    denyToolCall,
    cancelSession,
  };
}

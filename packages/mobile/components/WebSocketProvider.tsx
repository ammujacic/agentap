/**
 * WebSocket provider — multi-machine ACP connections
 */

import React, { createContext, useContext, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuthStore, useMachinesStore } from '@agentap-dev/shared';

interface WebSocketContextType {
  subscribeToSession: (sessionId: string) => void;
  sendMessage: (sessionId: string, message: string) => void;
  approveToolCall: (sessionId: string, requestId: string, toolCallId: string) => void;
  denyToolCall: (sessionId: string, requestId: string, toolCallId: string, reason?: string) => void;
  cancelSession: (sessionId: string) => void;
  refreshAll: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider');
  }
  return context;
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const machines = useMachinesStore((s) => s.machines);

  const {
    connectAll,
    disconnectAll,
    refreshAll,
    subscribeToSession,
    sendMessage,
    approveToolCall,
    denyToolCall,
    cancelSession,
  } = useWebSocket();

  // Auto-connect to all online machines when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      disconnectAll();
      return;
    }

    const hasConnectableMachines = machines.some((m) => m.isOnline && m.tunnelUrl);

    if (hasConnectableMachines) {
      connectAll();
    }
  }, [isAuthenticated, machines, connectAll, disconnectAll]);

  return (
    <WebSocketContext.Provider
      value={{
        subscribeToSession,
        sendMessage,
        approveToolCall,
        denyToolCall,
        cancelSession,
        refreshAll,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

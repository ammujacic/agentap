/**
 * Connection state store — multi-machine aware
 */

import { create } from 'zustand';
import type { ConnectionStatus } from '../services/websocket';

export interface ConnectionState {
  /** Top-level status: 'connected' if ANY machine is connected */
  status: ConnectionStatus;
  /** Per-machine connection status */
  machineConnections: Map<string, ConnectionStatus>;
  error: string | null;
  lastConnected: Date | null;

  // Actions
  setStatus: (status: ConnectionStatus) => void;
  setMachineStatus: (machineId: string, status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  disconnect: () => void;
}

function deriveTopLevelStatus(connections: Map<string, ConnectionStatus>): ConnectionStatus {
  const statuses = Array.from(connections.values());
  if (statuses.some((s) => s === 'connected')) return 'connected';
  if (statuses.some((s) => s === 'connecting')) return 'connecting';
  if (statuses.some((s) => s === 'error')) return 'error';
  return 'disconnected';
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  machineConnections: new Map(),
  error: null,
  lastConnected: null,

  setStatus: (status) =>
    set((state) => ({
      status,
      lastConnected: status === 'connected' ? new Date() : state.lastConnected,
      error: status === 'connected' ? null : state.error,
    })),

  setMachineStatus: (machineId, status) =>
    set((state) => {
      const newConnections = new Map(state.machineConnections);
      if (status === 'disconnected') {
        newConnections.delete(machineId);
      } else {
        newConnections.set(machineId, status);
      }
      const derived = deriveTopLevelStatus(newConnections);
      return {
        machineConnections: newConnections,
        status: derived,
        lastConnected: derived === 'connected' ? new Date() : state.lastConnected,
        error: derived === 'connected' ? null : state.error,
      };
    }),

  setError: (error) => set({ error, status: 'error' }),

  disconnect: () =>
    set({
      status: 'disconnected',
      machineConnections: new Map(),
      error: null,
    }),
}));

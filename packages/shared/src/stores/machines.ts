/**
 * Machines store
 */

import { create } from 'zustand';
import type { Machine } from '../types/user';

export interface MachinesState {
  machines: Machine[];
  selectedMachineId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setMachines: (machines: Machine[]) => void;
  addMachine: (machine: Machine) => void;
  updateMachine: (id: string, updates: Partial<Machine>) => void;
  removeMachine: (id: string) => void;
  selectMachine: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useMachinesStore = create<MachinesState>((set) => ({
  machines: [],
  selectedMachineId: null,
  isLoading: false,
  error: null,

  setMachines: (machines) => set({ machines, isLoading: false, error: null }),

  addMachine: (machine) =>
    set((state) => ({
      machines: [...state.machines, machine],
    })),

  updateMachine: (id, updates) =>
    set((state) => ({
      machines: state.machines.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  removeMachine: (id) =>
    set((state) => ({
      machines: state.machines.filter((m) => m.id !== id),
      selectedMachineId: state.selectedMachineId === id ? null : state.selectedMachineId,
    })),

  selectMachine: (id) => set({ selectedMachineId: id }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),
}));

// Selectors
export const selectSelectedMachine = (state: MachinesState): Machine | null =>
  state.machines.find((m) => m.id === state.selectedMachineId) ?? null;

export const selectOnlineMachines = (state: MachinesState): Machine[] =>
  state.machines.filter((m) => m.isOnline);

export const selectConnectableMachines = (state: MachinesState): Machine[] =>
  state.machines.filter((m) => m.isOnline && m.tunnelUrl);

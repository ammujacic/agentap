import { describe, it, expect, beforeEach } from 'vitest';

import type { Machine } from '../../types/user';
import {
  useMachinesStore,
  selectSelectedMachine,
  selectOnlineMachines,
  selectConnectableMachines,
} from '../../stores/machines';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

let counter = 0;

function makeMachine(overrides: Partial<Machine> = {}): Machine {
  counter += 1;
  return {
    id: `machine-${counter}`,
    userId: 'user-1',
    name: `Machine ${counter}`,
    tunnelId: `tunnel-${counter}`,
    tunnelUrl: `https://tunnel-${counter}.example.com`,
    os: 'darwin',
    arch: 'arm64',
    agentsDetected: ['claude-code'],
    isOnline: true,
    activeSessionCount: 0,
    lastSeenAt: new Date('2025-01-01'),
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMachinesStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useMachinesStore.setState({
      machines: [],
      selectedMachineId: null,
      isLoading: false,
      error: null,
    });
    counter = 0;
  });

  // ---- Initial state -------------------------------------------------------

  it('should have correct initial state', () => {
    const state = useMachinesStore.getState();

    expect(state.machines).toEqual([]);
    expect(state.selectedMachineId).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // ---- setMachines ----------------------------------------------------------

  it('setMachines should replace the machines array and clear loading/error', () => {
    const m1 = makeMachine();
    const m2 = makeMachine();

    // Put the store in a loading + error state first
    useMachinesStore.setState({ isLoading: true, error: 'previous error' });

    useMachinesStore.getState().setMachines([m1, m2]);
    const state = useMachinesStore.getState();

    expect(state.machines).toEqual([m1, m2]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // ---- addMachine -----------------------------------------------------------

  it('addMachine should append a machine to the list', () => {
    const m1 = makeMachine();
    const m2 = makeMachine();

    useMachinesStore.getState().addMachine(m1);
    useMachinesStore.getState().addMachine(m2);

    expect(useMachinesStore.getState().machines).toEqual([m1, m2]);
  });

  // ---- updateMachine --------------------------------------------------------

  it('updateMachine should merge partial updates into the matching machine', () => {
    const m1 = makeMachine({ name: 'Old Name' });
    useMachinesStore.setState({ machines: [m1] });

    useMachinesStore.getState().updateMachine(m1.id, {
      name: 'New Name',
      isOnline: false,
    });

    const updated = useMachinesStore.getState().machines[0];
    expect(updated.name).toBe('New Name');
    expect(updated.isOnline).toBe(false);
    // Other fields remain unchanged
    expect(updated.id).toBe(m1.id);
    expect(updated.tunnelUrl).toBe(m1.tunnelUrl);
  });

  it('updateMachine should not modify other machines', () => {
    const m1 = makeMachine();
    const m2 = makeMachine();
    useMachinesStore.setState({ machines: [m1, m2] });

    useMachinesStore.getState().updateMachine(m1.id, { name: 'Updated' });

    const machines = useMachinesStore.getState().machines;
    expect(machines[0].name).toBe('Updated');
    expect(machines[1]).toEqual(m2);
  });

  // ---- removeMachine --------------------------------------------------------

  it('removeMachine should remove the machine with the given id', () => {
    const m1 = makeMachine();
    const m2 = makeMachine();
    useMachinesStore.setState({ machines: [m1, m2] });

    useMachinesStore.getState().removeMachine(m1.id);

    expect(useMachinesStore.getState().machines).toEqual([m2]);
  });

  it('removeMachine should clear selectedMachineId when the selected machine is removed', () => {
    const m1 = makeMachine();
    useMachinesStore.setState({ machines: [m1], selectedMachineId: m1.id });

    useMachinesStore.getState().removeMachine(m1.id);

    expect(useMachinesStore.getState().selectedMachineId).toBeNull();
  });

  it('removeMachine should keep selectedMachineId when a different machine is removed', () => {
    const m1 = makeMachine();
    const m2 = makeMachine();
    useMachinesStore.setState({
      machines: [m1, m2],
      selectedMachineId: m1.id,
    });

    useMachinesStore.getState().removeMachine(m2.id);

    expect(useMachinesStore.getState().selectedMachineId).toBe(m1.id);
  });

  // ---- selectMachine --------------------------------------------------------

  it('selectMachine should set the selectedMachineId', () => {
    useMachinesStore.getState().selectMachine('machine-99');
    expect(useMachinesStore.getState().selectedMachineId).toBe('machine-99');

    useMachinesStore.getState().selectMachine(null);
    expect(useMachinesStore.getState().selectedMachineId).toBeNull();
  });

  // ---- setLoading -----------------------------------------------------------

  it('setLoading should update the isLoading flag', () => {
    useMachinesStore.getState().setLoading(true);
    expect(useMachinesStore.getState().isLoading).toBe(true);

    useMachinesStore.getState().setLoading(false);
    expect(useMachinesStore.getState().isLoading).toBe(false);
  });

  // ---- setError -------------------------------------------------------------

  it('setError should set the error and clear isLoading', () => {
    useMachinesStore.setState({ isLoading: true });

    useMachinesStore.getState().setError('Something went wrong');
    const state = useMachinesStore.getState();

    expect(state.error).toBe('Something went wrong');
    expect(state.isLoading).toBe(false);
  });

  it('setError with null should clear the error', () => {
    useMachinesStore.setState({ error: 'old error' });

    useMachinesStore.getState().setError(null);

    expect(useMachinesStore.getState().error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('selectors', () => {
  beforeEach(() => {
    useMachinesStore.setState({
      machines: [],
      selectedMachineId: null,
      isLoading: false,
      error: null,
    });
    counter = 0;
  });

  describe('selectSelectedMachine', () => {
    it('should return the machine matching selectedMachineId', () => {
      const m1 = makeMachine();
      const m2 = makeMachine();
      useMachinesStore.setState({
        machines: [m1, m2],
        selectedMachineId: m2.id,
      });

      const result = selectSelectedMachine(useMachinesStore.getState());
      expect(result).toEqual(m2);
    });

    it('should return null when no machine is selected', () => {
      const m1 = makeMachine();
      useMachinesStore.setState({ machines: [m1], selectedMachineId: null });

      const result = selectSelectedMachine(useMachinesStore.getState());
      expect(result).toBeNull();
    });

    it('should return null when selectedMachineId does not match any machine', () => {
      const m1 = makeMachine();
      useMachinesStore.setState({
        machines: [m1],
        selectedMachineId: 'nonexistent',
      });

      const result = selectSelectedMachine(useMachinesStore.getState());
      expect(result).toBeNull();
    });
  });

  describe('selectOnlineMachines', () => {
    it('should return only machines where isOnline is true', () => {
      const online1 = makeMachine({ isOnline: true });
      const offline = makeMachine({ isOnline: false });
      const online2 = makeMachine({ isOnline: true });
      useMachinesStore.setState({ machines: [online1, offline, online2] });

      const result = selectOnlineMachines(useMachinesStore.getState());

      expect(result).toEqual([online1, online2]);
    });

    it('should return an empty array when no machines are online', () => {
      const m1 = makeMachine({ isOnline: false });
      useMachinesStore.setState({ machines: [m1] });

      const result = selectOnlineMachines(useMachinesStore.getState());
      expect(result).toEqual([]);
    });
  });

  describe('selectConnectableMachines', () => {
    it('should return machines that are online AND have a tunnelUrl', () => {
      const connectable = makeMachine({ isOnline: true, tunnelUrl: 'https://t.example.com' });
      const onlineNoTunnel = makeMachine({ isOnline: true, tunnelUrl: null });
      const offlineWithTunnel = makeMachine({
        isOnline: false,
        tunnelUrl: 'https://t2.example.com',
      });
      const offlineNoTunnel = makeMachine({ isOnline: false, tunnelUrl: null });
      useMachinesStore.setState({
        machines: [connectable, onlineNoTunnel, offlineWithTunnel, offlineNoTunnel],
      });

      const result = selectConnectableMachines(useMachinesStore.getState());

      expect(result).toEqual([connectable]);
    });

    it('should return an empty array when no machines are connectable', () => {
      const m1 = makeMachine({ isOnline: true, tunnelUrl: null });
      const m2 = makeMachine({ isOnline: false, tunnelUrl: 'https://t.example.com' });
      useMachinesStore.setState({ machines: [m1, m2] });

      const result = selectConnectableMachines(useMachinesStore.getState());
      expect(result).toEqual([]);
    });
  });
});

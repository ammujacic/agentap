import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useConnectionStore } from '../../stores/connection';

/**
 * Helper: get current snapshot of store state (without subscribing).
 */
const getState = () => useConnectionStore.getState();

describe('useConnectionStore', () => {
  beforeEach(() => {
    // Reset to initial state before every test
    useConnectionStore.setState({
      status: 'disconnected',
      machineConnections: new Map(),
      error: null,
      lastConnected: null,
    });
  });

  // ------------------------------------------------------------------
  // Initial state
  // ------------------------------------------------------------------
  it('should have correct initial state', () => {
    const state = getState();
    expect(state.status).toBe('disconnected');
    expect(state.machineConnections.size).toBe(0);
    expect(state.error).toBeNull();
    expect(state.lastConnected).toBeNull();
  });

  // ------------------------------------------------------------------
  // setStatus
  // ------------------------------------------------------------------
  describe('setStatus', () => {
    it('should update status to the given value', () => {
      getState().setStatus('connecting');
      expect(getState().status).toBe('connecting');
    });

    it('should set lastConnected and clear error when status becomes connected', () => {
      // Seed an error first so we can verify it gets cleared
      useConnectionStore.setState({ error: 'something went wrong' });

      const before = new Date();
      getState().setStatus('connected');
      const after = new Date();

      const state = getState();
      expect(state.status).toBe('connected');
      expect(state.error).toBeNull();
      expect(state.lastConnected).toBeInstanceOf(Date);
      expect(state.lastConnected!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(state.lastConnected!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should preserve lastConnected when status is not connected', () => {
      const fixedDate = new Date('2025-01-01T00:00:00Z');
      useConnectionStore.setState({ lastConnected: fixedDate });

      getState().setStatus('connecting');

      expect(getState().lastConnected).toBe(fixedDate);
    });

    it('should preserve existing error when status is not connected', () => {
      useConnectionStore.setState({ error: 'old error' });

      getState().setStatus('connecting');

      expect(getState().error).toBe('old error');
    });
  });

  // ------------------------------------------------------------------
  // setMachineStatus
  // ------------------------------------------------------------------
  describe('setMachineStatus', () => {
    it('should track per-machine connection status', () => {
      getState().setMachineStatus('m1', 'connecting');
      expect(getState().machineConnections.get('m1')).toBe('connecting');
    });

    it('should remove machine entry when status is disconnected', () => {
      getState().setMachineStatus('m1', 'connected');
      expect(getState().machineConnections.has('m1')).toBe(true);

      getState().setMachineStatus('m1', 'disconnected');
      expect(getState().machineConnections.has('m1')).toBe(false);
      expect(getState().machineConnections.size).toBe(0);
    });

    it('should derive top-level status as connected when any machine is connected', () => {
      getState().setMachineStatus('m1', 'connecting');
      getState().setMachineStatus('m2', 'connected');

      expect(getState().status).toBe('connected');
    });

    it('should derive top-level status as connecting when no machine is connected but one is connecting', () => {
      getState().setMachineStatus('m1', 'connecting');
      getState().setMachineStatus('m2', 'error');

      expect(getState().status).toBe('connecting');
    });

    it('should derive top-level status as error when all machines are in error', () => {
      getState().setMachineStatus('m1', 'error');

      expect(getState().status).toBe('error');
    });

    it('should derive top-level status as disconnected when map is empty', () => {
      getState().setMachineStatus('m1', 'connected');
      getState().setMachineStatus('m1', 'disconnected');

      expect(getState().status).toBe('disconnected');
    });

    it('should set lastConnected when derived status is connected', () => {
      const before = new Date();
      getState().setMachineStatus('m1', 'connected');
      const after = new Date();

      const { lastConnected } = getState();
      expect(lastConnected).toBeInstanceOf(Date);
      expect(lastConnected!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(lastConnected!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should clear error when derived status is connected', () => {
      useConnectionStore.setState({ error: 'previous error' });

      getState().setMachineStatus('m1', 'connected');

      expect(getState().error).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // setError
  // ------------------------------------------------------------------
  describe('setError', () => {
    it('should set error message and status to error', () => {
      getState().setError('connection refused');

      const state = getState();
      expect(state.error).toBe('connection refused');
      expect(state.status).toBe('error');
    });

    it('should allow clearing error by passing null', () => {
      getState().setError('boom');
      getState().setError(null);

      const state = getState();
      expect(state.error).toBeNull();
      // status remains 'error' because setError always sets status to 'error'
      expect(state.status).toBe('error');
    });
  });

  // ------------------------------------------------------------------
  // disconnect
  // ------------------------------------------------------------------
  describe('disconnect', () => {
    it('should reset all state to defaults', () => {
      // Put store in a non-default state first
      getState().setMachineStatus('m1', 'connected');
      getState().setError('something');

      getState().disconnect();

      const state = getState();
      expect(state.status).toBe('disconnected');
      expect(state.machineConnections.size).toBe(0);
      expect(state.error).toBeNull();
    });

    it('should preserve lastConnected after disconnect', () => {
      // lastConnected is set when a machine connects
      getState().setMachineStatus('m1', 'connected');
      const { lastConnected } = getState();
      expect(lastConnected).toBeInstanceOf(Date);

      getState().disconnect();

      // disconnect does not explicitly reset lastConnected (it is not in the set() call)
      // but since setState merges, it should remain
      expect(getState().lastConnected).toEqual(lastConnected);
    });
  });

  // ------------------------------------------------------------------
  // deriveTopLevelStatus priority (connected > connecting > error > disconnected)
  // ------------------------------------------------------------------
  describe('deriveTopLevelStatus priority', () => {
    it('should prioritise connected over error and connecting', () => {
      getState().setMachineStatus('m1', 'error');
      getState().setMachineStatus('m2', 'connecting');
      getState().setMachineStatus('m3', 'connected');

      expect(getState().status).toBe('connected');
    });

    it('should prioritise connecting over error', () => {
      getState().setMachineStatus('m1', 'error');
      getState().setMachineStatus('m2', 'connecting');

      expect(getState().status).toBe('connecting');
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';

import { usePreferencesStore } from '../../stores/preferences';
import type { UserPreferences } from '../../types/user';

const allEnabled: UserPreferences = {
  autoApproveLow: true,
  autoApproveMedium: true,
  autoApproveHigh: true,
  autoApproveCritical: true,
};

describe('usePreferencesStore', () => {
  beforeEach(() => {
    usePreferencesStore.getState().reset();
  });

  // ── Initial state ────────────────────────────────────────────────────

  it('should have correct initial state', () => {
    const state = usePreferencesStore.getState();

    expect(state.preferences).toEqual({
      autoApproveLow: false,
      autoApproveMedium: false,
      autoApproveHigh: false,
      autoApproveCritical: false,
    });
    expect(state.isLoaded).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // ── setPreferences ───────────────────────────────────────────────────

  it('should set preferences, mark as loaded, clear loading and error', () => {
    const { setLoading, setError, setPreferences } = usePreferencesStore.getState();

    // Put the store in a "loading with error" state first
    setLoading(true);
    setError('previous error');
    setPreferences(allEnabled);

    const state = usePreferencesStore.getState();
    expect(state.preferences).toEqual(allEnabled);
    expect(state.isLoaded).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // ── setLoading ───────────────────────────────────────────────────────

  it('should toggle isLoading', () => {
    const { setLoading } = usePreferencesStore.getState();

    setLoading(true);
    expect(usePreferencesStore.getState().isLoading).toBe(true);

    setLoading(false);
    expect(usePreferencesStore.getState().isLoading).toBe(false);
  });

  // ── setError ─────────────────────────────────────────────────────────

  it('should set error and clear isLoading', () => {
    const { setLoading, setError } = usePreferencesStore.getState();

    setLoading(true);
    setError('something went wrong');

    const state = usePreferencesStore.getState();
    expect(state.error).toBe('something went wrong');
    expect(state.isLoading).toBe(false);
  });

  it('should allow clearing the error by passing null', () => {
    const { setError } = usePreferencesStore.getState();

    setError('oops');
    expect(usePreferencesStore.getState().error).toBe('oops');

    setError(null);
    expect(usePreferencesStore.getState().error).toBeNull();
  });

  // ── shouldAutoApprove ────────────────────────────────────────────────

  it('should return false for every risk level when preferences are not loaded', () => {
    const { shouldAutoApprove } = usePreferencesStore.getState();

    expect(shouldAutoApprove('low')).toBe(false);
    expect(shouldAutoApprove('medium')).toBe(false);
    expect(shouldAutoApprove('high')).toBe(false);
    expect(shouldAutoApprove('critical')).toBe(false);
  });

  it('should return the matching preference value for each risk level', () => {
    const { setPreferences } = usePreferencesStore.getState();

    setPreferences({
      autoApproveLow: true,
      autoApproveMedium: false,
      autoApproveHigh: true,
      autoApproveCritical: false,
    });

    const { shouldAutoApprove } = usePreferencesStore.getState();
    expect(shouldAutoApprove('low')).toBe(true);
    expect(shouldAutoApprove('medium')).toBe(false);
    expect(shouldAutoApprove('high')).toBe(true);
    expect(shouldAutoApprove('critical')).toBe(false);
  });

  it('should return false for an unknown risk level even when loaded', () => {
    const { setPreferences } = usePreferencesStore.getState();
    setPreferences(allEnabled);

    const { shouldAutoApprove } = usePreferencesStore.getState();
    expect(shouldAutoApprove('unknown')).toBe(false);
    expect(shouldAutoApprove('')).toBe(false);
  });

  // ── reset ────────────────────────────────────────────────────────────

  it('should restore the store to its initial state', () => {
    const { setPreferences, setLoading, setError, reset } = usePreferencesStore.getState();

    // Mutate everything
    setPreferences(allEnabled);
    setLoading(true);
    setError('some error');

    reset();

    const state = usePreferencesStore.getState();
    expect(state.preferences).toEqual({
      autoApproveLow: false,
      autoApproveMedium: false,
      autoApproveHigh: false,
      autoApproveCritical: false,
    });
    expect(state.isLoaded).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });
});

/**
 * User preferences store - auto-approve settings
 */

import { create } from 'zustand';
import type { UserPreferences } from '../types/user';

export interface PreferencesState {
  preferences: UserPreferences;
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setPreferences: (preferences: UserPreferences) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  shouldAutoApprove: (riskLevel: string) => boolean;
  reset: () => void;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  autoApproveLow: false,
  autoApproveMedium: false,
  autoApproveHigh: false,
  autoApproveCritical: false,
};

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  preferences: { ...DEFAULT_PREFERENCES },
  isLoaded: false,
  isLoading: false,
  error: null,

  setPreferences: (preferences) =>
    set({ preferences, isLoaded: true, isLoading: false, error: null }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  shouldAutoApprove: (riskLevel: string): boolean => {
    const { preferences, isLoaded } = get();
    if (!isLoaded) return false;

    switch (riskLevel) {
      case 'low':
        return preferences.autoApproveLow;
      case 'medium':
        return preferences.autoApproveMedium;
      case 'high':
        return preferences.autoApproveHigh;
      case 'critical':
        return preferences.autoApproveCritical;
      default:
        return false;
    }
  },

  reset: () =>
    set({
      preferences: { ...DEFAULT_PREFERENCES },
      isLoaded: false,
      isLoading: false,
      error: null,
    }),
}));

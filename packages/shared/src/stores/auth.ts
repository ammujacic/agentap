/**
 * Authentication store
 */

import { create, type StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types/user';

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  twoFactorPending: boolean;

  // Actions
  setUser: (user: User | null, token?: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setTwoFactorPending: (pending: boolean) => void;
  logout: () => void;
}

const stateCreator: StateCreator<AuthState> = (set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  twoFactorPending: false,

  setUser: (user, token) =>
    set({
      user,
      token: token ?? null,
      isAuthenticated: user !== null,
      isLoading: false,
      error: null,
      twoFactorPending: false,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  setTwoFactorPending: (twoFactorPending) => set({ twoFactorPending, isLoading: false }),

  logout: () =>
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      twoFactorPending: false,
    }),
});

export const createAuthStore = (storage?: Storage) => {
  if (storage) {
    return create<AuthState>()(
      persist(stateCreator, {
        name: 'agentap-auth',
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({
          user: state.user,
          token: state.token,
          isAuthenticated: state.isAuthenticated,
        }),
      })
    );
  }
  return create<AuthState>()(stateCreator);
};

// Default store - no persistence by default (apps should handle their own persistence)
export const useAuthStore = createAuthStore();

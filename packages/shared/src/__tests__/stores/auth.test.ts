import { describe, it, expect, beforeEach } from 'vitest';
import type { User } from '../../types/user';
import { useAuthStore, createAuthStore, type AuthState } from '../../stores/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-06-01'),
  ...overrides,
});

const initialState: Pick<
  AuthState,
  'user' | 'token' | 'isAuthenticated' | 'isLoading' | 'error' | 'twoFactorPending'
> = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  twoFactorPending: false,
};

// ---------------------------------------------------------------------------
// Default store (useAuthStore)
// ---------------------------------------------------------------------------

describe('useAuthStore (default, no persistence)', () => {
  beforeEach(() => {
    // Reset to initial state before every test
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      twoFactorPending: false,
    });
  });

  // ---- Initial state ----

  it('should have correct initial state', () => {
    const state = useAuthStore.getState();

    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
    expect(state.error).toBeNull();
    expect(state.twoFactorPending).toBe(false);
  });

  // ---- setUser ----

  describe('setUser', () => {
    it('should set user and mark authenticated', () => {
      const user = makeUser();
      useAuthStore.getState().setUser(user);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.twoFactorPending).toBe(false);
    });

    it('should set user with token', () => {
      const user = makeUser();
      useAuthStore.getState().setUser(user, 'my-token-123');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.token).toBe('my-token-123');
      expect(state.isAuthenticated).toBe(true);
    });

    it('should default token to null when not provided', () => {
      const user = makeUser();
      useAuthStore.getState().setUser(user);

      expect(useAuthStore.getState().token).toBeNull();
    });

    it('should allow explicitly passing null token', () => {
      // First set a token
      useAuthStore.getState().setUser(makeUser(), 'some-token');
      expect(useAuthStore.getState().token).toBe('some-token');

      // Then set user with explicit null token
      useAuthStore.getState().setUser(makeUser(), null);
      expect(useAuthStore.getState().token).toBeNull();
    });

    it('should clear error when setting user', () => {
      useAuthStore.getState().setError('some error');
      expect(useAuthStore.getState().error).toBe('some error');

      useAuthStore.getState().setUser(makeUser());
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('should clear twoFactorPending when setting user', () => {
      useAuthStore.getState().setTwoFactorPending(true);
      expect(useAuthStore.getState().twoFactorPending).toBe(true);

      useAuthStore.getState().setUser(makeUser());
      expect(useAuthStore.getState().twoFactorPending).toBe(false);
    });

    it('should set isLoading to false', () => {
      expect(useAuthStore.getState().isLoading).toBe(true);
      useAuthStore.getState().setUser(makeUser());
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should set null user and mark unauthenticated', () => {
      // First set a user
      useAuthStore.getState().setUser(makeUser(), 'token');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);

      // Then set null user
      useAuthStore.getState().setUser(null);

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it('should handle user with all optional fields populated', () => {
      const user = makeUser({
        name: 'Full Name',
        avatarUrl: 'https://example.com/avatar.png',
        twoFactorEnabled: true,
      });

      useAuthStore.getState().setUser(user, 'tok');
      const state = useAuthStore.getState();

      expect(state.user?.name).toBe('Full Name');
      expect(state.user?.avatarUrl).toBe('https://example.com/avatar.png');
      expect(state.user?.twoFactorEnabled).toBe(true);
      expect(state.token).toBe('tok');
    });

    it('should handle user with null optional fields', () => {
      const user = makeUser({ name: null, avatarUrl: null });

      useAuthStore.getState().setUser(user);
      const state = useAuthStore.getState();

      expect(state.user?.name).toBeNull();
      expect(state.user?.avatarUrl).toBeNull();
    });
  });

  // ---- setLoading ----

  describe('setLoading', () => {
    it('should set isLoading to true', () => {
      // First clear it
      useAuthStore.getState().setLoading(false);
      expect(useAuthStore.getState().isLoading).toBe(false);

      useAuthStore.getState().setLoading(true);
      expect(useAuthStore.getState().isLoading).toBe(true);
    });

    it('should set isLoading to false', () => {
      expect(useAuthStore.getState().isLoading).toBe(true);

      useAuthStore.getState().setLoading(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should not affect other state', () => {
      const user = makeUser();
      useAuthStore.getState().setUser(user, 'token');
      useAuthStore.getState().setLoading(true);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.token).toBe('token');
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(true);
    });
  });

  // ---- setError ----

  describe('setError', () => {
    it('should set error message', () => {
      useAuthStore.getState().setError('Invalid credentials');

      const state = useAuthStore.getState();
      expect(state.error).toBe('Invalid credentials');
      expect(state.isLoading).toBe(false);
    });

    it('should clear error with null', () => {
      useAuthStore.getState().setError('some error');
      expect(useAuthStore.getState().error).toBe('some error');

      useAuthStore.getState().setError(null);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('should set isLoading to false when setting error', () => {
      useAuthStore.setState({ isLoading: true });
      useAuthStore.getState().setError('oops');

      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should not affect user or authentication state', () => {
      const user = makeUser();
      useAuthStore.getState().setUser(user, 'token');
      useAuthStore.getState().setError('Network error');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.token).toBe('token');
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBe('Network error');
    });
  });

  // ---- setTwoFactorPending ----

  describe('setTwoFactorPending', () => {
    it('should set twoFactorPending to true', () => {
      useAuthStore.getState().setTwoFactorPending(true);

      const state = useAuthStore.getState();
      expect(state.twoFactorPending).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('should set twoFactorPending to false', () => {
      useAuthStore.getState().setTwoFactorPending(true);
      useAuthStore.getState().setTwoFactorPending(false);

      expect(useAuthStore.getState().twoFactorPending).toBe(false);
    });

    it('should set isLoading to false', () => {
      useAuthStore.setState({ isLoading: true });
      useAuthStore.getState().setTwoFactorPending(true);

      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should not affect other state', () => {
      const user = makeUser();
      useAuthStore.getState().setUser(user, 'token');
      useAuthStore.getState().setTwoFactorPending(true);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.token).toBe('token');
      expect(state.isAuthenticated).toBe(true);
    });
  });

  // ---- logout ----

  describe('logout', () => {
    it('should reset all state to defaults', () => {
      // Setup: fully authenticated state with error and twoFactor
      const user = makeUser();
      useAuthStore.getState().setUser(user, 'token-123');
      useAuthStore.setState({ error: 'lingering error', twoFactorPending: true });

      // Act
      useAuthStore.getState().logout();

      // Assert
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.twoFactorPending).toBe(false);
    });

    it('should be safe to call when already logged out', () => {
      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it('should clear token', () => {
      useAuthStore.getState().setUser(makeUser(), 'secret-token');
      expect(useAuthStore.getState().token).toBe('secret-token');

      useAuthStore.getState().logout();
      expect(useAuthStore.getState().token).toBeNull();
    });
  });

  // ---- Complex flows ----

  describe('complex state transitions', () => {
    it('should handle login flow: loading -> authenticated', () => {
      // Initial: isLoading is true
      expect(useAuthStore.getState().isLoading).toBe(true);

      // User logs in
      useAuthStore.getState().setUser(makeUser(), 'jwt-token');

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).not.toBeNull();
      expect(state.token).toBe('jwt-token');
    });

    it('should handle login error flow: loading -> error', () => {
      expect(useAuthStore.getState().isLoading).toBe(true);

      useAuthStore.getState().setError('Invalid password');

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.error).toBe('Invalid password');
    });

    it('should handle 2FA flow: login -> 2FA pending -> authenticated', () => {
      // Step 1: Start loading
      expect(useAuthStore.getState().isLoading).toBe(true);

      // Step 2: 2FA required
      useAuthStore.getState().setTwoFactorPending(true);
      expect(useAuthStore.getState().twoFactorPending).toBe(true);
      expect(useAuthStore.getState().isLoading).toBe(false);

      // Step 3: 2FA verified, set user
      useAuthStore.getState().setUser(makeUser({ twoFactorEnabled: true }), 'token');

      const state = useAuthStore.getState();
      expect(state.twoFactorPending).toBe(false);
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.twoFactorEnabled).toBe(true);
    });

    it('should handle full login -> logout cycle', () => {
      // Login
      useAuthStore.getState().setUser(makeUser(), 'token');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);

      // Logout
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
    });

    it('should handle switching users', () => {
      const user1 = makeUser({ id: 'user-1', email: 'one@example.com' });
      const user2 = makeUser({ id: 'user-2', email: 'two@example.com' });

      useAuthStore.getState().setUser(user1, 'token-1');
      expect(useAuthStore.getState().user?.id).toBe('user-1');

      useAuthStore.getState().setUser(user2, 'token-2');
      expect(useAuthStore.getState().user?.id).toBe('user-2');
      expect(useAuthStore.getState().token).toBe('token-2');
    });

    it('should handle error -> retry -> success flow', () => {
      // Attempt 1: error
      useAuthStore.getState().setError('Network error');
      expect(useAuthStore.getState().error).toBe('Network error');

      // Retry: start loading
      useAuthStore.getState().setLoading(true);
      expect(useAuthStore.getState().isLoading).toBe(true);

      // Attempt 2: success
      useAuthStore.getState().setUser(makeUser(), 'token');
      const state = useAuthStore.getState();
      expect(state.error).toBeNull();
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// createAuthStore factory
// ---------------------------------------------------------------------------

describe('createAuthStore', () => {
  describe('without storage (no persistence)', () => {
    it('should create a new store with initial state', () => {
      const store = createAuthStore();
      const state = store.getState();

      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
      expect(state.error).toBeNull();
      expect(state.twoFactorPending).toBe(false);
    });

    it('should create independent store instances', () => {
      const store1 = createAuthStore();
      const store2 = createAuthStore();

      store1.getState().setUser(makeUser({ id: 'a' }), 'tok-a');

      expect(store1.getState().user?.id).toBe('a');
      expect(store2.getState().user).toBeNull();
    });

    it('should support all actions', () => {
      const store = createAuthStore();

      store.getState().setUser(makeUser(), 'token');
      expect(store.getState().isAuthenticated).toBe(true);

      store.getState().setLoading(true);
      expect(store.getState().isLoading).toBe(true);

      store.getState().setError('err');
      expect(store.getState().error).toBe('err');

      store.getState().setTwoFactorPending(true);
      expect(store.getState().twoFactorPending).toBe(true);

      store.getState().logout();
      expect(store.getState().isAuthenticated).toBe(false);
      expect(store.getState().user).toBeNull();
    });
  });

  describe('with storage (persistence)', () => {
    let memoryStorage: Record<string, string>;
    let mockStorage: {
      getItem: (name: string) => string | null;
      setItem: (name: string, value: string) => void;
      removeItem: (name: string) => void;
    };

    beforeEach(() => {
      memoryStorage = {};
      mockStorage = {
        getItem: (name: string) => memoryStorage[name] ?? null,
        setItem: (name: string, value: string) => {
          memoryStorage[name] = value;
        },
        removeItem: (name: string) => {
          delete memoryStorage[name];
        },
      };
    });

    it('should create a persistent store', () => {
      const store = createAuthStore(mockStorage as unknown as Storage);
      const state = store.getState();

      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
    });

    it('should persist user, token, and isAuthenticated to storage', () => {
      const store = createAuthStore(mockStorage as unknown as Storage);
      const user = makeUser();

      store.getState().setUser(user, 'persist-token');

      // Verify something was written to storage
      expect(memoryStorage['agentap-auth']).toBeDefined();

      const stored = JSON.parse(memoryStorage['agentap-auth']);
      expect(stored.state.user).toEqual({
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });
      expect(stored.state.token).toBe('persist-token');
      expect(stored.state.isAuthenticated).toBe(true);
    });

    it('should NOT persist isLoading, error, or twoFactorPending', () => {
      const store = createAuthStore(mockStorage as unknown as Storage);

      store.getState().setUser(makeUser(), 'token');
      store.getState().setTwoFactorPending(true);
      // setError does not affect user/token/isAuthenticated, but let's set it
      store.setState({ error: 'some-error' });

      const stored = JSON.parse(memoryStorage['agentap-auth']);
      // partialize only includes user, token, isAuthenticated
      expect(stored.state).not.toHaveProperty('isLoading');
      expect(stored.state).not.toHaveProperty('error');
      expect(stored.state).not.toHaveProperty('twoFactorPending');
    });

    it('should use "agentap-auth" as the storage key', () => {
      const store = createAuthStore(mockStorage as unknown as Storage);
      store.getState().setUser(makeUser());

      expect(Object.keys(memoryStorage)).toContain('agentap-auth');
    });

    it('should restore persisted state in a new store', () => {
      // Store 1: write data
      const store1 = createAuthStore(mockStorage as unknown as Storage);
      const user = makeUser({ id: 'persisted-user' });
      store1.getState().setUser(user, 'persisted-token');

      // Store 2: reads from the same storage
      const store2 = createAuthStore(mockStorage as unknown as Storage);

      const state = store2.getState();
      expect(state.user?.id).toBe('persisted-user');
      expect(state.token).toBe('persisted-token');
      expect(state.isAuthenticated).toBe(true);
    });

    it('should clear persisted data on logout', () => {
      const store = createAuthStore(mockStorage as unknown as Storage);

      store.getState().setUser(makeUser(), 'tok');
      expect(memoryStorage['agentap-auth']).toBeDefined();

      store.getState().logout();

      // After logout, the persisted state should have null user/token
      const stored = JSON.parse(memoryStorage['agentap-auth']);
      expect(stored.state.user).toBeNull();
      expect(stored.state.token).toBeNull();
      expect(stored.state.isAuthenticated).toBe(false);
    });

    it('should handle storage with no pre-existing data', () => {
      // Empty storage - store should start with defaults
      const store = createAuthStore(mockStorage as unknown as Storage);
      const state = store.getState();

      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
    });

    it('should support all actions with persistence', () => {
      const store = createAuthStore(mockStorage as unknown as Storage);

      // setUser
      store.getState().setUser(makeUser(), 'token');
      expect(store.getState().isAuthenticated).toBe(true);

      // setLoading
      store.getState().setLoading(true);
      expect(store.getState().isLoading).toBe(true);

      // setError
      store.getState().setError('err');
      expect(store.getState().error).toBe('err');
      expect(store.getState().isLoading).toBe(false);

      // setTwoFactorPending
      store.getState().setTwoFactorPending(true);
      expect(store.getState().twoFactorPending).toBe(true);

      // logout
      store.getState().logout();
      expect(store.getState().isAuthenticated).toBe(false);
      expect(store.getState().user).toBeNull();
    });

    it('should persist updates across multiple setUser calls', () => {
      const store = createAuthStore(mockStorage as unknown as Storage);

      const user1 = makeUser({ id: 'u1', email: 'u1@test.com' });
      store.getState().setUser(user1, 'token-1');

      let stored = JSON.parse(memoryStorage['agentap-auth']);
      expect(stored.state.user.id).toBe('u1');
      expect(stored.state.token).toBe('token-1');

      const user2 = makeUser({ id: 'u2', email: 'u2@test.com' });
      store.getState().setUser(user2, 'token-2');

      stored = JSON.parse(memoryStorage['agentap-auth']);
      expect(stored.state.user.id).toBe('u2');
      expect(stored.state.token).toBe('token-2');
    });
  });
});

// ---------------------------------------------------------------------------
// Type-level checks
// ---------------------------------------------------------------------------

describe('AuthState type interface', () => {
  it('should expose all expected action methods', () => {
    const state = useAuthStore.getState();

    expect(typeof state.setUser).toBe('function');
    expect(typeof state.setLoading).toBe('function');
    expect(typeof state.setError).toBe('function');
    expect(typeof state.setTwoFactorPending).toBe('function');
    expect(typeof state.logout).toBe('function');
  });

  it('should expose all expected state properties', () => {
    const state = useAuthStore.getState();

    expect(state).toHaveProperty('user');
    expect(state).toHaveProperty('token');
    expect(state).toHaveProperty('isAuthenticated');
    expect(state).toHaveProperty('isLoading');
    expect(state).toHaveProperty('error');
    expect(state).toHaveProperty('twoFactorPending');
  });
});

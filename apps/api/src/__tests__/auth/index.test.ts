import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks for better-auth and drizzle (must be before source import) ---

const mockGetSession = vi.fn();

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({
    api: {
      getSession: mockGetSession,
      signOut: vi.fn(),
    },
    handler: vi.fn(),
  })),
}));

vi.mock('better-auth/plugins', () => ({
  twoFactor: vi.fn(() => ({})),
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(),
}));

vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(),
}));

vi.mock('../../db/schema', () => ({}));

import { betterAuth } from 'better-auth';
import {
  createAuth,
  validateSessionWithCache,
  invalidateCachedSession,
  type CachedSession,
} from '../../auth/index';
import type { Env } from '../../types';

// --- Helpers ---

function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, format?: string) => {
      const val = store.get(key);
      if (!val) return null;
      return format === 'json' ? JSON.parse(val) : val;
    }),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    SESSION_KV: {} as KVNamespace,
    CACHE_KV: {} as KVNamespace,
    API_URL: 'http://localhost:8787',
    WEB_URL: 'http://localhost:3001',
    MOBILE_SCHEME: 'agentap://',
    AUTH_SECRET: 'test-secret-that-is-32-chars-long!!',
    CLOUDFLARE_ACCOUNT_ID: 'test',
    CLOUDFLARE_API_TOKEN: 'test',
    CLOUDFLARE_ZONE_ID: 'test',
    TUNNEL_DOMAIN: 'tunnel.test.dev',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    GOOGLE_CLIENT_ID: 'g-id',
    GOOGLE_CLIENT_SECRET: 'g-secret',
    APPLE_CLIENT_ID: 'a-id',
    APPLE_CLIENT_SECRET: 'a-secret',
    ...overrides,
  };
}

const sampleUser = {
  id: 'user-abc',
  email: 'alice@example.com',
  name: 'Alice',
  avatarUrl: null,
  twoFactorEnabled: false,
};

// --- Tests ---

describe('createAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls betterAuth and returns an auth instance', () => {
    const env = createMockEnv();
    const auth = createAuth(env);

    expect(betterAuth).toHaveBeenCalledOnce();
    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();
    expect(auth.api.getSession).toBeDefined();
  });

  it('passes geo data through to betterAuth config (databaseHooks)', () => {
    const env = createMockEnv();
    const geo = { city: 'Denver', region: 'CO', country: 'US' };
    createAuth(env, geo);

    // betterAuth should have been called with a config that includes databaseHooks
    const config = vi.mocked(betterAuth).mock.calls[0][0];
    expect(config.databaseHooks).toBeDefined();
    expect(config.databaseHooks!.session).toBeDefined();
  });

  it('creates auth without geo data', () => {
    const env = createMockEnv();
    const auth = createAuth(env);

    // Should still succeed without geo
    expect(auth).toBeDefined();
    const config = vi.mocked(betterAuth).mock.calls[0][0];
    expect(config.databaseHooks).toBeDefined();
  });
});

describe('validateSessionWithCache', () => {
  let kv: ReturnType<typeof createMockKV>;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(() => {
    vi.clearAllMocks();
    kv = createMockKV();
    auth = createAuth(createMockEnv());
    // Reset Date.now mock if used
    vi.restoreAllMocks();
    // Re-create auth after restoreAllMocks since it resets mocks
    kv = createMockKV();
    auth = createAuth(createMockEnv());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached user when KV has a valid (non-expired) entry', async () => {
    const expiresAt = Date.now() + 60_000; // 60s from now
    const cached: CachedSession = {
      userId: sampleUser.id,
      user: sampleUser,
      expiresAt,
    };
    kv._store.set('session:tok-123', JSON.stringify(cached));

    const result = await validateSessionWithCache(auth, 'tok-123', kv);

    expect(result.user).toEqual(sampleUser);
    expect(result.session).toEqual({
      id: 'tok-123',
      expiresAt: new Date(expiresAt),
    });
    // Should NOT have called better-auth
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('falls back to better-auth when KV returns null (cache miss)', async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-1', expiresAt },
      user: {
        id: sampleUser.id,
        email: sampleUser.email,
        name: sampleUser.name,
        avatarUrl: null,
        twoFactorEnabled: false,
      },
    });

    const result = await validateSessionWithCache(auth, 'tok-miss', kv);

    expect(mockGetSession).toHaveBeenCalledOnce();
    expect(result.user).toEqual(sampleUser);
    expect(result.session).toEqual({
      id: 'sess-1',
      expiresAt: new Date(expiresAt),
    });
  });

  it('falls back to better-auth when KV entry is expired', async () => {
    const expired: CachedSession = {
      userId: sampleUser.id,
      user: sampleUser,
      expiresAt: Date.now() - 10_000, // expired 10s ago
    };
    kv._store.set('session:tok-expired', JSON.stringify(expired));

    const freshExpiry = new Date(Date.now() + 600_000).toISOString();
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-fresh', expiresAt: freshExpiry },
      user: {
        id: 'user-fresh',
        email: 'fresh@example.com',
        name: 'Fresh',
        avatarUrl: 'https://avatar.url/fresh.png',
        twoFactorEnabled: true,
      },
    });

    const result = await validateSessionWithCache(auth, 'tok-expired', kv);

    expect(mockGetSession).toHaveBeenCalledOnce();
    expect(result.user!.id).toBe('user-fresh');
    expect(result.user!.email).toBe('fresh@example.com');
    expect(result.user!.avatarUrl).toBe('https://avatar.url/fresh.png');
    expect(result.user!.twoFactorEnabled).toBe(true);
  });

  it('caches a valid session in KV after fetching from better-auth', async () => {
    const expiresAt = new Date(Date.now() + 120_000).toISOString(); // 120s from now
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-new', expiresAt },
      user: {
        id: sampleUser.id,
        email: sampleUser.email,
        name: sampleUser.name,
      },
    });

    await validateSessionWithCache(auth, 'tok-new', kv);

    // KV.put should have been called
    expect(kv.put).toHaveBeenCalledOnce();
    const [putKey, putValue, putOpts] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putKey).toBe('session:tok-new');

    const parsed = JSON.parse(putValue as string) as CachedSession;
    expect(parsed.userId).toBe(sampleUser.id);
    expect(parsed.user.email).toBe(sampleUser.email);
    expect(parsed.expiresAt).toBe(new Date(expiresAt).getTime());

    // TTL should be min(ttlSeconds, 300)
    const expectedTtl = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    expect((putOpts as { expirationTtl: number }).expirationTtl).toBe(Math.min(expectedTtl, 300));
  });

  it('returns null user and session for invalid session (better-auth returns null)', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const result = await validateSessionWithCache(auth, 'tok-invalid', kv);

    expect(result.user).toBeNull();
    expect(result.session).toBeNull();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('returns null user and session when better-auth returns partial data (no user)', async () => {
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-x', expiresAt: new Date().toISOString() },
      user: null,
    });

    const result = await validateSessionWithCache(auth, 'tok-no-user', kv);

    expect(result.user).toBeNull();
    expect(result.session).toBeNull();
  });

  it('does not cache session when TTL is 0 or negative', async () => {
    // Session that has already expired according to better-auth
    const expiresAt = new Date(Date.now() - 1000).toISOString(); // 1s in the past
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-expired', expiresAt },
      user: {
        id: sampleUser.id,
        email: sampleUser.email,
        name: sampleUser.name,
      },
    });

    const result = await validateSessionWithCache(auth, 'tok-zero-ttl', kv);

    // Should still return the user data
    expect(result.user).toBeDefined();
    expect(result.user!.id).toBe(sampleUser.id);
    // But should NOT cache since TTL <= 0
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('uses min(ttlSeconds, 300) for KV cache TTL - caps at 300', async () => {
    // Session expiring in 10 minutes (600s) - should be capped to 300
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-long', expiresAt },
      user: {
        id: sampleUser.id,
        email: sampleUser.email,
        name: sampleUser.name,
      },
    });

    await validateSessionWithCache(auth, 'tok-long', kv);

    const [, , putOpts] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((putOpts as { expirationTtl: number }).expirationTtl).toBe(300);
  });

  it('uses actual TTL when less than 300 seconds', async () => {
    // Session expiring in 60 seconds - should use 60, not 300
    const now = Date.now();
    const expiresAt = new Date(now + 60_000).toISOString();
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-short', expiresAt },
      user: {
        id: sampleUser.id,
        email: sampleUser.email,
        name: sampleUser.name,
      },
    });

    await validateSessionWithCache(auth, 'tok-short', kv);

    const [, , putOpts] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const ttl = (putOpts as { expirationTtl: number }).expirationTtl;
    // Should be approximately 60 (allow 2s for test execution)
    expect(ttl).toBeGreaterThanOrEqual(58);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('passes session token in cookie header to better-auth', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    await validateSessionWithCache(auth, 'my-secret-token', kv);

    expect(mockGetSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });

    const headers = mockGetSession.mock.calls[0][0].headers as Headers;
    expect(headers.get('cookie')).toBe('better-auth.session_token=my-secret-token');
  });

  it('defaults avatarUrl to null and twoFactorEnabled to false when missing', async () => {
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-minimal', expiresAt },
      user: {
        id: 'user-minimal',
        email: 'minimal@example.com',
        name: null,
        // No avatarUrl or twoFactorEnabled fields
      },
    });

    const result = await validateSessionWithCache(auth, 'tok-minimal', kv);

    expect(result.user!.avatarUrl).toBeNull();
    expect(result.user!.twoFactorEnabled).toBe(false);
  });
});

describe('invalidateCachedSession', () => {
  it('deletes the session key from KV', async () => {
    const kv = createMockKV();
    kv._store.set('session:tok-bye', 'some-data');

    await invalidateCachedSession('tok-bye', kv);

    expect(kv.delete).toHaveBeenCalledWith('session:tok-bye');
    expect(kv._store.has('session:tok-bye')).toBe(false);
  });

  it('does not throw when key does not exist', async () => {
    const kv = createMockKV();

    await expect(invalidateCachedSession('tok-nonexistent', kv)).resolves.toBeUndefined();
    expect(kv.delete).toHaveBeenCalledWith('session:tok-nonexistent');
  });
});

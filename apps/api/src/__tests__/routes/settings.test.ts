import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

// ---------------------------------------------------------------------------
// Mock the requireAuth middleware so we can inject the user ourselves
// ---------------------------------------------------------------------------

vi.mock('../../middleware/auth', () => ({
  requireAuth: vi.fn((c: any, next: any) => next()),
}));

import settings from '../../routes/settings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER = { id: 'user-1', email: 'test@test.com', name: 'Test', avatarUrl: null };

function withUser(user: any) {
  return async (c: any, next: any) => {
    c.set('user', user);
    c.set('sessionId', 'test-session-id');
    await next();
  };
}

function createMockDB(overrides: Record<string, any> = {}) {
  const defaults = {
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
  };
  const merged = { ...defaults, ...overrides };
  const stmt: any = {
    bind: vi.fn().mockReturnThis(),
    first: merged.first,
    all: merged.all,
    run: merged.run,
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn().mockResolvedValue([]),
    _stmt: stmt,
  };
}

function createMockKV() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', withUser(TEST_USER));
  app.route('/settings', settings);
  return app;
}

function makeEnv(dbOverrides: Record<string, any> = {}) {
  return {
    DB: createMockDB(dbOverrides) as unknown as D1Database,
    SESSION_KV: createMockKV() as unknown as KVNamespace,
    CACHE_KV: createMockKV() as unknown as KVNamespace,
    API_URL: 'http://localhost:8787',
    WEB_URL: 'http://localhost:3001',
    MOBILE_SCHEME: 'agentap',
    AUTH_SECRET: 'test-secret-32-chars-long-enough-here',
    CLOUDFLARE_ACCOUNT_ID: '',
    CLOUDFLARE_API_TOKEN: '',
    CLOUDFLARE_ZONE_ID: '',
    TUNNEL_DOMAIN: '',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    APPLE_CLIENT_ID: '',
    APPLE_CLIENT_SECRET: '',
  } as unknown as Env;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings Routes', () => {
  beforeEach(() => vi.clearAllMocks());

  // ========================================================================
  // GET /settings/sessions
  // ========================================================================

  describe('GET /settings/sessions', () => {
    it('returns active sessions for the user', async () => {
      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'session-1',
              token: 'tok-abc',
              ip_address: '1.2.3.4',
              user_agent: 'Mozilla/5.0',
              city: 'NYC',
              region: 'NY',
              country: 'US',
              created_at: 1700000000,
              updated_at: 1700001000,
              expires_at: 9999999999,
            },
          ],
        }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/settings/sessions',
        {
          headers: { Cookie: 'better-auth.session_token=tok-abc' },
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('session-1');
      expect(data.sessions[0].isCurrent).toBe(true);
    });
  });

  // ========================================================================
  // POST /settings/sessions/revoke
  // ========================================================================

  describe('POST /settings/sessions/revoke', () => {
    it('returns 400 if sessionId is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/settings/sessions/revoke',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        env
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 if session not found or not owned by user', async () => {
      const env = makeEnv({ first: vi.fn().mockResolvedValue(null) });
      const app = createTestApp();

      const res = await app.request(
        '/settings/sessions/revoke',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: 'nope' }),
        },
        env
      );
      expect(res.status).toBe(404);
    });

    it('revokes a session and clears KV cache', async () => {
      const env = makeEnv({
        first: vi.fn().mockResolvedValue({ token: 'tok-del', user_id: 'user-1' }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/settings/sessions/revoke',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: 'session-x' }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify KV delete was called
      expect((env.SESSION_KV as any).delete).toHaveBeenCalledWith('session:tok-del');
    });
  });

  // ========================================================================
  // POST /settings/sessions/revoke-others
  // ========================================================================

  describe('POST /settings/sessions/revoke-others', () => {
    it('revokes all other sessions and clears their KV entries', async () => {
      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [{ token: 'other-tok-1' }, { token: 'other-tok-2' }],
        }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/settings/sessions/revoke-others',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'better-auth.session_token=current-tok',
          },
          body: '{}',
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect((env.SESSION_KV as any).delete).toHaveBeenCalledWith('session:other-tok-1');
      expect((env.SESSION_KV as any).delete).toHaveBeenCalledWith('session:other-tok-2');
    });
  });

  // ========================================================================
  // GET /settings/accounts
  // ========================================================================

  describe('GET /settings/accounts', () => {
    it('returns provider connection status', async () => {
      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'acc-1', provider_id: 'github', account_id: 'gh-123', created_at: 1700000000 },
          ],
        }),
      });
      const app = createTestApp();

      const res = await app.request('/settings/accounts', {}, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.accounts).toHaveLength(3);

      const github = data.accounts.find((a: any) => a.provider === 'github');
      expect(github.connected).toBe(true);
      expect(github.accountId).toBe('gh-123');

      const google = data.accounts.find((a: any) => a.provider === 'google');
      expect(google.connected).toBe(false);
    });
  });

  // ========================================================================
  // POST /settings/accounts/disconnect
  // ========================================================================

  describe('POST /settings/accounts/disconnect', () => {
    it('returns 400 if providerId is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/settings/accounts/disconnect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        env
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 if trying to disconnect the last auth method', async () => {
      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [{ provider_id: 'github' }],
        }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/settings/accounts/disconnect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: 'github' }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('only authentication method');
    });

    it('disconnects an account when user has other auth methods', async () => {
      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [{ provider_id: 'github' }, { provider_id: 'credential' }],
        }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/settings/accounts/disconnect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: 'github' }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // ========================================================================
  // GET /settings/preferences
  // ========================================================================

  describe('GET /settings/preferences', () => {
    it('returns default preferences when none exist', async () => {
      const env = makeEnv({ first: vi.fn().mockResolvedValue(null) });
      const app = createTestApp();

      const res = await app.request('/settings/preferences', {}, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.preferences.autoApproveLow).toBe(false);
      expect(data.preferences.autoApproveCritical).toBe(false);
    });

    it('returns stored preferences', async () => {
      const env = makeEnv({
        first: vi.fn().mockResolvedValue({
          auto_approve_low: 1,
          auto_approve_medium: 0,
          auto_approve_high: 0,
          auto_approve_critical: 0,
        }),
      });
      const app = createTestApp();

      const res = await app.request('/settings/preferences', {}, env);
      const data = await res.json();
      expect(data.preferences.autoApproveLow).toBe(true);
      expect(data.preferences.autoApproveMedium).toBe(false);
    });
  });

  // ========================================================================
  // PUT /settings/preferences
  // ========================================================================

  describe('PUT /settings/preferences', () => {
    it('creates preferences when none exist (insert)', async () => {
      const env = makeEnv({ first: vi.fn().mockResolvedValue(null) });
      const app = createTestApp();

      const res = await app.request(
        '/settings/preferences',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoApproveLow: true, autoApproveMedium: false }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.preferences.autoApproveLow).toBe(true);
      expect(data.preferences.autoApproveMedium).toBe(false);
    });

    it('updates preferences when they already exist', async () => {
      const env = makeEnv({
        first: vi.fn().mockResolvedValue({ id: 'pref-1' }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/settings/preferences',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoApproveHigh: true }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.preferences.autoApproveHigh).toBe(true);
    });
  });

  // ========================================================================
  // POST /settings/delete-account
  // ========================================================================

  describe('POST /settings/delete-account', () => {
    it('deletes user data, clears KV caches, and returns success', async () => {
      const env = makeEnv({
        all: vi
          .fn()
          .mockResolvedValueOnce({ results: [{ token: 'tok-1' }] }) // sessions
          .mockResolvedValueOnce({ results: [{ id: 'machine-1' }] }), // machines
      });
      const app = createTestApp();

      const res = await app.request(
        '/settings/delete-account',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // batch should have been called with the bulk delete statements
      expect((env.DB as any).batch).toHaveBeenCalled();

      // KV cleanup
      expect((env.SESSION_KV as any).delete).toHaveBeenCalledWith('session:tok-1');
      expect((env.CACHE_KV as any).delete).toHaveBeenCalledWith('machine:machine-1');
    });
  });
});

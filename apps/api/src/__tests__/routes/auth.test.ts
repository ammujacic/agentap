import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

// ---------------------------------------------------------------------------
// Mock auth module before importing the route
// ---------------------------------------------------------------------------

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockHandler = vi
  .fn()
  .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

vi.mock('../../auth', () => ({
  createAuth: vi.fn(() => ({
    api: { signOut: mockSignOut },
    handler: mockHandler,
  })),
  invalidateCachedSession: vi.fn().mockResolvedValue(undefined),
}));

import auth from '../../routes/auth';
import { invalidateCachedSession } from '../../auth';

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

function withNoUser() {
  return async (c: any, next: any) => {
    c.set('user', null);
    c.set('sessionId', null);
    await next();
  };
}

function createMockDB() {
  const stmt: any = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn().mockResolvedValue([]),
  };
}

function createMockKV() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEnv() {
  return {
    DB: createMockDB() as unknown as D1Database,
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

describe('Auth Routes', () => {
  beforeEach(() => vi.clearAllMocks());

  // ========================================================================
  // GET /auth/me
  // ========================================================================

  describe('GET /auth/me', () => {
    it('returns user when authenticated', async () => {
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', withUser(TEST_USER));
      app.route('/auth', auth);

      const env = makeEnv();
      const res = await app.request('/auth/me', {}, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.user.id).toBe('user-1');
      expect(data.user.email).toBe('test@test.com');
    });

    it('returns 401 when not authenticated', async () => {
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', withNoUser());
      app.route('/auth', auth);

      const env = makeEnv();
      const res = await app.request('/auth/me', {}, env);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe('Not authenticated');
    });
  });

  // ========================================================================
  // POST /auth/logout
  // ========================================================================

  describe('POST /auth/logout', () => {
    it('logs out and invalidates KV cache when session exists', async () => {
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', withUser(TEST_USER));
      app.route('/auth', auth);

      const env = makeEnv();
      const res = await app.request(
        '/auth/logout',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Should have called signOut and invalidated cache
      expect(mockSignOut).toHaveBeenCalled();
      expect(invalidateCachedSession).toHaveBeenCalledWith('test-session-id', expect.anything());
    });

    it('returns success even when no session exists', async () => {
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', withNoUser());
      app.route('/auth', auth);

      const env = makeEnv();
      const res = await app.request(
        '/auth/logout',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Should NOT have called signOut since sessionId is null
      expect(mockSignOut).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Catch-all (forwards to Better Auth)
  // ========================================================================

  describe('catch-all auth routes', () => {
    it('forwards requests to Better Auth handler', async () => {
      mockHandler.mockResolvedValue(
        new Response(JSON.stringify({ token: 'abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', withNoUser());
      app.route('/auth', auth);

      const env = makeEnv();
      const res = await app.request(
        '/auth/sign-in/email',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@test.com', password: 'password123' }),
        },
        env
      );

      // The handler mock was invoked
      expect(mockHandler).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // Rate limiting
  // ========================================================================

  describe('rate limiting', () => {
    it('returns 429 when rate limit exceeded on sign-in', async () => {
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', withNoUser());
      app.route('/auth', auth);

      const env = makeEnv();
      // Simulate rate limit exceeded: current count is 10
      (env.CACHE_KV as any).get = vi.fn().mockResolvedValue(10);

      const res = await app.request(
        '/auth/sign-in/email',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ email: 'test@test.com', password: 'password123' }),
        },
        env
      );

      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toContain('Too many requests');
    });

    it('increments rate limit counter and forwards to handler', async () => {
      mockHandler.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', withNoUser());
      app.route('/auth', auth);

      const env = makeEnv();
      // Current count is under limit
      (env.CACHE_KV as any).get = vi.fn().mockResolvedValue(5);

      const res = await app.request(
        '/auth/sign-up/email',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ email: 'new@test.com', password: 'password123', name: 'New' }),
        },
        env
      );

      // Should have stored incremented counter
      expect((env.CACHE_KV as any).put).toHaveBeenCalledWith(
        'rate:auth:1.2.3.4',
        JSON.stringify(6),
        { expirationTtl: 60 }
      );

      expect(mockHandler).toHaveBeenCalled();
    });
  });
});

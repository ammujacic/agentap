import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

// --- Mocks ---

const mockCreateAuth = vi.fn(() => ({ api: { getSession: vi.fn() } }));
const mockValidateSessionWithCache = vi.fn();

vi.mock('../../auth', () => ({
  createAuth: (...args: unknown[]) => mockCreateAuth(...args),
  validateSessionWithCache: (...args: unknown[]) => mockValidateSessionWithCache(...args),
}));

import { authMiddleware, requireAuth } from '../../middleware/auth';

// --- Helpers ---

function createMockEnv(): Env {
  return {
    DB: {} as D1Database,
    SESSION_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as KVNamespace,
    CACHE_KV: {} as unknown as KVNamespace,
    API_URL: 'http://localhost:8787',
    WEB_URL: 'http://localhost:3001',
    MOBILE_SCHEME: 'agentap',
    AUTH_SECRET: 'test-secret-32-chars-long-enough',
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

const sampleUser = {
  id: 'user-abc',
  email: 'alice@example.com',
  name: 'Alice',
  avatarUrl: null,
  twoFactorEnabled: false,
};

// --- Tests ---

describe('authMiddleware', () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv();
  });

  it('sets user and sessionId to null when no session cookie is present', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);
    app.get('/test', (c) => c.json({ user: c.get('user'), sessionId: c.get('sessionId') }));

    const res = await app.request('/test', {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user).toBeNull();
    expect(body.sessionId).toBeNull();
    // Should not call validateSessionWithCache when no cookie
    expect(mockValidateSessionWithCache).not.toHaveBeenCalled();
  });

  it('sets user and sessionId when valid session cookie is present', async () => {
    mockValidateSessionWithCache.mockResolvedValueOnce({
      user: sampleUser,
      session: { id: 'sess-123', expiresAt: new Date() },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);
    app.get('/test', (c) => c.json({ user: c.get('user'), sessionId: c.get('sessionId') }));

    const res = await app.request(
      '/test',
      { headers: { Cookie: 'better-auth.session_token=valid-token' } },
      env
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user).toEqual(sampleUser);
    expect(body.sessionId).toBe('sess-123');
    expect(mockValidateSessionWithCache).toHaveBeenCalledOnce();
  });

  it('passes env to createAuth and SESSION_KV to validateSessionWithCache', async () => {
    mockValidateSessionWithCache.mockResolvedValueOnce({
      user: sampleUser,
      session: { id: 'sess-x', expiresAt: new Date() },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);
    app.get('/test', (c) => c.json({ ok: true }));

    await app.request('/test', { headers: { Cookie: 'better-auth.session_token=tok' } }, env);

    // createAuth should receive the env
    expect(mockCreateAuth).toHaveBeenCalledWith(env);
    // validateSessionWithCache should receive auth instance, token, and SESSION_KV
    expect(mockValidateSessionWithCache).toHaveBeenCalledWith(
      expect.anything(), // auth instance
      'tok',
      env.SESSION_KV
    );
  });

  it('sets user to null when validateSessionWithCache returns null user', async () => {
    mockValidateSessionWithCache.mockResolvedValueOnce({
      user: null,
      session: null,
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);
    app.get('/test', (c) => c.json({ user: c.get('user'), sessionId: c.get('sessionId') }));

    const res = await app.request(
      '/test',
      { headers: { Cookie: 'better-auth.session_token=invalid-token' } },
      env
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user).toBeNull();
    expect(body.sessionId).toBeNull();
  });

  it('calls next() allowing downstream handlers to execute', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);

    const handlerSpy = vi.fn();
    app.get('/test', (c) => {
      handlerSpy();
      return c.json({ ok: true });
    });

    await app.request('/test', {}, env);

    expect(handlerSpy).toHaveBeenCalledOnce();
  });

  it('sets sessionId to null when session object is null (via optional chaining)', async () => {
    mockValidateSessionWithCache.mockResolvedValueOnce({
      user: sampleUser,
      session: null, // session is null but user returned
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);
    app.get('/test', (c) => c.json({ user: c.get('user'), sessionId: c.get('sessionId') }));

    const res = await app.request(
      '/test',
      { headers: { Cookie: 'better-auth.session_token=some-token' } },
      env
    );
    const body = await res.json();

    expect(body.user).toEqual(sampleUser);
    expect(body.sessionId).toBeNull();
  });
});

describe('requireAuth', () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv();
  });

  it('returns 401 with error message when user is not set', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    // authMiddleware sets user to null (no cookie), then requireAuth rejects
    app.use('*', authMiddleware);
    app.use('*', requireAuth);
    app.get('/protected', (c) => c.json({ data: 'secret' }));

    const res = await app.request('/protected', {}, env);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('allows request through when user is authenticated', async () => {
    mockValidateSessionWithCache.mockResolvedValueOnce({
      user: sampleUser,
      session: { id: 'sess-ok', expiresAt: new Date() },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);
    app.use('*', requireAuth);
    app.get('/protected', (c) => c.json({ data: 'secret', userId: c.get('user')?.id }));

    const res = await app.request(
      '/protected',
      { headers: { Cookie: 'better-auth.session_token=good-token' } },
      env
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBe('secret');
    expect(body.userId).toBe('user-abc');
  });

  it('returns 401 when session validation returns null user (invalid token)', async () => {
    mockValidateSessionWithCache.mockResolvedValueOnce({
      user: null,
      session: null,
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', authMiddleware);
    app.use('*', requireAuth);
    app.get('/protected', (c) => c.json({ data: 'secret' }));

    const res = await app.request(
      '/protected',
      { headers: { Cookie: 'better-auth.session_token=bad-token' } },
      env
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });
});

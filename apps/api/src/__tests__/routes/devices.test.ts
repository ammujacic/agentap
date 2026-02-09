import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

import devices from '../../routes/devices';

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
  };
}

function createMockKV() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
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

function createTestApp(authenticated = true) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', authenticated ? withUser(TEST_USER) : withNoUser());
  app.route('/devices', devices);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Devices Routes', () => {
  beforeEach(() => vi.clearAllMocks());

  // ========================================================================
  // POST /devices/register
  // ========================================================================

  describe('POST /devices/register', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request(
        '/devices/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pushToken: 'ExponentPushToken[xxx]', type: 'ios' }),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 400 when pushToken or type is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/devices/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pushToken: '', type: '' }),
        },
        env
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid push token format', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/devices/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pushToken: 'invalid-token', type: 'ios' }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid push token');
    });

    it('returns 400 when push token is too long', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/devices/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pushToken: 'ExponentPushToken[' + 'x'.repeat(600) + ']',
            type: 'ios',
          }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('too long');
    });

    it('updates existing device with same push token', async () => {
      const env = makeEnv({
        first: vi.fn().mockResolvedValue({ id: 'existing-device' }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/devices/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pushToken: 'ExponentPushToken[abc123]',
            type: 'ios',
            name: 'iPhone',
          }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.device.id).toBe('existing-device');
    });

    it('registers a new device successfully', async () => {
      const env = makeEnv({ first: vi.fn().mockResolvedValue(null) });
      const app = createTestApp();

      const res = await app.request(
        '/devices/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pushToken: 'ExponentPushToken[xyz789]',
            type: 'android',
            name: 'Pixel',
          }),
        },
        env
      );
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.device.id).toBeTruthy();
    });
  });

  // ========================================================================
  // GET /devices
  // ========================================================================

  describe('GET /devices', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request('/devices', {}, env);
      expect(res.status).toBe(401);
    });

    it('returns list of devices', async () => {
      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'dev-1',
              name: 'iPhone',
              type: 'ios',
              push_token: 'ExponentPushToken[abc]',
              last_seen_at: 1700000000,
              created_at: 1699999000,
            },
          ],
        }),
      });
      const app = createTestApp();

      const res = await app.request('/devices', {}, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.devices).toHaveLength(1);
      expect(data.devices[0].id).toBe('dev-1');
      expect(data.devices[0].hasPushToken).toBe(true);
      expect(data.devices[0].lastSeenAt).toBeTruthy();
    });
  });

  // ========================================================================
  // DELETE /devices/:id
  // ========================================================================

  describe('DELETE /devices/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request('/devices/dev-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(401);
    });

    it('returns 404 when device not found', async () => {
      const env = makeEnv({
        run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      });
      const app = createTestApp();

      const res = await app.request('/devices/nonexistent', { method: 'DELETE' }, env);
      expect(res.status).toBe(404);
    });

    it('deletes a device successfully', async () => {
      const env = makeEnv({
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      });
      const app = createTestApp();

      const res = await app.request('/devices/dev-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('../../auth', () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: vi.fn() },
  })),
  validateSessionWithCache: vi.fn(),
}));

vi.mock('../../db/machines', () => ({
  verifyMachineSecret: vi.fn(),
}));

import daemon from '../../routes/daemon';
import { validateSessionWithCache } from '../../auth';
import { verifyMachineSecret } from '../../db/machines';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function createTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/daemon', daemon);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Daemon Routes', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /daemon/validate-token', () => {
    it('returns 400 when token or machineId is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/daemon/validate-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '', machineId: '' }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.valid).toBe(false);
    });

    it('returns 401 when Authorization header is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/daemon/validate-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'some-token', machineId: 'machine-1' }),
        },
        env
      );
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.valid).toBe(false);
      expect(data.error).toContain('Missing machine authorization');
    });

    it('returns 401 when machine secret is invalid', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: false, userId: null });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/daemon/validate-token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer bad-secret',
          },
          body: JSON.stringify({ token: 'some-token', machineId: 'machine-1' }),
        },
        env
      );
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.valid).toBe(false);
      expect(data.error).toContain('Invalid machine authorization');
    });

    it('returns valid: false when session token is invalid (no user)', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(validateSessionWithCache).mockResolvedValue({ user: null, session: null });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/daemon/validate-token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer good-secret',
          },
          body: JSON.stringify({ token: 'bad-session-token', machineId: 'machine-1' }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.valid).toBe(false);
    });

    it('returns valid: false when user does not own the machine', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-2' });
      vi.mocked(validateSessionWithCache).mockResolvedValue({
        user: {
          id: 'user-1',
          email: 'test@test.com',
          name: 'Test',
          avatarUrl: null,
          twoFactorEnabled: false,
        },
        session: { id: 'sess-1', expiresAt: new Date() },
      });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/daemon/validate-token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer good-secret',
          },
          body: JSON.stringify({ token: 'valid-session-token', machineId: 'machine-1' }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.valid).toBe(false);
    });

    it('returns valid: true and userId for valid token + matching ownership', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(validateSessionWithCache).mockResolvedValue({
        user: {
          id: 'user-1',
          email: 'test@test.com',
          name: 'Test',
          avatarUrl: null,
          twoFactorEnabled: false,
        },
        session: { id: 'sess-1', expiresAt: new Date() },
      });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/daemon/validate-token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer good-secret',
          },
          body: JSON.stringify({ token: 'valid-session-token', machineId: 'machine-1' }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.valid).toBe(true);
      expect(data.userId).toBe('user-1');
    });
  });
});

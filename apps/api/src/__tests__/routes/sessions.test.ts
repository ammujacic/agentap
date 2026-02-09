import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

// ---------------------------------------------------------------------------
// Mock external modules BEFORE importing the route
// ---------------------------------------------------------------------------

vi.mock('../../db/sessions', () => ({
  getUserSessions: vi.fn(),
  countUserSessions: vi.fn(),
  syncMachineSessions: vi.fn(),
}));

vi.mock('../../db/machines', () => ({
  verifyMachineSecret: vi.fn(),
}));

// The requireAuth middleware reads c.get('user'), so we skip its import and
// inject the user via our own middleware in the test app.
vi.mock('../../middleware/auth', () => ({
  requireAuth: vi.fn((c: any, next: any) => next()),
}));

import sessions from '../../routes/sessions';
import { getUserSessions, countUserSessions, syncMachineSessions } from '../../db/sessions';
import { verifyMachineSecret } from '../../db/machines';

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

/** Chainable D1-style prepare/bind/first/all/run mock */
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
  app.route('/sessions', sessions);
  return app;
}

function createMockEnv(dbOverrides: Record<string, any> = {}) {
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

describe('Sessions Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // GET /sessions — list sessions
  // ========================================================================

  describe('GET /sessions', () => {
    it('returns sessions with pagination metadata', async () => {
      const mockRows = [
        {
          id: 'sess-1',
          machine_id: 'machine-1',
          user_id: 'user-1',
          agent: 'claude-code',
          project_path: '/home/dev/project',
          project_name: 'my-project',
          status: 'active',
          last_message: 'Working on tests',
          last_activity_at: 1700000000,
          started_at: 1699999000,
          ended_at: null,
        },
      ];

      vi.mocked(getUserSessions).mockResolvedValue(mockRows);
      vi.mocked(countUserSessions).mockResolvedValue(1);

      const env = createMockEnv({
        first: vi.fn().mockResolvedValue({ count: 1, name: 'My Machine' }),
      });
      const app = createTestApp();

      const res = await app.request('/sessions', {}, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('sess-1');
      expect(data.sessions[0].machineName).toBe('My Machine');
      expect(data.sessions[0].status).toBe('active');
      expect(data.total).toBe(1);
      expect(data.limit).toBe(50);
      expect(data.offset).toBe(0);
    });

    it('applies query filters (status, machineId, search)', async () => {
      vi.mocked(getUserSessions).mockResolvedValue([]);
      vi.mocked(countUserSessions).mockResolvedValue(0);

      const env = createMockEnv({
        first: vi.fn().mockResolvedValue({ count: 0 }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/sessions?status=active&machineId=m-1&search=foo&limit=10&offset=5',
        {},
        env
      );
      expect(res.status).toBe(200);

      // getUserSessions should have been called with filters
      expect(getUserSessions).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        expect.objectContaining({
          status: 'active',
          machineId: 'm-1',
          search: 'foo',
          limit: 10,
          offset: 5,
        })
      );
    });

    it('clamps limit to 200 and offset to 0 minimum', async () => {
      vi.mocked(getUserSessions).mockResolvedValue([]);
      vi.mocked(countUserSessions).mockResolvedValue(0);

      const env = createMockEnv({
        first: vi.fn().mockResolvedValue({ count: 0 }),
      });
      const app = createTestApp();

      const res = await app.request('/sessions?limit=999&offset=-5', {}, env);
      const data = await res.json();

      expect(data.limit).toBe(200);
      expect(data.offset).toBe(0);
    });
  });

  // ========================================================================
  // GET /sessions/:id — single session
  // ========================================================================

  describe('GET /sessions/:id', () => {
    it('returns a session when found', async () => {
      const sessionRow = {
        id: 'sess-1',
        machine_id: 'machine-1',
        user_id: 'user-1',
        agent: 'claude-code',
        project_path: '/home/dev/project',
        project_name: 'my-project',
        status: 'active',
        last_message: 'Hello',
        last_activity_at: 1700000000,
        started_at: 1699999000,
        ended_at: null,
      };

      const firstMock = vi
        .fn()
        .mockResolvedValueOnce(sessionRow) // session query
        .mockResolvedValueOnce({ name: 'My Machine' }); // machine name query

      const env = createMockEnv({ first: firstMock });
      const app = createTestApp();

      const res = await app.request('/sessions/sess-1', {}, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.session.id).toBe('sess-1');
      expect(data.session.machineName).toBe('My Machine');
      expect(data.session.lastActivityAt).toBeTruthy();
    });

    it('returns 404 when session not found', async () => {
      const env = createMockEnv({ first: vi.fn().mockResolvedValue(null) });
      const app = createTestApp();

      const res = await app.request('/sessions/nonexistent', {}, env);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toBe('Session not found');
    });
  });

  // ========================================================================
  // POST /sessions/sync — daemon session sync
  // ========================================================================

  describe('POST /sessions/sync', () => {
    it('returns 400 when machineId or tunnelId is missing', async () => {
      const env = createMockEnv();
      const app = createTestApp();

      const res = await app.request(
        '/sessions/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId: '', tunnelId: '' }),
        },
        env
      );
      expect(res.status).toBe(400);
    });

    it('returns 401 when Authorization header is missing', async () => {
      const env = createMockEnv();
      const app = createTestApp();

      const res = await app.request(
        '/sessions/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId: 'machine-1', tunnelId: 'tunnel-1', sessions: [] }),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 when machine secret is invalid', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: false, userId: null });

      const env = createMockEnv();
      const app = createTestApp();

      const res = await app.request(
        '/sessions/sync',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer bad-secret',
          },
          body: JSON.stringify({ machineId: 'machine-1', tunnelId: 'tunnel-1', sessions: [] }),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 when machine is not found for the tunnel', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });

      const env = createMockEnv({ first: vi.fn().mockResolvedValue(null) });
      const app = createTestApp();

      const res = await app.request(
        '/sessions/sync',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify({ machineId: 'machine-1', tunnelId: 'tunnel-1', sessions: [] }),
        },
        env
      );
      expect(res.status).toBe(404);
    });

    it('syncs sessions successfully', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(syncMachineSessions).mockResolvedValue(undefined);

      const env = createMockEnv({
        first: vi.fn().mockResolvedValue({ id: 'machine-1', user_id: 'user-1' }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/sessions/sync',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify({
            machineId: 'machine-1',
            tunnelId: 'tunnel-1',
            sessions: [{ id: 'sess-1', agent: 'claude-code', status: 'active' }],
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(syncMachineSessions).toHaveBeenCalled();
    });
  });
});

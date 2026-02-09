import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('../../db/machines', () => ({
  verifyMachineSecret: vi.fn(),
}));

import notifications from '../../routes/notifications';
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
  app.route('/notifications', notifications);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Notifications Routes', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /notifications/approval', () => {
    const validBody = {
      machineId: 'machine-1',
      sessionId: 'sess-1',
      requestId: 'req-1',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      description: 'Run rm -rf',
      riskLevel: 'high',
    };

    it('returns 400 when required fields are missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/notifications/approval',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId: '', sessionId: '', toolCallId: '' }),
        },
        env
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when riskLevel is invalid', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/notifications/approval',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid',
          },
          body: JSON.stringify({ ...validBody, riskLevel: 'unknown' }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid riskLevel');
    });

    it('returns 401 when Authorization header is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/notifications/approval',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 when machine secret is invalid', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: false, userId: null });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/notifications/approval',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer bad-secret',
          },
          body: JSON.stringify(validBody),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns sent: 0 when user has no devices', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });
      const app = createTestApp();

      const res = await app.request(
        '/notifications/approval',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify(validBody),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sent).toBe(0);
    });

    it('sends push notifications successfully', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [
            { push_token: 'ExponentPushToken[token-1]' },
            { push_token: 'ExponentPushToken[token-2]' },
          ],
        }),
      });
      const app = createTestApp();

      // Mock global fetch for Expo push API
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

      const res = await app.request(
        '/notifications/approval',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify(validBody),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sent).toBe(2);

      // Verify fetch was called with Expo push API
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://exp.host/--/api/v2/push/send',
        expect.objectContaining({ method: 'POST' })
      );

      fetchSpy.mockRestore();
    });

    it('returns 502 when Expo push API fails', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [{ push_token: 'ExponentPushToken[token-1]' }],
        }),
      });
      const app = createTestApp();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('Server Error', { status: 500 }));

      const res = await app.request(
        '/notifications/approval',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify(validBody),
        },
        env
      );
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toContain('Push delivery failed');

      fetchSpy.mockRestore();
    });
  });
});

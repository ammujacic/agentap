import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

// ---------------------------------------------------------------------------
// Mock external modules BEFORE importing the route
// ---------------------------------------------------------------------------

vi.mock('../../db/machines', () => ({
  createLinkRequest: vi.fn(),
  linkMachine: vi.fn(),
  getUserMachines: vi.fn(),
  getMachine: vi.fn(),
  renameMachine: vi.fn(),
  deleteMachine: vi.fn(),
  updateMachineStatus: vi.fn(),
  updateMachineTunnel: vi.fn(),
  getLinkRequestStatus: vi.fn(),
  verifyMachineSecret: vi.fn(),
  cleanupExpiredLinkRequests: vi.fn(),
}));

vi.mock('../../db/sessions', () => ({
  syncMachineSessions: vi.fn(),
}));

vi.mock('../../services/cloudflare-tunnel', () => ({
  setupMachineTunnel: vi.fn(),
  teardownMachineTunnel: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: vi.fn((c: any, next: any) => next()),
}));

import machines from '../../routes/machines';
import {
  createLinkRequest,
  linkMachine,
  getUserMachines,
  getMachine,
  renameMachine,
  deleteMachine,
  updateMachineStatus,
  updateMachineTunnel,
  getLinkRequestStatus,
  verifyMachineSecret,
  cleanupExpiredLinkRequests,
} from '../../db/machines';
import { syncMachineSessions } from '../../db/sessions';
import { setupMachineTunnel, teardownMachineTunnel } from '../../services/cloudflare-tunnel';

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

function makeEnv(dbOverrides: Record<string, any> = {}, envOverrides: Record<string, any> = {}) {
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
    ...envOverrides,
  } as unknown as Env;
}

function createTestApp(authenticated = true) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', authenticated ? withUser(TEST_USER) : withNoUser());
  app.route('/machines', machines);
  return app;
}

/** Standard machine row as returned from D1 */
function makeMachineRow(overrides: Record<string, any> = {}) {
  return {
    id: 'machine-1',
    user_id: 'user-1',
    name: 'My Laptop',
    tunnel_id: 'tunnel-abc',
    os: 'darwin',
    arch: 'arm64',
    agents_detected: JSON.stringify(['claude-code']),
    is_online: 1,
    last_seen_at: 1700000000,
    created_at: 1699999000,
    tunnel_url: 'https://t-machine-1.tunnel.agentap.dev',
    cf_tunnel_id: 'cf-tunnel-123',
    tunnel_token: 'tunnel-token-abc',
    api_secret_hash: 'hashed-secret',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Machines Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // POST /machines/link-request
  // ========================================================================

  describe('POST /machines/link-request', () => {
    it('returns 400 when machineName is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/link-request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineName: '' }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Missing required fields');
    });

    it('returns 400 when machineName is too long', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/link-request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineName: 'x'.repeat(256) }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('too long');
    });

    it('creates a link request successfully', async () => {
      const expiresAt = new Date('2025-01-01T00:10:00Z');
      vi.mocked(createLinkRequest).mockResolvedValue({
        code: 'ABCD1234',
        expiresAt,
      });
      vi.mocked(cleanupExpiredLinkRequests).mockResolvedValue(0);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/link-request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            machineName: 'My Laptop',
            tunnelId: 'tunnel-123',
            os: 'darwin',
            arch: 'arm64',
            agentsDetected: ['claude-code'],
          }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('ABCD1234');
      expect(data.expiresAt).toBe(expiresAt.toISOString());

      expect(createLinkRequest).toHaveBeenCalledWith(expect.anything(), {
        tunnelId: 'tunnel-123',
        machineName: 'My Laptop',
        os: 'darwin',
        arch: 'arm64',
        agentsDetected: ['claude-code'],
      });
    });

    it('calls cleanupExpiredLinkRequests opportunistically', async () => {
      vi.mocked(createLinkRequest).mockResolvedValue({
        code: 'ABCD1234',
        expiresAt: new Date(),
      });
      vi.mocked(cleanupExpiredLinkRequests).mockResolvedValue(2);

      const env = makeEnv();
      const app = createTestApp();

      await app.request(
        '/machines/link-request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineName: 'Test Machine' }),
        },
        env
      );

      expect(cleanupExpiredLinkRequests).toHaveBeenCalled();
    });

    it('does not fail if cleanupExpiredLinkRequests throws', async () => {
      vi.mocked(createLinkRequest).mockResolvedValue({
        code: 'ABCD1234',
        expiresAt: new Date(),
      });
      vi.mocked(cleanupExpiredLinkRequests).mockRejectedValue(new Error('cleanup failed'));

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/link-request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineName: 'Test Machine' }),
        },
        env
      );

      // Should still succeed since cleanup is fire-and-forget
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // POST /machines/link
  // ========================================================================

  describe('POST /machines/link', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request(
        '/machines/link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'ABCD1234' }),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 400 when code is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: '' }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Missing link code');
    });

    it('returns 400 when link code is invalid or expired', async () => {
      vi.mocked(linkMachine).mockResolvedValue(null);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'INVALID' }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid or expired link code');
    });

    it('links a machine successfully without tunnel setup', async () => {
      const machine = makeMachineRow({ tunnel_url: null, cf_tunnel_id: null, tunnel_token: null });
      vi.mocked(linkMachine).mockResolvedValue({
        machine,
        apiSecret: 'msk_test-secret',
      });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'ABCD1234' }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.machine.id).toBe('machine-1');
      expect(data.machine.name).toBe('My Laptop');

      // Should have stored secret in KV
      const kv = env.CACHE_KV as unknown as ReturnType<typeof createMockKV>;
      expect(kv.put).toHaveBeenCalledWith(
        'machine-secret:machine-1',
        'msk_test-secret',
        expect.objectContaining({ expirationTtl: 60 * 15 })
      );

      // Should have stored machine status in KV
      expect(kv.put).toHaveBeenCalledWith(
        'machine:machine-1',
        expect.any(String),
        expect.objectContaining({ expirationTtl: 60 * 5 })
      );
    });

    it('sets up Cloudflare tunnel when credentials are configured', async () => {
      const machine = makeMachineRow({ tunnel_url: null, cf_tunnel_id: null, tunnel_token: null });
      vi.mocked(linkMachine).mockResolvedValue({
        machine,
        apiSecret: 'msk_test-secret',
      });
      vi.mocked(setupMachineTunnel).mockResolvedValue({
        cfTunnelId: 'cf-tun-1',
        tunnelToken: 'cf-token-1',
        tunnelUrl: 'https://t-machine-1.tunnel.agentap.dev',
      });
      vi.mocked(updateMachineTunnel).mockResolvedValue(undefined);

      const env = makeEnv(
        {},
        {
          CLOUDFLARE_ACCOUNT_ID: 'acc-id',
          CLOUDFLARE_API_TOKEN: 'api-token',
          CLOUDFLARE_ZONE_ID: 'zone-id',
          TUNNEL_DOMAIN: 'tunnel.agentap.dev',
        }
      );
      const app = createTestApp();

      const res = await app.request(
        '/machines/link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'ABCD1234' }),
        },
        env
      );
      expect(res.status).toBe(200);

      expect(setupMachineTunnel).toHaveBeenCalledWith(
        'acc-id',
        'api-token',
        'zone-id',
        'tunnel.agentap.dev',
        'machine-1'
      );
      expect(updateMachineTunnel).toHaveBeenCalledWith(expect.anything(), 'machine-1', {
        cfTunnelId: 'cf-tun-1',
        tunnelToken: 'cf-token-1',
        tunnelUrl: 'https://t-machine-1.tunnel.agentap.dev',
      });

      const data: any = await res.json();
      expect(data.machine.tunnelUrl).toBe('https://t-machine-1.tunnel.agentap.dev');
    });

    it('continues linking even if tunnel setup fails', async () => {
      const machine = makeMachineRow({ tunnel_url: null, cf_tunnel_id: null, tunnel_token: null });
      vi.mocked(linkMachine).mockResolvedValue({
        machine,
        apiSecret: 'msk_test-secret',
      });
      vi.mocked(setupMachineTunnel).mockRejectedValue(new Error('Tunnel creation failed'));

      const env = makeEnv(
        {},
        {
          CLOUDFLARE_ACCOUNT_ID: 'acc-id',
          CLOUDFLARE_API_TOKEN: 'api-token',
          CLOUDFLARE_ZONE_ID: 'zone-id',
          TUNNEL_DOMAIN: 'tunnel.agentap.dev',
        }
      );
      const app = createTestApp();

      const res = await app.request(
        '/machines/link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'ABCD1234' }),
        },
        env
      );

      // Should still succeed — tunnel is best-effort
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.machine.id).toBe('machine-1');
    });

    it('handles KV put failures gracefully', async () => {
      const machine = makeMachineRow();
      vi.mocked(linkMachine).mockResolvedValue({
        machine,
        apiSecret: 'msk_test-secret',
      });

      const mockKV = createMockKV();
      mockKV.put.mockRejectedValue(new Error('KV write failed'));

      const env = makeEnv();
      (env as any).CACHE_KV = mockKV;
      const app = createTestApp();

      const res = await app.request(
        '/machines/link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'ABCD1234' }),
        },
        env
      );

      // Should still succeed
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // GET /machines/link-status/:code
  // ========================================================================

  describe('GET /machines/link-status/:code', () => {
    it('returns linked: false when not yet linked', async () => {
      vi.mocked(getLinkRequestStatus).mockResolvedValue({ linked: false });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/link-status/ABCD1234', {}, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.linked).toBe(false);
    });

    it('returns linked: true with machine details when linked', async () => {
      vi.mocked(getLinkRequestStatus).mockResolvedValue({
        linked: true,
        machineId: 'machine-1',
        tunnelToken: 'tunnel-token-abc',
        tunnelUrl: 'https://t-machine-1.tunnel.agentap.dev',
        userId: 'user-1',
        apiSecret: 'msk_test-secret',
      });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/link-status/ABCD1234', {}, env);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.linked).toBe(true);
      expect(data.machineId).toBe('machine-1');
      expect(data.tunnelToken).toBe('tunnel-token-abc');
      expect(data.tunnelUrl).toBe('https://t-machine-1.tunnel.agentap.dev');
      expect(data.userId).toBe('user-1');
      expect(data.apiSecret).toBe('msk_test-secret');
    });

    it('passes CACHE_KV to getLinkRequestStatus', async () => {
      vi.mocked(getLinkRequestStatus).mockResolvedValue({ linked: false });

      const env = makeEnv();
      const app = createTestApp();

      await app.request('/machines/link-status/TESTCODE', {}, env);

      expect(getLinkRequestStatus).toHaveBeenCalledWith(
        expect.anything(), // DB
        'TESTCODE',
        expect.anything() // CACHE_KV
      );
    });
  });

  // ========================================================================
  // GET /machines — list machines
  // ========================================================================

  describe('GET /machines', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request('/machines', {}, env);
      expect(res.status).toBe(401);
    });

    it('returns empty list when user has no machines', async () => {
      vi.mocked(getUserMachines).mockResolvedValue([]);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines', {}, env);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.machines).toEqual([]);
    });

    it('returns machines with enriched data from KV', async () => {
      const machineRow = makeMachineRow();
      vi.mocked(getUserMachines).mockResolvedValue([machineRow as any]);

      const mockKV = createMockKV();
      mockKV.get.mockResolvedValue({ isOnline: true, lastSeen: 1700000500000 });

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({
          results: [{ machine_id: 'machine-1', count: 3 }],
        }),
      });
      (env as any).CACHE_KV = mockKV;
      const app = createTestApp();

      const res = await app.request('/machines', {}, env);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.machines).toHaveLength(1);
      expect(data.machines[0].id).toBe('machine-1');
      expect(data.machines[0].name).toBe('My Laptop');
      expect(data.machines[0].isOnline).toBe(true);
      expect(data.machines[0].agentsDetected).toEqual(['claude-code']);
      expect(data.machines[0].activeSessionCount).toBe(3);
    });

    it('returns activeSessionCount as 0 when no active sessions', async () => {
      const machineRow = makeMachineRow();
      vi.mocked(getUserMachines).mockResolvedValue([machineRow as any]);

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });
      const app = createTestApp();

      const res = await app.request('/machines', {}, env);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.machines[0].activeSessionCount).toBe(0);
    });

    it('returns isOnline: false when KV cache is empty', async () => {
      const machineRow = makeMachineRow();
      vi.mocked(getUserMachines).mockResolvedValue([machineRow as any]);

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });
      const app = createTestApp();

      const res = await app.request('/machines', {}, env);
      const data: any = await res.json();
      expect(data.machines[0].isOnline).toBe(false);
    });

    it('serializes agents_detected from JSON string', async () => {
      const machineRow = makeMachineRow({
        agents_detected: JSON.stringify(['claude-code', 'cursor']),
      });
      vi.mocked(getUserMachines).mockResolvedValue([machineRow as any]);

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });
      const app = createTestApp();

      const res = await app.request('/machines', {}, env);
      const data: any = await res.json();
      expect(data.machines[0].agentsDetected).toEqual(['claude-code', 'cursor']);
    });

    it('returns empty array for null agents_detected', async () => {
      const machineRow = makeMachineRow({ agents_detected: null });
      vi.mocked(getUserMachines).mockResolvedValue([machineRow as any]);

      const env = makeEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });
      const app = createTestApp();

      const res = await app.request('/machines', {}, env);
      const data: any = await res.json();
      expect(data.machines[0].agentsDetected).toEqual([]);
    });
  });

  // ========================================================================
  // GET /machines/:id — single machine
  // ========================================================================

  describe('GET /machines/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request('/machines/machine-1', {}, env);
      expect(res.status).toBe(401);
    });

    it('returns 404 when machine not found', async () => {
      vi.mocked(getMachine).mockResolvedValue(null);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/nonexistent', {}, env);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toBe('Machine not found');
    });

    it('returns machine with KV-enriched status', async () => {
      const machineRow = makeMachineRow();
      vi.mocked(getMachine).mockResolvedValue(machineRow as any);

      const mockKV = createMockKV();
      mockKV.get.mockResolvedValue({ isOnline: true, lastSeen: 1700000500000 });

      const env = makeEnv();
      (env as any).CACHE_KV = mockKV;
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', {}, env);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.machine.id).toBe('machine-1');
      expect(data.machine.name).toBe('My Laptop');
      expect(data.machine.isOnline).toBe(true);
      expect(data.machine.tunnelUrl).toBe('https://t-machine-1.tunnel.agentap.dev');
    });

    it('returns isOnline: false when KV cache miss', async () => {
      const machineRow = makeMachineRow();
      vi.mocked(getMachine).mockResolvedValue(machineRow as any);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', {}, env);
      const data: any = await res.json();
      expect(data.machine.isOnline).toBe(false);
    });

    it('verifies ownership by passing userId to getMachine', async () => {
      vi.mocked(getMachine).mockResolvedValue(null);

      const env = makeEnv();
      const app = createTestApp();

      await app.request('/machines/machine-1', {}, env);

      expect(getMachine).toHaveBeenCalledWith(expect.anything(), 'machine-1', 'user-1');
    });
  });

  // ========================================================================
  // PATCH /machines/:id — rename machine
  // ========================================================================

  describe('PATCH /machines/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request(
        '/machines/machine-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 400 when name is missing', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Name is required');
    });

    it('returns 400 when name is empty string', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '   ' }),
        },
        env
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when name is too long', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'x'.repeat(256) }),
        },
        env
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('too long');
    });

    it('returns 404 when machine not found', async () => {
      vi.mocked(renameMachine).mockResolvedValue(false);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/nonexistent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        },
        env
      );
      expect(res.status).toBe(404);
    });

    it('renames machine successfully', async () => {
      vi.mocked(renameMachine).mockResolvedValue(true);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '  New Name  ' }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Should trim the name
      expect(renameMachine).toHaveBeenCalledWith(
        expect.anything(),
        'machine-1',
        'user-1',
        'New Name'
      );
    });
  });

  // ========================================================================
  // DELETE /machines/:id
  // ========================================================================

  describe('DELETE /machines/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const env = makeEnv();
      const app = createTestApp(false);

      const res = await app.request('/machines/machine-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(401);
    });

    it('returns 404 when machine not found (getMachine returns null)', async () => {
      vi.mocked(getMachine).mockResolvedValue(null);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(404);
    });

    it('deletes machine successfully without tunnel cleanup', async () => {
      vi.mocked(getMachine).mockResolvedValue(makeMachineRow({ cf_tunnel_id: null }) as any);
      vi.mocked(deleteMachine).mockResolvedValue(true);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Should NOT call teardownMachineTunnel
      expect(teardownMachineTunnel).not.toHaveBeenCalled();

      // Should delete from KV
      const kv = env.CACHE_KV as unknown as ReturnType<typeof createMockKV>;
      expect(kv.delete).toHaveBeenCalledWith('machine:machine-1');
    });

    it('deletes machine with tunnel cleanup when CF credentials are configured', async () => {
      vi.mocked(getMachine).mockResolvedValue(makeMachineRow() as any);
      vi.mocked(deleteMachine).mockResolvedValue(true);
      vi.mocked(teardownMachineTunnel).mockResolvedValue(undefined);

      const env = makeEnv(
        {},
        {
          CLOUDFLARE_ACCOUNT_ID: 'acc-id',
          CLOUDFLARE_API_TOKEN: 'api-token',
          CLOUDFLARE_ZONE_ID: 'zone-id',
          TUNNEL_DOMAIN: 'tunnel.agentap.dev',
        }
      );
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(200);

      expect(teardownMachineTunnel).toHaveBeenCalledWith(
        'acc-id',
        'api-token',
        'zone-id',
        'tunnel.agentap.dev',
        'machine-1',
        'cf-tunnel-123'
      );
    });

    it('continues deletion even if tunnel teardown fails', async () => {
      vi.mocked(getMachine).mockResolvedValue(makeMachineRow() as any);
      vi.mocked(deleteMachine).mockResolvedValue(true);
      vi.mocked(teardownMachineTunnel).mockRejectedValue(new Error('Teardown failed'));

      const env = makeEnv(
        {},
        {
          CLOUDFLARE_ACCOUNT_ID: 'acc-id',
          CLOUDFLARE_API_TOKEN: 'api-token',
        }
      );
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('returns 404 if deleteMachine returns false', async () => {
      vi.mocked(getMachine).mockResolvedValue(makeMachineRow({ cf_tunnel_id: null }) as any);
      vi.mocked(deleteMachine).mockResolvedValue(false);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', { method: 'DELETE' }, env);
      expect(res.status).toBe(404);
    });

    it('handles KV delete failures gracefully', async () => {
      vi.mocked(getMachine).mockResolvedValue(makeMachineRow({ cf_tunnel_id: null }) as any);
      vi.mocked(deleteMachine).mockResolvedValue(true);

      const mockKV = createMockKV();
      mockKV.delete.mockRejectedValue(new Error('KV delete failed'));

      const env = makeEnv();
      (env as any).CACHE_KV = mockKV;
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', { method: 'DELETE' }, env);
      // Should still succeed
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // POST /machines/:id/heartbeat
  // ========================================================================

  describe('POST /machines/:id/heartbeat', () => {
    it('returns 401 when no Authorization header', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: false, userId: null });

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 when Authorization header is not Bearer', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic abc123',
          },
          body: JSON.stringify({}),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 when secret is empty after Bearer', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ',
          },
          body: JSON.stringify({}),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 when secret is too long (>256 chars)', async () => {
      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${'x'.repeat(257)}`,
          },
          body: JSON.stringify({}),
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
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer bad-secret',
          },
          body: JSON.stringify({}),
        },
        env
      );
      expect(res.status).toBe(401);
    });

    it('processes heartbeat successfully with basic payload', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(updateMachineStatus).mockResolvedValue(undefined);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify({
            tunnelId: 'tunnel-abc',
            agentsDetected: ['claude-code'],
          }),
        },
        env
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      expect(updateMachineStatus).toHaveBeenCalledWith(expect.anything(), 'machine-1', {
        isOnline: true,
        agentsDetected: ['claude-code'],
      });

      // Should update KV
      const kv = env.CACHE_KV as unknown as ReturnType<typeof createMockKV>;
      expect(kv.put).toHaveBeenCalledWith(
        'machine:machine-1',
        expect.stringContaining('"isOnline":true'),
        expect.objectContaining({ expirationTtl: 60 * 5 })
      );
    });

    it('updates tunnel_url when provided in heartbeat', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(updateMachineStatus).mockResolvedValue(undefined);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify({
            tunnelUrl: 'https://new-tunnel-url.example.com',
          }),
        },
        env
      );
      expect(res.status).toBe(200);

      // Should have called DB.prepare to update tunnel_url
      const db = env.DB as unknown as ReturnType<typeof createMockDB>;
      expect(db.prepare).toHaveBeenCalled();
    });

    it('syncs sessions when provided in heartbeat', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(updateMachineStatus).mockResolvedValue(undefined);
      vi.mocked(syncMachineSessions).mockResolvedValue(undefined);

      const env = makeEnv();
      const app = createTestApp();

      const sessions = [
        {
          id: 'sess-1',
          agent: 'claude-code',
          projectPath: '/home/dev/project',
          projectName: 'my-project',
          status: 'active',
          lastMessage: 'Working on tests',
          lastActivityAt: '2025-01-01T00:00:00Z',
          startedAt: '2024-12-31T23:00:00Z',
        },
      ];

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify({ sessions }),
        },
        env
      );
      expect(res.status).toBe(200);

      expect(syncMachineSessions).toHaveBeenCalledWith(
        expect.anything(),
        'machine-1',
        'user-1',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'sess-1',
            machineId: 'machine-1',
            userId: 'user-1',
            agent: 'claude-code',
            projectPath: '/home/dev/project',
            projectName: 'my-project',
            status: 'active',
            lastMessage: 'Working on tests',
          }),
        ])
      );
    });

    it('does not call syncMachineSessions when sessions is not provided', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(updateMachineStatus).mockResolvedValue(undefined);

      const env = makeEnv();
      const app = createTestApp();

      await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify({ tunnelId: 'tunnel-abc' }),
        },
        env
      );

      expect(syncMachineSessions).not.toHaveBeenCalled();
    });

    it('handles KV put failures gracefully during heartbeat', async () => {
      vi.mocked(verifyMachineSecret).mockResolvedValue({ valid: true, userId: 'user-1' });
      vi.mocked(updateMachineStatus).mockResolvedValue(undefined);

      const mockKV = createMockKV();
      mockKV.put.mockRejectedValue(new Error('KV write failed'));

      const env = makeEnv();
      (env as any).CACHE_KV = mockKV;
      const app = createTestApp();

      const res = await app.request(
        '/machines/machine-1/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-secret',
          },
          body: JSON.stringify({}),
        },
        env
      );

      // Should still succeed
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // serializeMachine helper (tested indirectly through GET endpoints)
  // ========================================================================

  describe('serializeMachine (via GET responses)', () => {
    it('converts timestamps to ISO strings', async () => {
      const machineRow = makeMachineRow({
        last_seen_at: 1700000000,
        created_at: 1699999000,
      });
      vi.mocked(getMachine).mockResolvedValue(machineRow as any);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', {}, env);
      const data: any = await res.json();

      expect(data.machine.createdAt).toBe(new Date(1699999000 * 1000).toISOString());
    });

    it('uses cached lastSeen over DB last_seen_at', async () => {
      const machineRow = makeMachineRow({ last_seen_at: 1700000000 });
      vi.mocked(getMachine).mockResolvedValue(machineRow as any);

      const cachedLastSeen = 1700001000000; // ms
      const mockKV = createMockKV();
      mockKV.get.mockResolvedValue({ isOnline: true, lastSeen: cachedLastSeen });

      const env = makeEnv();
      (env as any).CACHE_KV = mockKV;
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', {}, env);
      const data: any = await res.json();

      expect(data.machine.lastSeenAt).toBe(new Date(cachedLastSeen).toISOString());
    });

    it('returns lastSeenAt as null when both cache and DB are null', async () => {
      const machineRow = makeMachineRow({ last_seen_at: null });
      vi.mocked(getMachine).mockResolvedValue(machineRow as any);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', {}, env);
      const data: any = await res.json();

      expect(data.machine.lastSeenAt).toBeNull();
    });

    it('maps tunnelId and tunnelUrl correctly', async () => {
      const machineRow = makeMachineRow({
        tunnel_id: 'my-tunnel',
        tunnel_url: 'https://my-tunnel.example.com',
      });
      vi.mocked(getMachine).mockResolvedValue(machineRow as any);

      const env = makeEnv();
      const app = createTestApp();

      const res = await app.request('/machines/machine-1', {}, env);
      const data: any = await res.json();

      expect(data.machine.tunnelId).toBe('my-tunnel');
      expect(data.machine.tunnelUrl).toBe('https://my-tunnel.example.com');
    });
  });
});

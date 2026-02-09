import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  verifyMachineSecret,
  createLinkRequest,
  linkMachine,
  getUserMachines,
  getMachine,
  getMachineByTunnelId,
  updateMachineStatus,
  updateMachineTunnel,
  getLinkRequestStatus,
  renameMachine,
  deleteMachine,
  cleanupExpiredLinkRequests,
} from '../../db/machines';

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-nanoid-id'),
}));

// Mock crypto.subtle.digest to return a predictable hash
const MOCK_HASH_HEX = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const mockDigest = vi
  .fn()
  .mockResolvedValue(
    new Uint8Array(MOCK_HASH_HEX.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))).buffer
  );

// Mock crypto.getRandomValues to return predictable values
const mockGetRandomValues = vi.fn((arr: Uint8Array) => {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = i; // Deterministic values: 0,1,2,...
  }
  return arr;
});

vi.stubGlobal('crypto', {
  subtle: { digest: mockDigest },
  getRandomValues: mockGetRandomValues,
});

function createMockDB() {
  const mockFirst = vi.fn();
  const mockAll = vi.fn().mockResolvedValue({ results: [] });
  const mockRun = vi.fn().mockResolvedValue({ meta: { changes: 0 } });

  const stmtValue = {
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  } as Record<string, unknown>;

  // Lazy self-reference so .bind(...).bind(...) works without infinite recursion
  const mockBind = vi.fn().mockReturnValue(stmtValue);
  stmtValue.bind = mockBind;

  const mockPrepare = vi.fn().mockReturnValue({
    bind: mockBind,
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  });
  const mockBatch = vi.fn().mockResolvedValue([]);

  return {
    prepare: mockPrepare,
    batch: mockBatch,
    _mockFirst: mockFirst,
    _mockAll: mockAll,
    _mockRun: mockRun,
    _mockBind: mockBind,
    _mockPrepare: mockPrepare,
  } as unknown as D1Database & {
    _mockFirst: ReturnType<typeof vi.fn>;
    _mockAll: ReturnType<typeof vi.fn>;
    _mockRun: ReturnType<typeof vi.fn>;
    _mockBind: ReturnType<typeof vi.fn>;
    _mockPrepare: ReturnType<typeof vi.fn>;
  };
}

describe('machines database operations', () => {
  let db: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
    db = createMockDB();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── verifyMachineSecret ───────────────────────────────────────────

  describe('verifyMachineSecret', () => {
    it('returns valid with userId when hash matches', async () => {
      db._mockFirst.mockResolvedValueOnce({
        user_id: 'user-1',
        api_secret_hash: MOCK_HASH_HEX,
      });

      const result = await verifyMachineSecret(
        db as unknown as D1Database,
        'machine-1',
        'any-secret'
      );

      expect(result).toEqual({ valid: true, userId: 'user-1' });
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT user_id, api_secret_hash FROM machines WHERE id = ?'
      );
    });

    it('returns invalid when machine not found', async () => {
      db._mockFirst.mockResolvedValueOnce(null);

      const result = await verifyMachineSecret(
        db as unknown as D1Database,
        'nonexistent',
        'secret'
      );

      expect(result).toEqual({ valid: false, userId: null });
    });

    it('returns invalid when api_secret_hash is null', async () => {
      db._mockFirst.mockResolvedValueOnce({
        user_id: 'user-1',
        api_secret_hash: null,
      });

      const result = await verifyMachineSecret(db as unknown as D1Database, 'machine-1', 'secret');

      expect(result).toEqual({ valid: false, userId: null });
    });

    it('returns invalid when hash does not match', async () => {
      db._mockFirst.mockResolvedValueOnce({
        user_id: 'user-1',
        api_secret_hash: 'different-hash-value',
      });

      const result = await verifyMachineSecret(
        db as unknown as D1Database,
        'machine-1',
        'wrong-secret'
      );

      expect(result).toEqual({ valid: false, userId: null });
    });
  });

  // ─── createLinkRequest ─────────────────────────────────────────────

  describe('createLinkRequest', () => {
    it('inserts with correct fields and returns code and expiresAt', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      const result = await createLinkRequest(db as unknown as D1Database, {
        machineName: 'My Laptop',
        os: 'darwin',
        arch: 'arm64',
        agentsDetected: ['claude-code'],
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBe(8);
      expect(result.expiresAt).toBeInstanceOf(Date);

      const nowSec = Math.floor(Date.now() / 1000);
      const expectedExpiry = new Date((nowSec + 10 * 60) * 1000);
      expect(result.expiresAt.getTime()).toBe(expectedExpiry.getTime());

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO machine_link_requests')
      );
    });

    it('generates a tunnel_id with nanoid when tunnelId not provided', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await createLinkRequest(db as unknown as D1Database, {
        machineName: 'My Laptop',
      });

      // The bind call should include `local-mock-nanoid-id` as tunnelId
      const bindCall = db._mockBind.mock.calls[0];
      expect(bindCall[1]).toBe('local-mock-nanoid-id');
    });
  });

  // ─── linkMachine ───────────────────────────────────────────────────

  describe('linkMachine', () => {
    it('returns null when code is expired or not found', async () => {
      db._mockFirst.mockResolvedValueOnce(null);

      const result = await linkMachine(db as unknown as D1Database, {
        code: 'ABCD1234',
        userId: 'user-1',
      });

      expect(result).toBeNull();
    });

    it('creates a new machine with correct data', async () => {
      // First .first() -> link request found
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'Work PC',
          os: 'linux',
          arch: 'x64',
          agents_detected: '["claude-code"]',
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: null,
        })
        // Second .first() -> no existing machine for this tunnel
        .mockResolvedValueOnce(null);

      db._mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const result = await linkMachine(db as unknown as D1Database, {
        code: 'ABCD1234',
        userId: 'user-1',
      });

      expect(result).not.toBeNull();
      expect(result!.machine.user_id).toBe('user-1');
      expect(result!.machine.name).toBe('Work PC');
      expect(result!.machine.tunnel_id).toBe('tunnel-1');
      expect(result!.machine.is_online).toBe(1);
      expect(result!.apiSecret).toMatch(/^msk_/);
    });

    it('returns machine and apiSecret on successful link', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'Work PC',
          os: 'linux',
          arch: 'x64',
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: null,
        })
        .mockResolvedValueOnce(null);

      db._mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const result = await linkMachine(db as unknown as D1Database, {
        code: 'abcd1234',
        userId: 'user-1',
      });

      expect(result).not.toBeNull();
      expect(result!.apiSecret).toBeDefined();
      expect(result!.apiSecret.startsWith('msk_')).toBe(true);
      expect(result!.machine.id).toBe('mock-nanoid-id');
    });

    it('re-links existing machine owned by the same user', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'Work PC',
          os: 'linux',
          arch: 'x64',
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: null,
        })
        .mockResolvedValueOnce({
          id: 'existing-machine',
          user_id: 'user-1',
          name: 'Work PC',
          tunnel_id: 'tunnel-1',
          os: 'linux',
          arch: 'x64',
          agents_detected: null,
          is_online: 0,
          last_seen_at: null,
          created_at: 1000,
          tunnel_url: null,
          cf_tunnel_id: null,
          tunnel_token: null,
          api_secret_hash: 'old-hash',
        });

      db._mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const result = await linkMachine(db as unknown as D1Database, {
        code: 'ABCD1234',
        userId: 'user-1',
      });

      expect(result).not.toBeNull();
      expect(result!.machine.id).toBe('existing-machine');
      expect(result!.machine.user_id).toBe('user-1');
      expect(result!.apiSecret).toMatch(/^msk_/);
    });

    it('rejects when machine is owned by a different user', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'Work PC',
          os: 'linux',
          arch: 'x64',
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: null,
        })
        .mockResolvedValueOnce({
          id: 'existing-machine',
          user_id: 'other-user',
          name: 'Work PC',
          tunnel_id: 'tunnel-1',
          os: 'linux',
          arch: 'x64',
          agents_detected: null,
          is_online: 1,
          last_seen_at: 1000,
          created_at: 1000,
          tunnel_url: null,
          cf_tunnel_id: null,
          tunnel_token: null,
          api_secret_hash: 'hash',
        });

      const result = await linkMachine(db as unknown as D1Database, {
        code: 'ABCD1234',
        userId: 'user-1',
      });

      expect(result).toBeNull();
    });

    it('marks link request as claimed after new machine creation', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'Work PC',
          os: 'linux',
          arch: 'x64',
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: null,
        })
        .mockResolvedValueOnce(null);

      db._mockRun.mockResolvedValue({ meta: { changes: 1 } });

      await linkMachine(db as unknown as D1Database, {
        code: 'ABCD1234',
        userId: 'user-1',
      });

      // Should have called prepare for: SELECT link_request, SELECT existing machine, INSERT machine, UPDATE link_request
      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE machine_link_requests SET machine_id = ? WHERE code = ?'
      );
    });
  });

  // ─── getUserMachines ───────────────────────────────────────────────

  describe('getUserMachines', () => {
    it('returns machines array', async () => {
      const machines = [
        { id: 'machine-1', user_id: 'user-1', name: 'PC 1' },
        { id: 'machine-2', user_id: 'user-1', name: 'PC 2' },
      ];
      db._mockAll.mockResolvedValueOnce({ results: machines });

      const result = await getUserMachines(db as unknown as D1Database, 'user-1');

      expect(result).toEqual(machines);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM machines WHERE user_id = ? ORDER BY last_seen_at DESC'
      );
    });

    it('returns empty array when no machines', async () => {
      db._mockAll.mockResolvedValueOnce({ results: [] });

      const result = await getUserMachines(db as unknown as D1Database, 'user-1');

      expect(result).toEqual([]);
    });
  });

  // ─── getMachine ────────────────────────────────────────────────────

  describe('getMachine', () => {
    it('returns machine by id and userId', async () => {
      const machine = { id: 'machine-1', user_id: 'user-1', name: 'My PC' };
      db._mockFirst.mockResolvedValueOnce(machine);

      const result = await getMachine(db as unknown as D1Database, 'machine-1', 'user-1');

      expect(result).toEqual(machine);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM machines WHERE id = ? AND user_id = ?'
      );
    });

    it('returns null when not found', async () => {
      db._mockFirst.mockResolvedValueOnce(null);

      const result = await getMachine(db as unknown as D1Database, 'nonexistent', 'user-1');

      expect(result).toBeNull();
    });
  });

  // ─── getMachineByTunnelId ──────────────────────────────────────────

  describe('getMachineByTunnelId', () => {
    it('returns machine by tunnelId', async () => {
      const machine = { id: 'machine-1', tunnel_id: 'tunnel-abc' };
      db._mockFirst.mockResolvedValueOnce(machine);

      const result = await getMachineByTunnelId(db as unknown as D1Database, 'tunnel-abc');

      expect(result).toEqual(machine);
      expect(db.prepare).toHaveBeenCalledWith('SELECT * FROM machines WHERE tunnel_id = ?');
    });

    it('returns null when not found', async () => {
      db._mockFirst.mockResolvedValueOnce(null);

      const result = await getMachineByTunnelId(db as unknown as D1Database, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── updateMachineStatus ───────────────────────────────────────────

  describe('updateMachineStatus', () => {
    it('updates isOnline and agentsDetected', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateMachineStatus(db as unknown as D1Database, 'machine-1', {
        isOnline: true,
        agentsDetected: ['claude-code'],
      });

      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE machines SET'));
      // Verify the SQL contains is_online and agents_detected
      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('last_seen_at = ?');
      expect(sql).toContain('is_online = ?');
      expect(sql).toContain('agents_detected = ?');
    });

    it('builds dynamic SET clause with only isOnline', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateMachineStatus(db as unknown as D1Database, 'machine-1', {
        isOnline: false,
      });

      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('is_online = ?');
      expect(sql).not.toContain('agents_detected');
    });

    it('updates only last_seen_at when no status fields provided', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateMachineStatus(db as unknown as D1Database, 'machine-1', {});

      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('last_seen_at = ?');
      expect(sql).not.toContain('is_online');
      expect(sql).not.toContain('agents_detected');
    });
  });

  // ─── updateMachineTunnel ───────────────────────────────────────────

  describe('updateMachineTunnel', () => {
    it('updates tunnel fields', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateMachineTunnel(db as unknown as D1Database, 'machine-1', {
        tunnelUrl: 'https://tunnel.example.com',
        cfTunnelId: 'cf-tunnel-123',
        tunnelToken: 'token-abc',
      });

      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE machines SET tunnel_url = ?, cf_tunnel_id = ?, tunnel_token = ? WHERE id = ?'
      );
    });
  });

  // ─── getLinkRequestStatus ──────────────────────────────────────────

  describe('getLinkRequestStatus', () => {
    it('returns linked:false for expired/not found request', async () => {
      db._mockFirst.mockResolvedValueOnce(null);

      const result = await getLinkRequestStatus(db as unknown as D1Database, 'EXPIRED1');

      expect(result).toEqual({ linked: false });
    });

    it('returns linked:false when request has no machine_id (not yet claimed)', async () => {
      db._mockFirst.mockResolvedValueOnce({
        code: 'ABCD1234',
        tunnel_id: 'tunnel-1',
        machine_name: 'PC',
        os: null,
        arch: null,
        agents_detected: null,
        expires_at: Math.floor(Date.now() / 1000) + 600,
        created_at: Math.floor(Date.now() / 1000),
        machine_id: null,
      });

      const result = await getLinkRequestStatus(db as unknown as D1Database, 'ABCD1234');

      expect(result).toEqual({ linked: false });
    });

    it('returns linked:true with machine data when claimed', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'PC',
          os: null,
          arch: null,
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: 'machine-1',
        })
        .mockResolvedValueOnce({
          id: 'machine-1',
          user_id: 'user-1',
          name: 'PC',
          tunnel_id: 'tunnel-1',
          os: null,
          arch: null,
          agents_detected: null,
          is_online: 1,
          last_seen_at: 1000,
          created_at: 1000,
          tunnel_url: 'https://tunnel.example.com',
          cf_tunnel_id: 'cf-1',
          tunnel_token: 'token-1',
          api_secret_hash: 'hash',
        });

      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      const result = await getLinkRequestStatus(db as unknown as D1Database, 'ABCD1234');

      expect(result).toEqual({
        linked: true,
        machineId: 'machine-1',
        tunnelToken: 'token-1',
        tunnelUrl: 'https://tunnel.example.com',
        userId: 'user-1',
        apiSecret: null,
      });
    });

    it('retrieves and deletes KV secret when KV namespace provided', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'PC',
          os: null,
          arch: null,
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: 'machine-1',
        })
        .mockResolvedValueOnce({
          id: 'machine-1',
          user_id: 'user-1',
          name: 'PC',
          tunnel_id: 'tunnel-1',
          os: null,
          arch: null,
          agents_detected: null,
          is_online: 1,
          last_seen_at: 1000,
          created_at: 1000,
          tunnel_url: null,
          cf_tunnel_id: null,
          tunnel_token: null,
          api_secret_hash: 'hash',
        });

      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      const mockKV = {
        get: vi.fn().mockResolvedValue('msk_secret123'),
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;

      const result = await getLinkRequestStatus(db as unknown as D1Database, 'ABCD1234', mockKV);

      expect(result).toEqual({
        linked: true,
        machineId: 'machine-1',
        tunnelToken: null,
        tunnelUrl: null,
        userId: 'user-1',
        apiSecret: 'msk_secret123',
      });

      expect(mockKV.get).toHaveBeenCalledWith('machine-secret:machine-1');
      expect(mockKV.delete).toHaveBeenCalledWith('machine-secret:machine-1');
    });

    it('handles no KV namespace gracefully (apiSecret is null)', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'PC',
          os: null,
          arch: null,
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: 'machine-1',
        })
        .mockResolvedValueOnce({
          id: 'machine-1',
          user_id: 'user-1',
          name: 'PC',
          tunnel_id: 'tunnel-1',
          os: null,
          arch: null,
          agents_detected: null,
          is_online: 1,
          last_seen_at: 1000,
          created_at: 1000,
          tunnel_url: null,
          cf_tunnel_id: null,
          tunnel_token: null,
          api_secret_hash: 'hash',
        });

      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      const result = await getLinkRequestStatus(db as unknown as D1Database, 'ABCD1234');

      if (result.linked) {
        expect(result.apiSecret).toBeNull();
      }
    });

    it('returns linked:false when machine lookup fails after claimed request', async () => {
      db._mockFirst
        .mockResolvedValueOnce({
          code: 'ABCD1234',
          tunnel_id: 'tunnel-1',
          machine_name: 'PC',
          os: null,
          arch: null,
          agents_detected: null,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          created_at: Math.floor(Date.now() / 1000),
          machine_id: 'machine-1',
        })
        .mockResolvedValueOnce(null); // Machine not found despite being referenced

      const result = await getLinkRequestStatus(db as unknown as D1Database, 'ABCD1234');

      expect(result).toEqual({ linked: false });
    });
  });

  // ─── renameMachine ─────────────────────────────────────────────────

  describe('renameMachine', () => {
    it('returns true on successful update', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      const result = await renameMachine(
        db as unknown as D1Database,
        'machine-1',
        'user-1',
        'New Name'
      );

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE machines SET name = ? WHERE id = ? AND user_id = ?'
      );
    });

    it('returns false when machine not found', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 0 } });

      const result = await renameMachine(
        db as unknown as D1Database,
        'nonexistent',
        'user-1',
        'Name'
      );

      expect(result).toBe(false);
    });
  });

  // ─── deleteMachine ─────────────────────────────────────────────────

  describe('deleteMachine', () => {
    it('returns true on successful delete', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      const result = await deleteMachine(db as unknown as D1Database, 'machine-1', 'user-1');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith('DELETE FROM machines WHERE id = ? AND user_id = ?');
    });

    it('returns false when machine not found', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 0 } });

      const result = await deleteMachine(db as unknown as D1Database, 'nonexistent', 'user-1');

      expect(result).toBe(false);
    });
  });

  // ─── cleanupExpiredLinkRequests ────────────────────────────────────

  describe('cleanupExpiredLinkRequests', () => {
    it('returns changes count', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 5 } });

      const result = await cleanupExpiredLinkRequests(db as unknown as D1Database);

      expect(result).toBe(5);
      expect(db.prepare).toHaveBeenCalledWith(
        'DELETE FROM machine_link_requests WHERE expires_at < ?'
      );
    });

    it('returns 0 when no expired requests', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 0 } });

      const result = await cleanupExpiredLinkRequests(db as unknown as D1Database);

      expect(result).toBe(0);
    });
  });
});

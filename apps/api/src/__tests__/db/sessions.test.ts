import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  upsertAgentSession,
  syncMachineSessions,
  getUserSessions,
  countUserSessions,
} from '../../db/sessions';
import type { UpsertSessionInput } from '../../db/sessions';

/**
 * Creates a chainable D1Database mock where prepare().bind().first/all/run
 * are all individually controllable.
 */
function createMockDB() {
  const mockFirst = vi.fn();
  const mockAll = vi.fn().mockResolvedValue({ results: [] });
  const mockRun = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
  const mockBind = vi.fn(function (this: any) {
    return { first: mockFirst, all: mockAll, run: mockRun };
  });
  const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
  const mockBatch = vi.fn().mockResolvedValue([]);

  return {
    prepare: mockPrepare,
    batch: mockBatch,
    _mockFirst: mockFirst,
    _mockAll: mockAll,
    _mockRun: mockRun,
    _mockBind: mockBind,
  } as any;
}

function makeSession(overrides: Partial<UpsertSessionInput> = {}): UpsertSessionInput {
  return {
    id: 'sess-1',
    machineId: 'machine-1',
    userId: 'user-1',
    agent: 'claude-code',
    status: 'active',
    ...overrides,
  };
}

describe('sessions', () => {
  let db: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    db = createMockDB();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── upsertAgentSession ──────────────────────────────────────────────

  describe('upsertAgentSession', () => {
    it('should insert a new session with correct SQL and bindings', async () => {
      const input = makeSession();
      await upsertAgentSession(db, input);

      expect(db.prepare).toHaveBeenCalledOnce();
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO agent_sessions');
      expect(sql).toContain('ON CONFLICT(id) DO UPDATE');

      // bind should have 11 arguments
      expect(db._mockBind).toHaveBeenCalledOnce();
      const args = db._mockBind.mock.calls[0];
      expect(args[0]).toBe('sess-1'); // id
      expect(args[1]).toBe('machine-1'); // machine_id
      expect(args[2]).toBe('user-1'); // user_id
      expect(args[3]).toBe('claude-code'); // agent
      expect(args[4]).toBeNull(); // projectPath (undefined -> null)
      expect(args[5]).toBeNull(); // projectName
      expect(args[6]).toBe('active'); // status
      expect(args[7]).toBeNull(); // lastMessage
    });

    it('should convert ISO lastActivityAt to unix timestamp', async () => {
      const input = makeSession({
        lastActivityAt: '2025-01-15T10:30:00Z',
      });
      await upsertAgentSession(db, input);

      const args = db._mockBind.mock.calls[0];
      // lastActivityAt should be unix timestamp for 2025-01-15T10:30:00Z
      const expected = Math.floor(new Date('2025-01-15T10:30:00Z').getTime() / 1000);
      expect(args[8]).toBe(expected);
    });

    it('should convert ISO startedAt to unix timestamp', async () => {
      const input = makeSession({
        startedAt: '2025-01-15T08:00:00Z',
      });
      await upsertAgentSession(db, input);

      const args = db._mockBind.mock.calls[0];
      const expected = Math.floor(new Date('2025-01-15T08:00:00Z').getTime() / 1000);
      expect(args[9]).toBe(expected);
    });

    it('should use current time as default for lastActivityAt and startedAt', async () => {
      const input = makeSession();
      await upsertAgentSession(db, input);

      const now = Math.floor(Date.now() / 1000);
      const args = db._mockBind.mock.calls[0];
      expect(args[8]).toBe(now); // lastActivityAt defaults to now
      expect(args[9]).toBe(now); // startedAt defaults to now
      expect(args[10]).toBe(now); // ended_at for completed/error case
    });
  });

  // ─── syncMachineSessions ─────────────────────────────────────────────

  describe('syncMachineSessions', () => {
    it('should mark all sessions as completed when sessions array is empty', async () => {
      await syncMachineSessions(db, 'machine-1', 'user-1', []);

      expect(db.prepare).toHaveBeenCalledOnce();
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("SET status = 'completed'");
      expect(sql).toContain('WHERE machine_id = ?');

      const now = Math.floor(Date.now() / 1000);
      expect(db._mockBind).toHaveBeenCalledWith(now, 'machine-1');
      expect(db._mockRun).toHaveBeenCalledOnce();
    });

    it('should batch upsert provided sessions', async () => {
      const sessions = [makeSession({ id: 'sess-1' }), makeSession({ id: 'sess-2' })];

      // Mock the existing sessions query to return no stale sessions
      db._mockAll.mockResolvedValue({ results: [{ id: 'sess-1' }, { id: 'sess-2' }] });

      await syncMachineSessions(db, 'machine-1', 'user-1', sessions);

      // prepare called for upsert statement + select existing
      expect(db.batch).toHaveBeenCalledOnce();
      // batch should receive 2 bound statements
      const batchArgs = db.batch.mock.calls[0][0];
      expect(batchArgs).toHaveLength(2);
    });

    it('should mark stale sessions as completed', async () => {
      const sessions = [makeSession({ id: 'sess-1' })];

      // Mock existing returns sess-1 (still active) and sess-OLD (stale)
      db._mockAll.mockResolvedValue({
        results: [{ id: 'sess-1' }, { id: 'sess-OLD' }],
      });

      await syncMachineSessions(db, 'machine-1', 'user-1', sessions);

      // batch called twice: once for upserts, once for completing stale sessions
      expect(db.batch).toHaveBeenCalledTimes(2);
    });

    it('should handle large batches by chunking to 80', async () => {
      // Create 90 sessions (should be split into chunks of 80 + 10)
      const sessions = Array.from({ length: 90 }, (_, i) => makeSession({ id: `sess-${i}` }));

      // Return all as existing so no stale marking needed
      db._mockAll.mockResolvedValue({
        results: sessions.map((s) => ({ id: s.id })),
      });

      await syncMachineSessions(db, 'machine-1', 'user-1', sessions);

      // batch should be called twice for upserts (80 + 10)
      expect(db.batch).toHaveBeenCalledTimes(2);
      const firstBatch = db.batch.mock.calls[0][0];
      const secondBatch = db.batch.mock.calls[1][0];
      expect(firstBatch).toHaveLength(80);
      expect(secondBatch).toHaveLength(10);
    });
  });

  // ─── getUserSessions ─────────────────────────────────────────────────

  describe('getUserSessions', () => {
    it('should return all sessions for a user', async () => {
      const mockRows = [
        {
          id: 'sess-1',
          machine_id: 'machine-1',
          user_id: 'user-1',
          agent: 'claude-code',
          status: 'active',
        },
      ];
      db._mockAll.mockResolvedValue({ results: mockRows });

      const result = await getUserSessions(db, 'user-1');

      expect(result).toEqual(mockRows);
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM agent_sessions WHERE user_id = ?');
      expect(sql).toContain('ORDER BY last_activity_at DESC');
    });

    it('should filter by status', async () => {
      db._mockAll.mockResolvedValue({ results: [] });

      await getUserSessions(db, 'user-1', { status: 'active' });

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('AND status = ?');
      expect(db._mockBind).toHaveBeenCalledWith('user-1', 'active');
    });

    it('should filter by machineId', async () => {
      db._mockAll.mockResolvedValue({ results: [] });

      await getUserSessions(db, 'user-1', { machineId: 'machine-1' });

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('AND machine_id = ?');
      expect(db._mockBind).toHaveBeenCalledWith('user-1', 'machine-1');
    });

    it('should filter by search term with SQL LIKE escaping', async () => {
      db._mockAll.mockResolvedValue({ results: [] });

      // Use special chars that need escaping: %, _, \
      await getUserSessions(db, 'user-1', { search: '100%_done\\' });

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("project_name LIKE ? ESCAPE '\\'");
      expect(sql).toContain("project_path LIKE ? ESCAPE '\\'");
      expect(sql).toContain("last_message LIKE ? ESCAPE '\\'");

      // The search term should be escaped: % -> \%, _ -> \_, \ -> \\
      const expectedTerm = '%100\\%\\_done\\\\%';
      expect(db._mockBind).toHaveBeenCalledWith('user-1', expectedTerm, expectedTerm, expectedTerm);
    });

    it('should apply limit and offset', async () => {
      db._mockAll.mockResolvedValue({ results: [] });

      await getUserSessions(db, 'user-1', { limit: 10, offset: 20 });

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT ?');
      expect(sql).toContain('OFFSET ?');
      expect(db._mockBind).toHaveBeenCalledWith('user-1', 10, 20);
    });

    it('should combine multiple filters', async () => {
      db._mockAll.mockResolvedValue({ results: [] });

      await getUserSessions(db, 'user-1', {
        status: 'active',
        machineId: 'machine-1',
        limit: 5,
        offset: 0,
      });

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('AND status = ?');
      expect(sql).toContain('AND machine_id = ?');
      // offset is 0 which is falsy, so OFFSET should NOT be added
      expect(sql).not.toContain('OFFSET ?');
    });
  });

  // ─── countUserSessions ───────────────────────────────────────────────

  describe('countUserSessions', () => {
    it('should count all sessions for a user', async () => {
      db._mockFirst.mockResolvedValue({ count: 42 });

      const count = await countUserSessions(db, 'user-1');

      expect(count).toBe(42);
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT COUNT(*) as count FROM agent_sessions WHERE user_id = ?');
    });

    it('should count with status filter', async () => {
      db._mockFirst.mockResolvedValue({ count: 5 });

      const count = await countUserSessions(db, 'user-1', { status: 'active' });

      expect(count).toBe(5);
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain('AND status = ?');
      expect(db._mockBind).toHaveBeenCalledWith('user-1', 'active');
    });

    it('should count with search filter', async () => {
      db._mockFirst.mockResolvedValue({ count: 3 });

      const count = await countUserSessions(db, 'user-1', { search: 'my-project' });

      expect(count).toBe(3);
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("project_name LIKE ? ESCAPE '\\'");
      const expectedTerm = '%my-project%';
      expect(db._mockBind).toHaveBeenCalledWith('user-1', expectedTerm, expectedTerm, expectedTerm);
    });

    it('should return 0 when first() returns null', async () => {
      db._mockFirst.mockResolvedValue(null);

      const count = await countUserSessions(db, 'user-1');

      expect(count).toBe(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findUserById, findUserByEmail, updateUser, deleteUser } from '../../db/users';

function createMockDB() {
  const mockFirst = vi.fn();
  const mockAll = vi.fn().mockResolvedValue({ results: [] });
  const mockRun = vi.fn().mockResolvedValue({ meta: { changes: 0 } });

  const stmtValue = {
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  } as Record<string, unknown>;

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

describe('users database operations', () => {
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

  // ─── findUserById ──────────────────────────────────────────────────

  describe('findUserById', () => {
    it('returns user when found', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        image: null,
        created_at: 1000,
        updated_at: 1000,
      };
      db._mockFirst.mockResolvedValueOnce(user);

      const result = await findUserById(db as unknown as D1Database, 'user-1');

      expect(result).toEqual(user);
      expect(db.prepare).toHaveBeenCalledWith('SELECT * FROM user WHERE id = ?');
    });

    it('returns null when user not found', async () => {
      db._mockFirst.mockResolvedValueOnce(null);

      const result = await findUserById(db as unknown as D1Database, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── findUserByEmail ───────────────────────────────────────────────

  describe('findUserByEmail', () => {
    it('returns user when found', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        image: null,
        created_at: 1000,
        updated_at: 1000,
      };
      db._mockFirst.mockResolvedValueOnce(user);

      const result = await findUserByEmail(db as unknown as D1Database, 'test@example.com');

      expect(result).toEqual(user);
      expect(db.prepare).toHaveBeenCalledWith('SELECT * FROM user WHERE email = ?');
    });

    it('returns null when user not found', async () => {
      db._mockFirst.mockResolvedValueOnce(null);

      const result = await findUserByEmail(db as unknown as D1Database, 'nobody@example.com');

      expect(result).toBeNull();
    });
  });

  // ─── updateUser ────────────────────────────────────────────────────

  describe('updateUser', () => {
    it('updates name only', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateUser(db as unknown as D1Database, 'user-1', { name: 'New Name' });

      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('name = ?');
      expect(sql).not.toContain('image = ?');
      expect(sql).toContain('updated_at = ?');
    });

    it('updates image only', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateUser(db as unknown as D1Database, 'user-1', {
        image: 'https://example.com/pic.jpg',
      });

      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('image = ?');
      expect(sql).not.toContain('name = ?');
      expect(sql).toContain('updated_at = ?');
    });

    it('updates both name and image', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateUser(db as unknown as D1Database, 'user-1', {
        name: 'New Name',
        image: 'https://example.com/pic.jpg',
      });

      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('name = ?');
      expect(sql).toContain('image = ?');
      expect(sql).toContain('updated_at = ?');
    });

    it('always includes updated_at even with empty updates', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await updateUser(db as unknown as D1Database, 'user-1', {});

      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('updated_at = ?');
      expect(sql).toContain('WHERE id = ?');
    });
  });

  // ─── deleteUser ────────────────────────────────────────────────────

  describe('deleteUser', () => {
    it('deletes user by userId', async () => {
      db._mockRun.mockResolvedValueOnce({ meta: { changes: 1 } });

      await deleteUser(db as unknown as D1Database, 'user-1');

      expect(db.prepare).toHaveBeenCalledWith('DELETE FROM user WHERE id = ?');
    });
  });
});

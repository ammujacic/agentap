/**
 * Agent session routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { getUserSessions, countUserSessions, syncMachineSessions } from '../db/sessions';
import { verifyMachineSecret } from '../db/machines';

const sessions = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================================
// List agent sessions for the current user
// ============================================================================

sessions.get('/', requireAuth, async (c) => {
  const user = c.get('user')!;
  const status = c.req.query('status');
  const machineId = c.req.query('machineId');
  const rawSearch = c.req.query('search');
  if (rawSearch && rawSearch.length > 100) {
    return c.json({ error: 'Search term too long (max 100 characters)' }, 400);
  }
  const search = rawSearch;
  const rawLimit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;
  const rawOffset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : 0;
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

  const filterOpts = {
    status: status || undefined,
    machineId: machineId || undefined,
    search: search || undefined,
  };

  const [rows, total] = await Promise.all([
    getUserSessions(c.env.DB, user.id, { ...filterOpts, limit, offset }),
    countUserSessions(c.env.DB, user.id, filterOpts),
  ]);

  // Count active sessions (not completed/error) for badge display
  let activeCountQuery = `SELECT COUNT(*) as count FROM agent_sessions WHERE user_id = ? AND status NOT IN ('completed', 'error')`;
  const activeParams: (string | number)[] = [user.id];
  if (filterOpts.machineId) {
    activeCountQuery += ' AND machine_id = ?';
    activeParams.push(filterOpts.machineId);
  }
  if (filterOpts.search) {
    activeCountQuery += ` AND (project_name LIKE ? ESCAPE '\\' OR project_path LIKE ? ESCAPE '\\' OR last_message LIKE ? ESCAPE '\\')`;
    const escaped = filterOpts.search.replace(/[%_\\]/g, '\\$&');
    const term = `%${escaped}%`;
    activeParams.push(term, term, term);
  }
  const activeResult = await c.env.DB.prepare(activeCountQuery)
    .bind(...activeParams)
    .first<{ count: number }>();
  const activeCount = activeResult?.count ?? 0;

  // Enrich with machine names from cache
  const machineNames = new Map<string, string>();
  for (const row of rows) {
    if (!machineNames.has(row.machine_id)) {
      const machine = await c.env.DB.prepare('SELECT name FROM machines WHERE id = ?')
        .bind(row.machine_id)
        .first<{ name: string }>();
      machineNames.set(row.machine_id, machine?.name ?? 'Unknown');
    }
  }

  const sessions = rows.map((row) => ({
    id: row.id,
    machineId: row.machine_id,
    machineName: machineNames.get(row.machine_id) ?? 'Unknown',
    agent: row.agent,
    projectPath: row.project_path,
    projectName: row.project_name,
    status: row.status,
    lastMessage: row.last_message,
    lastActivityAt: row.last_activity_at
      ? new Date(row.last_activity_at * 1000).toISOString()
      : null,
    startedAt: row.started_at ? new Date(row.started_at * 1000).toISOString() : null,
    endedAt: row.ended_at ? new Date(row.ended_at * 1000).toISOString() : null,
  }));

  return c.json({ sessions, total, activeCount, limit, offset });
});

// ============================================================================
// Get a single agent session by ID
// ============================================================================

sessions.get('/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM agent_sessions WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<{
      id: string;
      machine_id: string;
      user_id: string;
      agent: string;
      project_path: string | null;
      project_name: string | null;
      status: string;
      last_message: string | null;
      last_activity_at: number | null;
      started_at: number | null;
      ended_at: number | null;
    }>();

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const machine = await c.env.DB.prepare('SELECT name FROM machines WHERE id = ?')
    .bind(row.machine_id)
    .first<{ name: string }>();

  return c.json({
    session: {
      id: row.id,
      machineId: row.machine_id,
      machineName: machine?.name ?? 'Unknown',
      agent: row.agent,
      projectPath: row.project_path,
      projectName: row.project_name,
      status: row.status,
      lastMessage: row.last_message,
      lastActivityAt: row.last_activity_at
        ? new Date(row.last_activity_at * 1000).toISOString()
        : null,
      startedAt: row.started_at ? new Date(row.started_at * 1000).toISOString() : null,
      endedAt: row.ended_at ? new Date(row.ended_at * 1000).toISOString() : null,
    },
  });
});

// ============================================================================
// Sync sessions from daemon heartbeat
// ============================================================================

sessions.post('/sync', async (c) => {
  const body = await c.req.json<{
    machineId: string;
    tunnelId: string;
    sessions: Array<{
      id: string;
      agent: string;
      projectPath?: string;
      projectName?: string;
      status: string;
      lastMessage?: string;
      lastActivityAt?: string;
      startedAt?: string;
    }>;
  }>();

  if (!body.machineId || !body.tunnelId) {
    return c.json({ error: 'Missing machineId or tunnelId' }, 400);
  }

  // Authenticate machine via Bearer token
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const auth = await verifyMachineSecret(c.env.DB, body.machineId, authHeader.slice(7));
  if (!auth.valid) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Verify machine exists and get userId
  const machine = await c.env.DB.prepare(
    'SELECT id, user_id FROM machines WHERE id = ? AND tunnel_id = ?'
  )
    .bind(body.machineId, body.tunnelId)
    .first<{ id: string; user_id: string }>();

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  const sessions = Array.isArray(body.sessions) ? body.sessions : [];

  await syncMachineSessions(
    c.env.DB,
    machine.id,
    machine.user_id,
    sessions.map((s) => ({
      id: s.id,
      machineId: machine.id,
      userId: machine.user_id,
      agent: s.agent,
      projectPath: s.projectPath,
      projectName: s.projectName,
      status: s.status,
      lastMessage: s.lastMessage,
      lastActivityAt: s.lastActivityAt,
      startedAt: s.startedAt,
    }))
  );

  return c.json({ success: true });
});

export default sessions;

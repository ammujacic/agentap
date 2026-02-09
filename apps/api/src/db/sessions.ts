/**
 * Agent session database operations
 */

interface AgentSessionRow {
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
}

export interface UpsertSessionInput {
  id: string;
  machineId: string;
  userId: string;
  agent: string;
  projectPath?: string;
  projectName?: string;
  status: string;
  lastMessage?: string;
  lastActivityAt?: string;
  startedAt?: string;
}

/**
 * Upsert an agent session (create or update)
 * Called by the daemon heartbeat to report active sessions
 */
export async function upsertAgentSession(db: D1Database, input: UpsertSessionInput): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const lastActivityAt = input.lastActivityAt
    ? Math.floor(new Date(input.lastActivityAt).getTime() / 1000)
    : now;
  const startedAt = input.startedAt ? Math.floor(new Date(input.startedAt).getTime() / 1000) : now;

  await db
    .prepare(
      `INSERT INTO agent_sessions (id, machine_id, user_id, agent, project_path, project_name, status, last_message, last_activity_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         last_message = excluded.last_message,
         last_activity_at = excluded.last_activity_at,
         ended_at = CASE WHEN excluded.status IN ('completed', 'error') THEN ? ELSE ended_at END`
    )
    .bind(
      input.id,
      input.machineId,
      input.userId,
      input.agent,
      input.projectPath ?? null,
      input.projectName ?? null,
      input.status,
      input.lastMessage ?? null,
      lastActivityAt,
      startedAt,
      now
    )
    .run();
}

/**
 * Bulk sync sessions from a daemon heartbeat.
 * Marks any sessions for this machine that are NOT in the provided list as completed.
 */
export async function syncMachineSessions(
  db: D1Database,
  machineId: string,
  userId: string,
  sessions: UpsertSessionInput[]
): Promise<void> {
  if (sessions.length === 0) {
    // No active sessions: mark all running sessions for this machine as completed
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `UPDATE agent_sessions SET status = 'completed', ended_at = COALESCE(last_activity_at, ?)
         WHERE machine_id = ? AND status NOT IN ('completed', 'error')`
      )
      .bind(now, machineId)
      .run();
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // Batch upsert all active sessions using D1 batch API
  const upsertStmt = db.prepare(
    `INSERT INTO agent_sessions (id, machine_id, user_id, agent, project_path, project_name, status, last_message, last_activity_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       last_message = excluded.last_message,
       last_activity_at = excluded.last_activity_at,
       ended_at = CASE WHEN excluded.status IN ('completed', 'error') THEN ? ELSE ended_at END`
  );

  // D1 batch limit is ~100 statements; chunk to stay safe
  const BATCH_SIZE = 80;
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const chunk = sessions.slice(i, i + BATCH_SIZE);
    await db.batch(
      chunk.map((s) => {
        const lastActivityAt = s.lastActivityAt
          ? Math.floor(new Date(s.lastActivityAt).getTime() / 1000)
          : now;
        const startedAt = s.startedAt ? Math.floor(new Date(s.startedAt).getTime() / 1000) : now;
        return upsertStmt.bind(
          s.id,
          machineId,
          userId,
          s.agent,
          s.projectPath ?? null,
          s.projectName ?? null,
          s.status,
          s.lastMessage ?? null,
          lastActivityAt,
          startedAt,
          now
        );
      })
    );
  }

  // Mark sessions not in the active list as completed.
  // Use a temp approach to avoid too many SQL variables: select current active
  // IDs for this machine, then update ones not in the new set.
  const activeIdSet = new Set(sessions.map((s) => s.id));
  const existing = await db
    .prepare(
      `SELECT id FROM agent_sessions WHERE machine_id = ? AND status NOT IN ('completed', 'error')`
    )
    .bind(machineId)
    .all<{ id: string }>();

  const toComplete = (existing.results ?? [])
    .filter((row) => !activeIdSet.has(row.id))
    .map((row) => row.id);

  if (toComplete.length > 0) {
    // Use last_activity_at as ended_at so the timestamp reflects
    // the session's actual last activity, not when we marked it completed.
    const completeStmt = db.prepare(
      `UPDATE agent_sessions SET status = 'completed', ended_at = COALESCE(last_activity_at, ?) WHERE id = ?`
    );
    for (let i = 0; i < toComplete.length; i += BATCH_SIZE) {
      const chunk = toComplete.slice(i, i + BATCH_SIZE);
      await db.batch(chunk.map((id) => completeStmt.bind(now, id)));
    }
  }
}

/**
 * Get all sessions for a user, optionally filtered by status
 */
export async function getUserSessions(
  db: D1Database,
  userId: string,
  options?: {
    status?: string;
    machineId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }
): Promise<AgentSessionRow[]> {
  let query = 'SELECT * FROM agent_sessions WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (options?.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }

  if (options?.machineId) {
    query += ' AND machine_id = ?';
    params.push(options.machineId);
  }

  if (options?.search) {
    query += ` AND (project_name LIKE ? ESCAPE '\\' OR project_path LIKE ? ESCAPE '\\' OR last_message LIKE ? ESCAPE '\\')`;
    const escaped = options.search.replace(/[%_\\]/g, '\\$&');
    const term = `%${escaped}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY last_activity_at DESC';

  if (options?.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }

  const result = await db
    .prepare(query)
    .bind(...params)
    .all<AgentSessionRow>();

  return result.results ?? [];
}

/**
 * Count sessions for a user, with same filter options as getUserSessions
 */
export async function countUserSessions(
  db: D1Database,
  userId: string,
  options?: { status?: string; machineId?: string; search?: string }
): Promise<number> {
  let query = 'SELECT COUNT(*) as count FROM agent_sessions WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (options?.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }

  if (options?.machineId) {
    query += ' AND machine_id = ?';
    params.push(options.machineId);
  }

  if (options?.search) {
    query += ` AND (project_name LIKE ? ESCAPE '\\' OR project_path LIKE ? ESCAPE '\\' OR last_message LIKE ? ESCAPE '\\')`;
    const escaped = options.search.replace(/[%_\\]/g, '\\$&');
    const term = `%${escaped}%`;
    params.push(term, term, term);
  }

  const result = await db
    .prepare(query)
    .bind(...params)
    .first<{ count: number }>();

  return result?.count ?? 0;
}

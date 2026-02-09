/**
 * Settings routes - sessions, connected accounts, account deletion
 */

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';

const settings = new Hono<{ Bindings: Env; Variables: Variables }>();

// All settings routes require authentication
settings.use('*', requireAuth);

// ============================================================================
// Active Sessions
// ============================================================================

/**
 * List all active sessions for the current user
 */
settings.get('/sessions', async (c) => {
  const user = c.get('user')!;
  const currentToken = getCookie(c, 'better-auth.session_token');

  const now = Math.floor(Date.now() / 1000);
  const result = await c.env.DB.prepare(
    `SELECT id, token, ip_address, user_agent, city, region, country,
            created_at, updated_at, expires_at
     FROM session
     WHERE user_id = ? AND expires_at > ?
     ORDER BY updated_at DESC`
  )
    .bind(user.id, now)
    .all();

  const sessions = (result.results ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    ipAddress: s.ip_address as string | null,
    userAgent: s.user_agent as string | null,
    city: s.city as string | null,
    region: s.region as string | null,
    country: s.country as string | null,
    createdAt: s.created_at as number | null,
    updatedAt: s.updated_at as number | null,
    expiresAt: s.expires_at as number,
    isCurrent: (s.token as string) === currentToken,
  }));

  return c.json({ sessions });
});

/**
 * Revoke a specific session
 */
settings.post('/sessions/revoke', async (c) => {
  const user = c.get('user')!;
  const { sessionId } = await c.req.json<{ sessionId: string }>();

  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }

  // Verify session belongs to this user and get token for KV cleanup
  const session = await c.env.DB.prepare('SELECT token, user_id FROM session WHERE id = ?')
    .bind(sessionId)
    .first<{ token: string; user_id: string }>();

  if (!session || session.user_id !== user.id) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Delete the session
  await c.env.DB.prepare('DELETE FROM session WHERE id = ?').bind(sessionId).run();

  // Clear KV cache
  await c.env.SESSION_KV.delete(`session:${session.token}`);

  return c.json({ success: true });
});

/**
 * Revoke all sessions except the current one
 */
settings.post('/sessions/revoke-others', async (c) => {
  const user = c.get('user')!;
  const currentToken = getCookie(c, 'better-auth.session_token');

  // Get tokens of other sessions for KV cleanup
  const otherSessions = await c.env.DB.prepare(
    'SELECT token FROM session WHERE user_id = ? AND token != ?'
  )
    .bind(user.id, currentToken || '')
    .all();

  // Delete all other sessions
  await c.env.DB.prepare('DELETE FROM session WHERE user_id = ? AND token != ?')
    .bind(user.id, currentToken || '')
    .run();

  // Clear KV cache for revoked sessions
  await Promise.all(
    (otherSessions.results ?? []).map((s: Record<string, unknown>) =>
      c.env.SESSION_KV.delete(`session:${s.token as string}`)
    )
  );

  return c.json({ success: true });
});

// ============================================================================
// Connected Accounts (OAuth)
// ============================================================================

/**
 * List connected OAuth accounts for the current user
 */
settings.get('/accounts', async (c) => {
  const user = c.get('user')!;

  const result = await c.env.DB.prepare(
    `SELECT id, provider_id, account_id, created_at
     FROM account
     WHERE user_id = ? AND provider_id != 'credential'`
  )
    .bind(user.id)
    .all();

  // Build response showing all supported providers
  const providers = ['github', 'google', 'apple'] as const;
  const accounts = providers.map((provider) => {
    const linked = (result.results ?? []).find(
      (a: Record<string, unknown>) => a.provider_id === provider
    );
    return {
      provider,
      connected: !!linked,
      accountId: (linked?.account_id as string) || null,
      createdAt: (linked?.created_at as number) || null,
    };
  });

  return c.json({ accounts });
});

/**
 * Disconnect an OAuth account
 */
settings.post('/accounts/disconnect', async (c) => {
  const user = c.get('user')!;
  const { providerId } = await c.req.json<{ providerId: string }>();

  if (!providerId) {
    return c.json({ error: 'providerId is required' }, 400);
  }

  // Check that user has at least one other auth method
  const allAccounts = await c.env.DB.prepare('SELECT provider_id FROM account WHERE user_id = ?')
    .bind(user.id)
    .all();

  const remaining = (allAccounts.results ?? []).filter(
    (a: Record<string, unknown>) => a.provider_id !== providerId
  );
  if (remaining.length === 0) {
    return c.json({ error: 'Cannot disconnect your only authentication method' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM account WHERE user_id = ? AND provider_id = ?')
    .bind(user.id, providerId)
    .run();

  return c.json({ success: true });
});

// ============================================================================
// Preferences (Auto-Approve)
// ============================================================================

/**
 * Get user preferences
 */
settings.get('/preferences', async (c) => {
  const user = c.get('user')!;

  const row = await c.env.DB.prepare(
    `SELECT auto_approve_low, auto_approve_medium, auto_approve_high, auto_approve_critical
     FROM user_preferences
     WHERE user_id = ?`
  )
    .bind(user.id)
    .first<Record<string, unknown>>();

  const preferences = {
    autoApproveLow: row ? Boolean(row.auto_approve_low) : false,
    autoApproveMedium: row ? Boolean(row.auto_approve_medium) : false,
    autoApproveHigh: row ? Boolean(row.auto_approve_high) : false,
    autoApproveCritical: row ? Boolean(row.auto_approve_critical) : false,
  };

  return c.json({ preferences });
});

/**
 * Update user preferences (upsert)
 */
settings.put('/preferences', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{
    autoApproveLow?: boolean;
    autoApproveMedium?: boolean;
    autoApproveHigh?: boolean;
    autoApproveCritical?: boolean;
  }>();

  const now = Math.floor(Date.now() / 1000);

  const existing = await c.env.DB.prepare('SELECT id FROM user_preferences WHERE user_id = ?')
    .bind(user.id)
    .first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE user_preferences
       SET auto_approve_low = ?,
           auto_approve_medium = ?,
           auto_approve_high = ?,
           auto_approve_critical = ?,
           updated_at = ?
       WHERE user_id = ?`
    )
      .bind(
        body.autoApproveLow ? 1 : 0,
        body.autoApproveMedium ? 1 : 0,
        body.autoApproveHigh ? 1 : 0,
        body.autoApproveCritical ? 1 : 0,
        now,
        user.id
      )
      .run();
  } else {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO user_preferences (id, user_id, auto_approve_low, auto_approve_medium, auto_approve_high, auto_approve_critical, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        user.id,
        body.autoApproveLow ? 1 : 0,
        body.autoApproveMedium ? 1 : 0,
        body.autoApproveHigh ? 1 : 0,
        body.autoApproveCritical ? 1 : 0,
        now,
        now
      )
      .run();
  }

  return c.json({
    preferences: {
      autoApproveLow: Boolean(body.autoApproveLow),
      autoApproveMedium: Boolean(body.autoApproveMedium),
      autoApproveHigh: Boolean(body.autoApproveHigh),
      autoApproveCritical: Boolean(body.autoApproveCritical),
    },
  });
});

// ============================================================================
// Account Deletion
// ============================================================================

/**
 * Delete the current user's account and all associated data
 */
settings.post('/delete-account', async (c) => {
  const user = c.get('user')!;

  // Get all session tokens for KV cleanup
  const sessions = await c.env.DB.prepare('SELECT token FROM session WHERE user_id = ?')
    .bind(user.id)
    .all();

  // Get machine IDs for cache cleanup
  const userMachines = await c.env.DB.prepare('SELECT id FROM machines WHERE user_id = ?')
    .bind(user.id)
    .all();

  // Delete all user data in batches
  // Custom tables first, then auth tables, then user
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM user_preferences WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM devices WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM machines WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM twoFactor WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM account WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM user WHERE id = ?').bind(user.id),
  ]);

  // Clear KV cache for all sessions and machines
  await Promise.all([
    ...(sessions.results ?? []).map((s: Record<string, unknown>) =>
      c.env.SESSION_KV.delete(`session:${s.token as string}`)
    ),
    ...(userMachines.results ?? []).map((m: Record<string, unknown>) =>
      c.env.CACHE_KV.delete(`machine:${m.id as string}`)
    ),
  ]);

  return c.json({ success: true });
});

export default settings;

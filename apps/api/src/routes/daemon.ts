/**
 * Daemon-facing routes (token validation, etc.)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createAuth, validateSessionWithCache } from '../auth';
import { verifyMachineSecret } from '../db/machines';

const daemon = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================================
// Validate a session token (called by daemon for WebSocket auth)
// Requires machine Bearer token for authentication.
// ============================================================================

daemon.post('/validate-token', async (c) => {
  const body = await c.req.json<{
    token: string;
    machineId: string;
  }>();

  if (!body.token || !body.machineId) {
    return c.json({ valid: false }, 400);
  }

  // Authenticate the daemon via machine Bearer token
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ valid: false, error: 'Missing machine authorization' }, 401);
  }

  const machineAuth = await verifyMachineSecret(c.env.DB, body.machineId, authHeader.slice(7));
  if (!machineAuth.valid) {
    return c.json({ valid: false, error: 'Invalid machine authorization' }, 401);
  }

  // Validate the Better Auth session token (user connecting via WebSocket).
  // The token may be a full cookie value (token.signature) or just the short
  // token returned in the sign-in JSON response (used by mobile apps).
  const auth = createAuth(c.env);
  let user: { id: string } | null = null;

  // Try full cookie token first (includes signature)
  const cached = await validateSessionWithCache(auth, body.token, c.env.SESSION_KV);
  user = cached.user;

  if (!user) {
    return c.json({ valid: false });
  }

  // Verify the user owns this machine
  if (machineAuth.userId !== user.id) {
    return c.json({ valid: false });
  }

  return c.json({ valid: true, userId: user.id });
});

export default daemon;

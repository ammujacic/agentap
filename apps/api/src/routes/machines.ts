/**
 * Machine management routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { syncMachineSessions } from '../db/sessions';
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
} from '../db/machines';
import { setupMachineTunnel, teardownMachineTunnel } from '../services/cloudflare-tunnel';

const machines = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Extract and verify machine Bearer token from Authorization header.
 * Returns { machineId, userId } on success, or null on failure.
 */
async function authenticateMachine(
  db: D1Database,
  machineId: string,
  authHeader: string | undefined
): Promise<{ valid: true; userId: string } | { valid: false }> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false };
  }

  const secret = authHeader.slice(7);
  if (!secret || secret.length > 256) {
    return { valid: false };
  }

  return verifyMachineSecret(db, machineId, secret) as Promise<
    { valid: true; userId: string } | { valid: false }
  >;
}

/**
 * Helper to serialize a machine for API responses
 */
function serializeMachine(
  machine: {
    id: string;
    name: string;
    tunnel_id: string;
    os: string | null;
    arch: string | null;
    agents_detected: string | null;
    is_online: number;
    last_seen_at: number | null;
    created_at: number;
    tunnel_url: string | null;
  },
  cached?: { isOnline: boolean; lastSeen: number } | null
) {
  return {
    id: machine.id,
    name: machine.name,
    tunnelId: machine.tunnel_id,
    tunnelUrl: machine.tunnel_url,
    os: machine.os,
    arch: machine.arch,
    agentsDetected: machine.agents_detected
      ? (() => {
          try {
            return JSON.parse(machine.agents_detected);
          } catch {
            return [];
          }
        })()
      : [],
    isOnline: cached ? cached.isOnline : false,
    lastSeenAt: cached?.lastSeen
      ? new Date(cached.lastSeen).toISOString()
      : machine.last_seen_at
        ? new Date(machine.last_seen_at * 1000).toISOString()
        : null,
    createdAt: new Date(machine.created_at * 1000).toISOString(),
  };
}

// ============================================================================
// Create link request (called by daemon)
// ============================================================================

machines.post('/link-request', async (c) => {
  // Rate limit: 10 requests per minute per IP
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rateLimitKey = `rate:link-request:${ip}`;
  const current = await c.env.CACHE_KV.get<number>(rateLimitKey, 'json');
  if (current !== null && current >= 10) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  await c.env.CACHE_KV.put(rateLimitKey, JSON.stringify((current ?? 0) + 1), { expirationTtl: 60 });

  const body = await c.req.json<{
    tunnelId?: string;
    machineName: string;
    os?: string;
    arch?: string;
    agentsDetected?: string[];
  }>();

  if (!body.machineName) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  if (body.machineName.length > 255) {
    return c.json({ error: 'Machine name too long (max 255 characters)' }, 400);
  }

  if (body.os && body.os.length > 50) {
    return c.json({ error: 'OS name too long (max 50 characters)' }, 400);
  }
  if (body.arch && body.arch.length > 50) {
    return c.json({ error: 'Architecture name too long (max 50 characters)' }, 400);
  }

  if (body.agentsDetected) {
    if (!Array.isArray(body.agentsDetected) || body.agentsDetected.length > 100) {
      return c.json({ error: 'agentsDetected must be an array (max 100 items)' }, 400);
    }
    for (const agent of body.agentsDetected) {
      if (typeof agent !== 'string' || agent.length > 100) {
        return c.json({ error: 'Each agent name must be a string (max 100 chars)' }, 400);
      }
    }
  }

  // Opportunistically clean up expired link requests
  cleanupExpiredLinkRequests(c.env.DB).catch((err) =>
    console.error('Failed to cleanup expired link requests:', err)
  );

  const result = await createLinkRequest(c.env.DB, {
    tunnelId: body.tunnelId,
    machineName: body.machineName,
    os: body.os,
    arch: body.arch,
    agentsDetected: body.agentsDetected,
  });

  return c.json({
    code: result.code,
    expiresAt: result.expiresAt.toISOString(),
  });
});

// ============================================================================
// Link machine to user (called by mobile/web after QR scan)
// ============================================================================

machines.post('/link', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const body = await c.req.json<{ code: string }>();

  if (!body.code) {
    return c.json({ error: 'Missing link code' }, 400);
  }

  const result = await linkMachine(c.env.DB, {
    code: body.code,
    userId: user.id,
  });

  if (!result) {
    return c.json({ error: 'Invalid or expired link code' }, 400);
  }

  const { machine, apiSecret } = result;

  // Stash the plaintext API secret in KV for daemon to retrieve via link-status poll
  try {
    await c.env.CACHE_KV.put(
      `machine-secret:${machine.id}`,
      apiSecret,
      { expirationTtl: 60 * 15 } // 15 min TTL — daemon must poll within this window
    );
  } catch (err) {
    console.error('Failed to cache machine secret in KV:', err);
  }

  // Create Cloudflare tunnel for this machine if CF credentials are configured
  if (
    c.env.CLOUDFLARE_ACCOUNT_ID &&
    c.env.CLOUDFLARE_API_TOKEN &&
    c.env.CLOUDFLARE_ZONE_ID &&
    c.env.TUNNEL_DOMAIN
  ) {
    try {
      const tunnel = await setupMachineTunnel(
        c.env.CLOUDFLARE_ACCOUNT_ID,
        c.env.CLOUDFLARE_API_TOKEN,
        c.env.CLOUDFLARE_ZONE_ID,
        c.env.TUNNEL_DOMAIN,
        machine.id
      );

      await updateMachineTunnel(c.env.DB, machine.id, tunnel);
      machine.tunnel_url = tunnel.tunnelUrl;
      machine.cf_tunnel_id = tunnel.cfTunnelId;
      machine.tunnel_token = tunnel.tunnelToken;
    } catch (error) {
      console.error('Failed to create Cloudflare tunnel:', error);
      // Continue without tunnel — machine is still linked
    }
  }

  // Update KV cache for machine status
  try {
    await c.env.CACHE_KV.put(
      `machine:${machine.id}`,
      JSON.stringify({
        isOnline: true,
        lastSeen: Date.now(),
        tunnelId: machine.tunnel_id,
      }),
      { expirationTtl: 60 * 5 } // 5 minute TTL, refreshed by heartbeat
    );
  } catch (err) {
    console.error('Failed to update machine KV cache:', err);
  }

  return c.json({
    machine: serializeMachine(machine),
  });
});

// ============================================================================
// Link status (polled by daemon after creating link request)
// ============================================================================

machines.get('/link-status/:code', async (c) => {
  const code = c.req.param('code');

  const status = await getLinkRequestStatus(c.env.DB, code, c.env.CACHE_KV);

  if (!status.linked) {
    return c.json({ linked: false });
  }

  return c.json({
    linked: true,
    machineId: status.machineId,
    tunnelToken: status.tunnelToken,
    tunnelUrl: status.tunnelUrl,
    userId: status.userId,
    apiSecret: status.apiSecret,
  });
});

// ============================================================================
// List user's machines
// ============================================================================

machines.get('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const machinesList = await getUserMachines(c.env.DB, user.id);

  // Get active session counts per machine
  const sessionCounts = new Map<string, number>();
  if (machinesList.length > 0) {
    const placeholders = machinesList.map(() => '?').join(',');
    const counts = await c.env.DB.prepare(
      `SELECT machine_id, COUNT(*) as count FROM agent_sessions WHERE machine_id IN (${placeholders}) AND status NOT IN ('completed', 'error') GROUP BY machine_id`
    )
      .bind(...machinesList.map((m) => m.id))
      .all<{ machine_id: string; count: number }>();

    for (const row of counts.results ?? []) {
      sessionCounts.set(row.machine_id, row.count);
    }
  }

  // Enrich with KV cache for real-time status
  const enrichedMachines = await Promise.all(
    machinesList.map(async (machine) => {
      const cached = await c.env.CACHE_KV.get<{ isOnline: boolean; lastSeen: number }>(
        `machine:${machine.id}`,
        'json'
      );

      return {
        ...serializeMachine(machine, cached),
        activeSessionCount: sessionCounts.get(machine.id) ?? 0,
      };
    })
  );

  return c.json({ machines: enrichedMachines });
});

// ============================================================================
// Get single machine
// ============================================================================

machines.get('/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const machineId = c.req.param('id');
  const machine = await getMachine(c.env.DB, machineId, user.id);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  const cached = await c.env.CACHE_KV.get<{ isOnline: boolean; lastSeen: number }>(
    `machine:${machine.id}`,
    'json'
  );

  return c.json({
    machine: serializeMachine(machine, cached),
  });
});

// ============================================================================
// Rename machine
// ============================================================================

machines.patch('/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const machineId = c.req.param('id');
  const body = await c.req.json<{ name?: string }>();

  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'Name is required' }, 400);
  }

  if (body.name.trim().length > 255) {
    return c.json({ error: 'Name too long (max 255 characters)' }, 400);
  }

  const renamed = await renameMachine(c.env.DB, machineId, user.id, body.name.trim());

  if (!renamed) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  return c.json({ success: true });
});

// ============================================================================
// Delete machine (with tunnel cleanup)
// ============================================================================

machines.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const machineId = c.req.param('id');

  // Get machine first to read tunnel info for cleanup
  const machine = await getMachine(c.env.DB, machineId, user.id);
  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  // Clean up Cloudflare tunnel if it exists
  if (machine.cf_tunnel_id && c.env.CLOUDFLARE_ACCOUNT_ID && c.env.CLOUDFLARE_API_TOKEN) {
    try {
      await teardownMachineTunnel(
        c.env.CLOUDFLARE_ACCOUNT_ID,
        c.env.CLOUDFLARE_API_TOKEN,
        c.env.CLOUDFLARE_ZONE_ID,
        c.env.TUNNEL_DOMAIN,
        machineId,
        machine.cf_tunnel_id
      );
    } catch (error) {
      console.error('Failed to teardown tunnel:', error);
      // Continue with deletion even if tunnel cleanup fails
    }
  }

  const deleted = await deleteMachine(c.env.DB, machineId, user.id);

  if (!deleted) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  // Remove from KV cache
  try {
    await c.env.CACHE_KV.delete(`machine:${machineId}`);
  } catch (err) {
    console.error('Failed to delete machine KV cache:', err);
  }

  return c.json({ success: true });
});

// ============================================================================
// Machine heartbeat (called by daemon)
// ============================================================================

machines.post('/:id/heartbeat', async (c) => {
  const machineId = c.req.param('id');

  // Rate limit: max 1 heartbeat per 5 seconds per machine
  try {
    const hbRateLimitKey = `rate:heartbeat:${machineId}`;
    const lastHb = await c.env.CACHE_KV.get(hbRateLimitKey);
    if (lastHb) {
      return c.json({ success: true });
    }
    await c.env.CACHE_KV.put(hbRateLimitKey, '1', { expirationTtl: 5 });
  } catch {
    // KV failure should not block heartbeat processing
  }

  // Authenticate machine via Bearer token
  const auth = await authenticateMachine(c.env.DB, machineId, c.req.header('Authorization'));

  if (!auth.valid) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    tunnelId?: string;
    tunnelUrl?: string;
    agentsDetected?: string[];
    sessions?: Array<{
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

  if (body.agentsDetected) {
    if (!Array.isArray(body.agentsDetected) || body.agentsDetected.length > 100) {
      return c.json({ error: 'agentsDetected must be an array (max 100 items)' }, 400);
    }
    for (const agent of body.agentsDetected) {
      if (typeof agent !== 'string' || agent.length > 100) {
        return c.json({ error: 'Each agent name must be a string (max 100 chars)' }, 400);
      }
    }
  }

  const machine = { id: machineId, user_id: auth.userId };

  // Update D1
  await updateMachineStatus(c.env.DB, machineId, {
    isOnline: true,
    agentsDetected: body.agentsDetected,
  });

  // Update tunnel_url if provided (handles tunnel restarts with new URLs)
  if (body.tunnelUrl) {
    try {
      const parsed = new URL(body.tunnelUrl);
      if (parsed.protocol === 'https:') {
        await c.env.DB.prepare('UPDATE machines SET tunnel_url = ? WHERE id = ?')
          .bind(body.tunnelUrl, machineId)
          .run();
      }
    } catch {
      // Invalid URL — skip update
    }
  }

  // Sync agent sessions if provided
  if (body.sessions && Array.isArray(body.sessions)) {
    await syncMachineSessions(
      c.env.DB,
      machineId,
      machine.user_id,
      body.sessions.map((s) => ({
        id: s.id,
        machineId,
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
  }

  // Update KV cache
  try {
    await c.env.CACHE_KV.put(
      `machine:${machineId}`,
      JSON.stringify({
        isOnline: true,
        lastSeen: Date.now(),
        tunnelId: body.tunnelId,
      }),
      { expirationTtl: 60 * 5 } // 5 minute TTL
    );
  } catch (err) {
    console.error('Failed to update heartbeat KV cache:', err);
  }

  return c.json({ success: true });
});

export default machines;

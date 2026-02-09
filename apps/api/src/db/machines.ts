/**
 * Machine database operations
 */

import { nanoid } from 'nanoid';

/**
 * Hash a machine API secret using SHA-256 (Web Crypto API, available in CF Workers + Node 18+)
 */
async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a machine API secret against its stored hash
 */
export async function verifyMachineSecret(
  db: D1Database,
  machineId: string,
  secret: string
): Promise<{ valid: boolean; userId: string | null }> {
  const machine = await db
    .prepare('SELECT user_id, api_secret_hash FROM machines WHERE id = ?')
    .bind(machineId)
    .first<{ user_id: string; api_secret_hash: string | null }>();

  if (!machine || !machine.api_secret_hash) {
    return { valid: false, userId: null };
  }

  const hash = await hashSecret(secret);
  if (hash !== machine.api_secret_hash) {
    return { valid: false, userId: null };
  }

  return { valid: true, userId: machine.user_id };
}

interface Machine {
  id: string;
  user_id: string;
  name: string;
  tunnel_id: string;
  os: string | null;
  arch: string | null;
  agents_detected: string | null;
  is_online: number;
  last_seen_at: number | null;
  created_at: number;
  tunnel_url: string | null;
  cf_tunnel_id: string | null;
  tunnel_token: string | null;
  api_secret_hash: string | null;
}

interface MachineLinkRequest {
  code: string;
  tunnel_id: string;
  machine_name: string;
  os: string | null;
  arch: string | null;
  agents_detected: string | null;
  expires_at: number;
  created_at: number;
  machine_id: string | null;
}

interface CreateLinkRequestInput {
  tunnelId?: string;
  machineName: string;
  os?: string;
  arch?: string;
  agentsDetected?: string[];
}

interface LinkMachineInput {
  code: string;
  userId: string;
}

/**
 * Generate a short, readable link code
 */
function generateLinkCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0, O, I, 1)
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(bytes[i] % chars.length);
  }
  return code;
}

/**
 * Create a machine link request (for QR code)
 */
export async function createLinkRequest(
  db: D1Database,
  input: CreateLinkRequestInput
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateLinkCode();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 10 * 60; // 10 minutes
  const tunnelId = input.tunnelId ?? `local-${nanoid(12)}`;

  await db
    .prepare(
      `
      INSERT INTO machine_link_requests (code, tunnel_id, machine_name, os, arch, agents_detected, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .bind(
      code,
      tunnelId,
      input.machineName,
      input.os ?? null,
      input.arch ?? null,
      input.agentsDetected ? JSON.stringify(input.agentsDetected) : null,
      expiresAt,
      now
    )
    .run();

  return { code, expiresAt: new Date(expiresAt * 1000) };
}

/**
 * Link a machine to a user using a link code.
 * Generates a new API secret for daemon authentication.
 * Returns the machine + plaintext secret (caller must deliver secret to daemon).
 */
export async function linkMachine(
  db: D1Database,
  input: LinkMachineInput
): Promise<{ machine: Machine; apiSecret: string } | null> {
  const now = Math.floor(Date.now() / 1000);

  // Find and validate link request
  const request = await db
    .prepare('SELECT * FROM machine_link_requests WHERE code = ? AND expires_at > ?')
    .bind(input.code.toUpperCase(), now)
    .first<MachineLinkRequest>();

  if (!request) {
    return null;
  }

  // Generate a new API secret for this link
  const apiSecret = `msk_${nanoid(48)}`;
  const secretHash = await hashSecret(apiSecret);

  // Check if tunnel is already linked
  const existingMachine = await db
    .prepare('SELECT * FROM machines WHERE tunnel_id = ?')
    .bind(request.tunnel_id)
    .first<Machine>();

  if (existingMachine) {
    // Only allow re-link if the same user owns it, or the machine has no owner
    if (existingMachine.user_id && existingMachine.user_id !== input.userId) {
      return null; // Cannot steal another user's machine
    }

    // Update ownership and rotate secret
    await db
      .prepare(
        'UPDATE machines SET user_id = ?, last_seen_at = ?, api_secret_hash = ? WHERE id = ?'
      )
      .bind(input.userId, now, secretHash, existingMachine.id)
      .run();

    // Mark link request as claimed (daemon polls this)
    await db
      .prepare('UPDATE machine_link_requests SET machine_id = ? WHERE code = ?')
      .bind(existingMachine.id, input.code.toUpperCase())
      .run();

    return {
      machine: {
        ...existingMachine,
        user_id: input.userId,
        last_seen_at: now,
        api_secret_hash: secretHash,
      },
      apiSecret,
    };
  }

  // Create new machine
  const machineId = nanoid(16);

  await db
    .prepare(
      `INSERT INTO machines (id, user_id, name, tunnel_id, os, arch, agents_detected, is_online, last_seen_at, created_at, api_secret_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .bind(
      machineId,
      input.userId,
      request.machine_name,
      request.tunnel_id,
      request.os,
      request.arch,
      request.agents_detected,
      now,
      now,
      secretHash
    )
    .run();

  // Mark link request as claimed (daemon polls this)
  await db
    .prepare('UPDATE machine_link_requests SET machine_id = ? WHERE code = ?')
    .bind(machineId, input.code.toUpperCase())
    .run();

  return {
    machine: {
      id: machineId,
      user_id: input.userId,
      name: request.machine_name,
      tunnel_id: request.tunnel_id,
      os: request.os,
      arch: request.arch,
      agents_detected: request.agents_detected,
      is_online: 1,
      last_seen_at: now,
      created_at: now,
      tunnel_url: null,
      cf_tunnel_id: null,
      tunnel_token: null,
      api_secret_hash: secretHash,
    },
    apiSecret,
  };
}

/**
 * Get all machines for a user
 */
export async function getUserMachines(db: D1Database, userId: string): Promise<Machine[]> {
  const result = await db
    .prepare('SELECT * FROM machines WHERE user_id = ? ORDER BY last_seen_at DESC')
    .bind(userId)
    .all<Machine>();

  return result.results ?? [];
}

/**
 * Get a machine by ID (verifying ownership)
 */
export async function getMachine(
  db: D1Database,
  machineId: string,
  userId: string
): Promise<Machine | null> {
  const result = await db
    .prepare('SELECT * FROM machines WHERE id = ? AND user_id = ?')
    .bind(machineId, userId)
    .first<Machine>();

  return result ?? null;
}

/**
 * Get a machine by tunnel ID
 */
export async function getMachineByTunnelId(
  db: D1Database,
  tunnelId: string
): Promise<Machine | null> {
  const result = await db
    .prepare('SELECT * FROM machines WHERE tunnel_id = ?')
    .bind(tunnelId)
    .first<Machine>();

  return result ?? null;
}

/**
 * Update machine status (heartbeat)
 */
export async function updateMachineStatus(
  db: D1Database,
  machineId: string,
  status: { isOnline?: boolean; agentsDetected?: string[] }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const setClauses: string[] = ['last_seen_at = ?'];
  const values: (string | number)[] = [now];

  if (status.isOnline !== undefined) {
    setClauses.push('is_online = ?');
    values.push(status.isOnline ? 1 : 0);
  }

  if (status.agentsDetected !== undefined) {
    setClauses.push('agents_detected = ?');
    values.push(JSON.stringify(status.agentsDetected));
  }

  values.push(machineId);

  await db
    .prepare(`UPDATE machines SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Update machine tunnel info (after Cloudflare tunnel creation)
 */
export async function updateMachineTunnel(
  db: D1Database,
  machineId: string,
  tunnel: { tunnelUrl: string; cfTunnelId: string; tunnelToken: string }
): Promise<void> {
  await db
    .prepare('UPDATE machines SET tunnel_url = ?, cf_tunnel_id = ?, tunnel_token = ? WHERE id = ?')
    .bind(tunnel.tunnelUrl, tunnel.cfTunnelId, tunnel.tunnelToken, machineId)
    .run();
}

/**
 * Get link request status (for daemon polling).
 * When linked, also needs the KV namespace to retrieve the one-time API secret.
 */
export async function getLinkRequestStatus(
  db: D1Database,
  code: string,
  kv?: KVNamespace
): Promise<
  | { linked: false }
  | {
      linked: true;
      machineId: string;
      tunnelToken: string | null;
      tunnelUrl: string | null;
      userId: string;
      apiSecret: string | null;
    }
> {
  const now = Math.floor(Date.now() / 1000);

  const request = await db
    .prepare('SELECT * FROM machine_link_requests WHERE code = ? AND expires_at > ?')
    .bind(code.toUpperCase(), now)
    .first<MachineLinkRequest>();

  if (!request) {
    return { linked: false };
  }

  if (!request.machine_id) {
    return { linked: false };
  }

  // Request has been claimed — look up the machine
  const machine = await db
    .prepare('SELECT * FROM machines WHERE id = ?')
    .bind(request.machine_id)
    .first<Machine>();

  if (!machine) {
    return { linked: false };
  }

  // Retrieve the one-time API secret from KV (stored during link)
  let apiSecret: string | null = null;
  if (kv) {
    apiSecret = await kv.get(`machine-secret:${machine.id}`);
    if (apiSecret) {
      // Delete after retrieval — one-time delivery
      await kv.delete(`machine-secret:${machine.id}`);
    }
  }

  // Delete the consumed link request
  await db
    .prepare('DELETE FROM machine_link_requests WHERE code = ?')
    .bind(code.toUpperCase())
    .run();

  return {
    linked: true,
    machineId: machine.id,
    tunnelToken: machine.tunnel_token,
    tunnelUrl: machine.tunnel_url,
    userId: machine.user_id,
    apiSecret,
  };
}

/**
 * Rename a machine
 */
export async function renameMachine(
  db: D1Database,
  machineId: string,
  userId: string,
  name: string
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE machines SET name = ? WHERE id = ? AND user_id = ?')
    .bind(name, machineId, userId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Delete a machine
 */
export async function deleteMachine(
  db: D1Database,
  machineId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM machines WHERE id = ? AND user_id = ?')
    .bind(machineId, userId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Clean up expired link requests
 */
export async function cleanupExpiredLinkRequests(db: D1Database): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare('DELETE FROM machine_link_requests WHERE expires_at < ?')
    .bind(now)
    .run();

  return result.meta?.changes ?? 0;
}

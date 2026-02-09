/**
 * Device registration routes — push notification tokens
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const devices = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Register or update a device push token
 */
devices.post('/register', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const body = await c.req.json<{
    pushToken: string;
    name?: string;
    type: 'ios' | 'android' | 'web';
  }>();

  if (!body.pushToken || !body.type) {
    return c.json({ error: 'Missing pushToken or type' }, 400);
  }

  // Validate push token format (must match Expo(nent)PushToken[...] with valid characters)
  if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(body.pushToken)) {
    return c.json({ error: 'Invalid push token format' }, 400);
  }

  if (body.pushToken.length > 512) {
    return c.json({ error: 'Push token too long' }, 400);
  }

  // Validate device type
  if (!['ios', 'android', 'web'].includes(body.type)) {
    return c.json({ error: 'Invalid device type' }, 400);
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Upsert by push token — if same token exists for this user, update it
  const existing = await c.env.DB.prepare(
    'SELECT id FROM devices WHERE user_id = ? AND push_token = ?'
  )
    .bind(user.id, body.pushToken)
    .first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare('UPDATE devices SET name = ?, last_seen_at = ? WHERE id = ?')
      .bind(body.name ?? null, now, existing.id)
      .run();

    return c.json({ device: { id: existing.id } });
  }

  await c.env.DB.prepare(
    'INSERT INTO devices (id, user_id, name, type, push_token, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, user.id, body.name ?? null, body.type, body.pushToken, now, now)
    .run();

  return c.json({ device: { id } }, 201);
});

/**
 * List user's registered devices
 */
devices.get('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const result = await c.env.DB.prepare(
    'SELECT id, name, type, push_token, last_seen_at, created_at FROM devices WHERE user_id = ?'
  )
    .bind(user.id)
    .all<{
      id: string;
      name: string | null;
      type: string;
      push_token: string | null;
      last_seen_at: number | null;
      created_at: number | null;
    }>();

  return c.json({
    devices: (result.results ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      hasPushToken: !!d.push_token,
      lastSeenAt: d.last_seen_at ? new Date(d.last_seen_at * 1000).toISOString() : null,
      createdAt: d.created_at ? new Date(d.created_at * 1000).toISOString() : null,
    })),
  });
});

/**
 * Unregister a device
 */
devices.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const deviceId = c.req.param('id');

  const result = await c.env.DB.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?')
    .bind(deviceId, user.id)
    .run();

  if (!result.meta?.changes) {
    return c.json({ error: 'Device not found' }, 404);
  }

  return c.json({ success: true });
});

export default devices;

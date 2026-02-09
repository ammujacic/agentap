/**
 * Notification routes — daemon calls these to trigger push notifications
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { verifyMachineSecret } from '../db/machines';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Send approval push notification
 * Called by daemon when an approval is requested
 */
notifications.post('/approval', async (c) => {
  const body = await c.req.json<{
    machineId: string;
    sessionId: string;
    requestId: string;
    toolCallId: string;
    toolName: string;
    description: string;
    riskLevel: string;
  }>();

  if (!body.machineId || !body.sessionId || !body.requestId || !body.toolCallId) {
    return c.json(
      { error: 'Missing required fields: machineId, sessionId, requestId, toolCallId' },
      400
    );
  }

  if (body.toolName && body.toolName.length > 200) {
    return c.json({ error: 'toolName too long (max 200 characters)' }, 400);
  }
  if (body.description && body.description.length > 1000) {
    return c.json({ error: 'description too long (max 1000 characters)' }, 400);
  }

  // Validate riskLevel enum
  const validRiskLevels = ['low', 'medium', 'high', 'critical'];
  if (body.riskLevel && !validRiskLevels.includes(body.riskLevel)) {
    return c.json({ error: 'Invalid riskLevel' }, 400);
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

  const machine = { user_id: auth.userId };

  // Get all devices with push tokens for this user
  const result = await c.env.DB.prepare(
    'SELECT push_token FROM devices WHERE user_id = ? AND push_token IS NOT NULL'
  )
    .bind(machine.user_id)
    .all<{ push_token: string }>();

  const tokens = (result.results ?? []).map((d) => d.push_token);

  if (tokens.length === 0) {
    return c.json({ sent: 0 });
  }

  // Build Expo push messages
  const riskLevel = body.riskLevel ?? 'medium';
  const riskLabel =
    riskLevel === 'critical' || riskLevel === 'high' ? `[${riskLevel.toUpperCase()}] ` : '';

  const messages = tokens.map((token) => ({
    to: token,
    title: `${riskLabel}Approval Required`,
    body: `${body.toolName}: ${body.description}`.slice(0, 200),
    data: {
      type: 'approval',
      sessionId: body.sessionId,
      requestId: body.requestId,
      toolCallId: body.toolCallId,
      toolName: body.toolName,
      riskLevel,
    },
    sound: 'default',
    priority: riskLevel === 'critical' || riskLevel === 'high' ? 'high' : 'default',
    categoryId: 'approval',
  }));

  // Send via Expo Push API
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.error('Expo push failed:', response.status, await response.text());
      return c.json({ error: 'Push delivery failed' }, 502);
    }

    return c.json({ sent: tokens.length });
  } catch (error) {
    console.error('Expo push error:', error);
    return c.json({ error: 'Push delivery failed' }, 502);
  }
});

export default notifications;

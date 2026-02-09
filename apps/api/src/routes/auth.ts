/**
 * Authentication routes using Better Auth
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createAuth, invalidateCachedSession } from '../auth';
import type { RequestGeo } from '../auth';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Extract geolocation from Cloudflare's request.cf object
 */
function extractGeo(req: Request): RequestGeo | undefined {
  const cf = (req as unknown as { cf?: Record<string, unknown> }).cf;
  if (!cf) return undefined;
  return {
    city: cf.city as string | undefined,
    region: cf.regionCode as string | undefined,
    country: cf.country as string | undefined,
  };
}

/**
 * Custom route: Get current user (for mobile app)
 * Must be registered BEFORE the catch-all so it takes precedence.
 */
auth.get('/me', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  return c.json({ user });
});

/**
 * Custom route: Logout with KV cache invalidation
 * Must be registered BEFORE the catch-all so it takes precedence.
 */
auth.post('/logout', async (c) => {
  const sessionId = c.get('sessionId');

  if (sessionId) {
    const betterAuth = createAuth(c.env);

    // Invalidate via better-auth
    await betterAuth.api.signOut({
      headers: c.req.raw.headers,
    });

    // Clear KV cache
    await invalidateCachedSession(sessionId, c.env.SESSION_KV);
  }

  return c.json({ success: true });
});

/**
 * Mount Better Auth handler for all auth routes
 * This handles: /auth/sign-in, /auth/sign-up, /auth/sign-out,
 * /auth/callback/github, /auth/callback/google, /auth/callback/apple, etc.
 * Passes Cloudflare geolocation so new sessions get location data.
 */
auth.all('/*', async (c) => {
  // Debug: log origin headers for CSRF troubleshooting
  if (c.env.API_URL.includes('localhost')) {
    const origin = c.req.header('origin');
    const expoOrigin = c.req.header('expo-origin');
    const referer = c.req.header('referer');
    console.log(
      `[auth] ${c.req.method} ${c.req.path} | origin="${origin ?? 'null'}" expo-origin="${expoOrigin ?? 'null'}" referer="${referer ?? 'null'}"`
    );
  }

  // Rate limit sign-in and sign-up endpoints (10 requests per minute per IP)
  if (
    c.req.method === 'POST' &&
    (c.req.path.includes('/sign-in') || c.req.path.includes('/sign-up'))
  ) {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const rateLimitKey = `rate:auth:${ip}`;
    const current = await c.env.CACHE_KV.get<number>(rateLimitKey, 'json');

    if (current !== null && current >= 10) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    await c.env.CACHE_KV.put(rateLimitKey, JSON.stringify((current ?? 0) + 1), {
      expirationTtl: 60,
    });
  }

  const geo = extractGeo(c.req.raw);
  const betterAuth = createAuth(c.env, geo);
  const response = await betterAuth.handler(c.req.raw);

  // Debug: log 403 response body
  if (c.env.API_URL.includes('localhost') && response.status === 403) {
    const body = await response.clone().text();
    console.log(`[auth] 403 response body: ${body}`);
  }

  return response;
});

export default auth;

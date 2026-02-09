/**
 * Authentication middleware using Better Auth
 */

import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { createAuth, validateSessionWithCache } from '../auth';

const SESSION_COOKIE_NAME = 'better-auth.session_token';

/**
 * Middleware that extracts and validates session from cookie
 * Sets user and sessionId in context variables
 */
export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);

  if (!sessionToken) {
    c.set('user', null);
    c.set('sessionId', null);
    return next();
  }

  const auth = createAuth(c.env);
  const { user, session } = await validateSessionWithCache(auth, sessionToken, c.env.SESSION_KV);

  c.set('user', user);
  c.set('sessionId', session?.id ?? null);

  return next();
});

/**
 * Middleware that requires authentication
 * Returns 401 if not authenticated
 */
export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  return next();
});

/**
 * Better Auth setup for Cloudflare Workers + D1
 */

import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import type { Env } from '../types';
import * as schema from '../db/schema';

/**
 * Geolocation data extracted from Cloudflare's request.cf object
 */
export interface RequestGeo {
  city?: string;
  region?: string;
  country?: string;
}

/**
 * Create a Better Auth instance for the given environment.
 * Optionally accepts geolocation data from Cloudflare to store with sessions.
 */
export function createAuth(env: Env, geo?: RequestGeo) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
    }),
    baseURL: env.API_URL,
    basePath: '/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [
      env.WEB_URL,
      env.API_URL,
      'http://localhost:3001',
      'http://localhost:8081', // Expo dev server (web)
      'agentap://', // Mobile app scheme (production)
      'exp://', // Expo Go dev scheme (physical device)
    ],

    // Session configuration
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      additionalFields: {
        city: { type: 'string', required: false },
        region: { type: 'string', required: false },
        country: { type: 'string', required: false },
      },
    },

    // OAuth providers
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      apple: {
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET,
      },
    },

    // Email/password auth
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },

    // User configuration
    user: {
      additionalFields: {
        avatarUrl: {
          type: 'string',
          required: false,
        },
      },
      deleteUser: {
        enabled: true,
      },
    },

    // Inject Cloudflare geolocation into new sessions
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (!geo) return;
            return {
              data: {
                ...session,
                city: geo.city || null,
                region: geo.region || null,
                country: geo.country || null,
              },
            };
          },
        },
      },
    },

    // Plugins
    plugins: [
      twoFactor({
        issuer: 'Agentap',
      }),
    ],

    // Advanced options
    advanced: {
      crossSubDomainCookies: {
        enabled: false,
      },
    },
  });
}

/**
 * Session data for KV caching
 */
export interface CachedSession {
  userId: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    twoFactorEnabled: boolean;
  };
  expiresAt: number;
}

/**
 * Validate session with KV caching for performance
 */
export async function validateSessionWithCache(
  auth: ReturnType<typeof createAuth>,
  sessionToken: string,
  kv: KVNamespace
): Promise<{
  user: CachedSession['user'] | null;
  session: { id: string; expiresAt: Date } | null;
}> {
  // Try KV cache first (fast path)
  const cached = await kv.get<CachedSession>(`session:${sessionToken}`, 'json');

  if (cached && cached.expiresAt > Date.now()) {
    return {
      user: cached.user,
      session: {
        id: sessionToken,
        expiresAt: new Date(cached.expiresAt),
      },
    };
  }

  // Fall back to better-auth validation (slow path)
  const session = await auth.api.getSession({
    headers: new Headers({
      cookie: `better-auth.session_token=${sessionToken}`,
    }),
  });

  if (session?.session && session?.user) {
    const expiresAt = new Date(session.session.expiresAt).getTime();
    const ttlSeconds = Math.floor((expiresAt - Date.now()) / 1000);

    if (ttlSeconds > 0) {
      await kv.put(
        `session:${sessionToken}`,
        JSON.stringify({
          userId: session.user.id,
          user: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            avatarUrl: (session.user as { avatarUrl?: string }).avatarUrl ?? null,
            twoFactorEnabled:
              (session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled ?? false,
          },
          expiresAt,
        } satisfies CachedSession),
        { expirationTtl: Math.min(ttlSeconds, 300) } // Max 5 min cache
      );
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        avatarUrl: (session.user as { avatarUrl?: string }).avatarUrl ?? null,
        twoFactorEnabled:
          (session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled ?? false,
      },
      session: {
        id: session.session.id,
        expiresAt: new Date(session.session.expiresAt),
      },
    };
  }

  return { user: null, session: null };
}

/**
 * Invalidate cached session (call on logout)
 */
export async function invalidateCachedSession(
  sessionToken: string,
  kv: KVNamespace
): Promise<void> {
  await kv.delete(`session:${sessionToken}`);
}

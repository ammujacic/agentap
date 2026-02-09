/**
 * Cloudflare Workers environment bindings
 */

export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespaces
  SESSION_KV: KVNamespace;
  CACHE_KV: KVNamespace;

  // Environment variables
  API_URL: string;
  WEB_URL: string;
  MOBILE_SCHEME: string;

  // Auth secret for Better Auth
  AUTH_SECRET: string;

  // Cloudflare tunnel management
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ZONE_ID: string;
  TUNNEL_DOMAIN: string; // e.g. "tunnel.agentap.dev"

  // OAuth credentials
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APPLE_CLIENT_ID: string;
  APPLE_CLIENT_SECRET: string;
}

export interface Variables {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
  sessionId: string | null;
}

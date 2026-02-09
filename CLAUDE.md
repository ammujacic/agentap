# CLAUDE.md - Project Context for Claude Code

This file provides context for Claude Code when working on the Agentap project.

## Project Overview

Agentap is a mobile bridge for AI coding agents. It enables developers to:

- Monitor AI agent sessions from mobile devices
- Approve sensitive actions (file writes, bash commands) remotely
- Link multiple development machines to a single account
- Real-time WebSocket communication between mobile and desktop

## Architecture

```
Mobile App ◄──► Cloudflare API ◄──► Daemon ◄──► AI Agents (Claude Code)
```

- **API**: Cloudflare Workers with D1 database and Better Auth
- **Daemon**: Bun-based CLI that runs on developer machines
- **Mobile**: React Native/Expo app
- **Adapters**: Plugin system for different AI agents

## Key Directories

| Path                            | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `apps/api/`                     | Cloudflare Workers API (Hono + D1 + Better Auth) |
| `apps/api/src/auth/`            | Better Auth configuration with Drizzle adapter   |
| `apps/api/src/db/`              | Database operations and Drizzle schema           |
| `apps/api/src/routes/`          | API route handlers                               |
| `packages/daemon/`              | Desktop daemon (Bun CLI)                         |
| `packages/daemon/src/daemon.ts` | Main daemon logic, WebSocket server              |
| `packages/mobile/`              | React Native app (Expo)                          |
| `packages/shared/`              | Shared types and utilities                       |
| `packages/adapter-base/`        | Base adapter interface                           |
| `packages/adapter-claude-code/` | Claude Code specific adapter                     |
| `docker/`                       | Docker configuration files                       |

## Tech Stack

- **Runtime**: Bun (daemon), Node.js (API), React Native (mobile)
- **API Framework**: Hono on Cloudflare Workers
- **Database**: D1 (Cloudflare SQLite) with Drizzle ORM
- **Auth**: Better Auth with email/password + OAuth
- **State**: Zustand (mobile)
- **Styling**: NativeWind (mobile), Tailwind (web)

## Development Commands

```bash
# Start local dev with Docker (recommended)
pnpm docker:up

# Start individual services
pnpm dev:api      # API on localhost:8787
pnpm dev:daemon   # Daemon on localhost:9876
pnpm dev:mobile   # Expo dev server

# Build and test
pnpm build
pnpm typecheck
pnpm test
```

## Database Schema

The database uses Better Auth's schema plus custom tables:

**Better Auth tables:**

- `user` - User accounts
- `session` - Active sessions
- `account` - OAuth/credential accounts
- `verification` - Email verification tokens

**Custom tables:**

- `machines` - Linked development machines
- `machine_link_requests` - Temporary QR code linking tokens
- `devices` - Mobile devices (for push notifications)

## Key Files to Know

| File                                   | Description                                              |
| -------------------------------------- | -------------------------------------------------------- |
| `apps/api/src/auth/index.ts`           | Better Auth setup with Drizzle adapter                   |
| `apps/api/src/db/schema.ts`            | Drizzle schema definitions                               |
| `apps/api/migrations/0001_initial.sql` | Database schema                                          |
| `packages/daemon/src/daemon.ts`        | Main daemon class with WebSocket                         |
| `packages/daemon/src/cli.ts`           | CLI commands                                             |
| `packages/shared/src/types/`           | Shared TypeScript types                                  |
| `docker-compose.yml`                   | Local development setup                                  |
| `docker/api-entrypoint.sh`             | API container startup (runs migrations, seeds demo user) |

## Environment Variables

**API** (`apps/api/.dev.vars`):

```
AUTH_SECRET=<32+ char secret>
GITHUB_CLIENT_ID=<optional>
GITHUB_CLIENT_SECRET=<optional>
GOOGLE_CLIENT_ID=<optional>
GOOGLE_CLIENT_SECRET=<optional>
APPLE_CLIENT_ID=<optional>
APPLE_CLIENT_SECRET=<optional>
```

**Daemon** (`~/.agentap/config.toml`):

```toml
[api]
url = "http://localhost:8787"

[tunnel]
enabled = false
```

## Demo Account

For local development:

- **Email**: `demo@agentap.dev`
- **Password**: `demo1234`

Created automatically by `docker/api-entrypoint.sh` on startup.

## Common Tasks

### Adding a new API endpoint

1. Create route in `apps/api/src/routes/`
2. Register in `apps/api/src/index.ts`
3. Add types to `packages/shared/src/types/`

### Adding a new agent adapter

1. Create package in `packages/adapter-<name>/`
2. Implement `AgentAdapter` interface from `@agentap-dev/adapter-base`
3. Register in daemon's adapter discovery

### Modifying database schema

1. Update `apps/api/src/db/schema.ts`
2. Create migration in `apps/api/migrations/`
3. Update `db:migrate` script if needed

## Troubleshooting

### "workerd" errors in Docker

Use `node:20-slim` not `node:20-alpine` for API container (workerd requires glibc)

### "No agents detected"

Daemon checks for `.claude` directory at:

- `$HOME/.claude`
- `/home/bun/.claude` (Docker mount)

### Better Auth schema errors

Ensure `apps/api/src/db/schema.ts` is imported and passed to drizzle adapter

## Testing

```bash
# Unit tests
pnpm test

# Type checking
pnpm typecheck

# Integration tests (requires Docker)
pnpm docker:test
```

## Deployment

- **API**: `wrangler deploy` to Cloudflare Workers
- **Mobile**: `eas build` via Expo
- **Daemon**: Publish to npm as `@agentap-dev/cli`

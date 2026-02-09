# Agentap

**Mobile Bridge for AI Coding Agents**

Open-source system that lets developers interact with their local AI coding agents from mobile devices. Monitor sessions, approve actions, and chat with your AI agents from anywhere.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mobile App    │◄───►│   Cloudflare    │◄───►│     Daemon      │
│  (iOS/Android)  │     │   Workers API   │     │  (Your Machine) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │   Claude Code   │
                                                │   (or other AI) │
                                                └─────────────────┘
```

## Features

- **Real-time Session Monitoring**: Watch AI agent sessions live on your phone
- **Action Approval**: Approve sensitive operations (file writes, bash commands) from mobile
- **Multi-Machine Support**: Link multiple development machines to one account
- **QR Code Linking**: Securely connect machines by scanning a QR code
- **WebSocket Communication**: Low-latency bidirectional messaging

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for local development)

### Local Development

```bash
# Clone and install
git clone https://github.com/agentap-dev/agentap.git
cd agentap
pnpm install

# Start everything with Docker
pnpm docker:up

# View logs
pnpm docker:logs
```

### Demo Account

After running `pnpm docker:up`, a demo account is automatically created:

|              |                    |
| ------------ | ------------------ |
| **Email**    | `demo@agentap.dev` |
| **Password** | `demo1234`         |

### Test Login

```bash
curl -X POST http://localhost:8787/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@agentap.dev","password":"demo1234"}'
```

## Project Structure

```
agentap/
├── apps/
│   ├── api/                  # Cloudflare Workers API (Hono + D1 + Better Auth)
│   ├── website/              # Marketing website (Next.js)
│   └── portal/               # Web dashboard (Next.js)
├── packages/
│   ├── shared/               # Shared types and utilities
│   ├── daemon/               # Desktop daemon CLI (Bun)
│   ├── mobile/               # React Native app (Expo)
│   ├── adapter-base/         # Agent adapter interface
│   └── adapter-claude-code/  # Claude Code adapter
├── docker/                   # Docker configuration
└── tests/                    # Integration tests
```

## Docker Commands

| Command                  | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `pnpm docker:up`         | Start all services (API, daemon, website, portal) |
| `pnpm docker:up:backend` | Start only API + daemon                           |
| `pnpm docker:down`       | Stop all containers                               |
| `pnpm docker:logs`       | View container logs                               |
| `pnpm docker:reset`      | Reset containers and database                     |
| `pnpm docker:build`      | Rebuild images                                    |

### Service URLs

| Service | URL                   |
| ------- | --------------------- |
| API     | http://localhost:8787 |
| Daemon  | ws://localhost:9876   |
| Website | http://localhost:3000 |
| Portal  | http://localhost:3001 |

## Development Commands

| Command           | Description              |
| ----------------- | ------------------------ |
| `pnpm dev`        | Start all dev servers    |
| `pnpm dev:api`    | Start API (port 8787)    |
| `pnpm dev:daemon` | Start daemon (port 9876) |
| `pnpm dev:mobile` | Start Expo dev server    |
| `pnpm build`      | Build all packages       |
| `pnpm typecheck`  | Type check all packages  |
| `pnpm test`       | Run unit tests           |

## API Endpoints

| Endpoint              | Method | Description               |
| --------------------- | ------ | ------------------------- |
| `/health`             | GET    | Health check              |
| `/auth/sign-up/email` | POST   | Register new user         |
| `/auth/sign-in/email` | POST   | Login with email/password |
| `/auth/sign-out`      | POST   | Logout                    |
| `/api/machines`       | GET    | List user's machines      |
| `/api/machines/link`  | POST   | Link machine via code     |

## Environment Variables

### API (`apps/api/.dev.vars`)

```bash
# Required - generate with: openssl rand -base64 32
AUTH_SECRET=your-secret-key-at-least-32-chars

# OAuth (optional for local dev - email/password works without)
GITHUB_CLIENT_ID=not-configured
GITHUB_CLIENT_SECRET=not-configured
GOOGLE_CLIENT_ID=not-configured
GOOGLE_CLIENT_SECRET=not-configured
APPLE_CLIENT_ID=not-configured
APPLE_CLIENT_SECRET=not-configured
```

### Daemon Configuration

The daemon reads from `~/.agentap/config.toml`:

```toml
[api]
url = "http://localhost:8787"

[tunnel]
enabled = false
```

## Technology Stack

| Component    | Technology                                         |
| ------------ | -------------------------------------------------- |
| **API**      | Cloudflare Workers, Hono, D1 (SQLite), Better Auth |
| **Daemon**   | Bun, WebSocket, Chokidar                           |
| **Mobile**   | React Native, Expo, Zustand                        |
| **Database** | SQLite (D1 in production)                          |
| **Auth**     | Better Auth with Drizzle adapter                   |

## Deployment

### API (Cloudflare Workers)

```bash
cd apps/api
wrangler deploy
```

### Mobile (Expo)

```bash
cd packages/mobile
eas build
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm typecheck && pnpm test`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details

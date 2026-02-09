# @agentap-dev/adapter-base

**Base adapter for Agentap agent integrations** — provides the abstract `BaseAdapter` class and re-exports all ACP protocol types needed to build an adapter for any AI coding agent.

If you want to connect a new AI agent to Agentap, this is where you start.

## Installation

```bash
pnpm add @agentap-dev/adapter-base
```

This package depends on `@agentap-dev/acp` and re-exports its types, so you typically only need this single dependency.

## Quick Start

```typescript
import {
  BaseAdapter,
  type ACPSession,
  type ACPCapabilities,
  type AgentDataPaths,
  type DiscoveredSession,
  type SessionDiscoveryEvent,
  type StartSessionOptions,
} from '@agentap-dev/adapter-base';

class MyCursorAdapter extends BaseAdapter {
  readonly name = 'cursor';
  readonly displayName = 'Cursor';
  readonly icon = '⚡';
  readonly integrationMethod = 'pty' as const;

  async isInstalled(): Promise<boolean> {
    // Check if agent CLI/binary exists on the system
  }

  async getVersion(): Promise<string | null> {
    // Return installed version or null
  }

  async discoverSessions(): Promise<DiscoveredSession[]> {
    // Scan filesystem for active/recent sessions
  }

  watchSessions(callback: (event: SessionDiscoveryEvent) => void): () => void {
    // Watch for session changes, return unsubscribe function
  }

  async attachToSession(sessionId: string): Promise<ACPSession> {
    // Connect to an existing running session
  }

  async startSession(options: StartSessionOptions): Promise<ACPSession> {
    // Launch a new agent session
  }
}
```

## What BaseAdapter Provides

`BaseAdapter` is an abstract class implementing the `ACPAdapter` interface. It gives you:

### Concrete Methods (ready to use)

| Method                              | Description                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `getCapabilities()`                 | Returns capabilities with conservative defaults (override to declare real features) |
| `getDataPaths()`                    | Returns `{}` by default (override to specify session/config/log paths)              |
| `assessRisk(toolName, input)`       | Evaluate risk level of a tool call (`low`/`medium`/`high`/`critical`)               |
| `describeToolCall(toolName, input)` | Generate human-readable description (e.g., "Read: /src/index.ts")                   |
| `categorizeTool(toolName)`          | Classify tool into category (`file_read`/`terminal`/`web`/etc.)                     |
| `generateId()`                      | Generate a random string ID for sessions/events                                     |

### Abstract Members (you must implement)

| Member                | Type                           | Description                                                |
| --------------------- | ------------------------------ | ---------------------------------------------------------- |
| `name`                | `readonly string`              | Machine identifier (e.g., `'cursor'`, `'copilot'`)         |
| `displayName`         | `readonly string`              | Human-readable name (e.g., `'Cursor'`, `'GitHub Copilot'`) |
| `icon`                | `readonly string`              | Icon identifier or emoji                                   |
| `integrationMethod`   | `readonly IntegrationMethod`   | How the adapter connects to the agent                      |
| `isInstalled()`       | `Promise<boolean>`             | Check if agent is available on the system                  |
| `getVersion()`        | `Promise<string \| null>`      | Get installed agent version                                |
| `discoverSessions()`  | `Promise<DiscoveredSession[]>` | Find active/recent sessions                                |
| `watchSessions(cb)`   | `() => void`                   | Watch for session changes, return unsubscribe function     |
| `attachToSession(id)` | `Promise<ACPSession>`          | Connect to an existing session                             |
| `startSession(opts)`  | `Promise<ACPSession>`          | Start a new session                                        |

## Integration Methods

The `integrationMethod` field tells Agentap how your adapter communicates with the agent:

| Method         | Description                       | Example                                                     |
| -------------- | --------------------------------- | ----------------------------------------------------------- |
| `'sdk'`        | Direct SDK/API integration        | Claude Code (spawns CLI with `--output-format stream-json`) |
| `'http'`       | HTTP/REST API                     | Agents with REST endpoints                                  |
| `'pty'`        | Pseudo-terminal (screen scraping) | Terminal-based agents                                       |
| `'file-watch'` | File system watching              | Agents that write logs/state to disk                        |
| `'mcp'`        | Model Context Protocol            | MCP-compatible agents                                       |

## Building an Adapter: Step by Step

### 1. Implement Detection

These methods let the daemon discover if your agent is available:

```typescript
async isInstalled(): Promise<boolean> {
  try {
    execSync('which my-agent', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async getVersion(): Promise<string | null> {
  try {
    return execSync('my-agent --version', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}
```

### 2. Implement Session Discovery

The daemon needs to find existing sessions on disk:

```typescript
async discoverSessions(): Promise<DiscoveredSession[]> {
  const sessionsDir = '/path/to/agent/sessions';
  const entries = await readdir(sessionsDir);

  return entries.map(id => ({
    id,
    agent: this.name,
    projectPath: '/path/to/project',
    projectName: 'my-project',
    createdAt: new Date(),
    lastActivity: new Date(),
  }));
}
```

### 3. Implement Session Watching

Monitor for new/removed/updated sessions in real-time:

```typescript
watchSessions(callback: (event: SessionDiscoveryEvent) => void): () => void {
  const watcher = watch('/path/to/agent/sessions/*', { depth: 0 });

  watcher.on('addDir', (path) => {
    callback({
      type: 'session_created',
      sessionId: path.split('/').pop()!,
      agent: this.name,
    });
  });

  watcher.on('unlinkDir', (path) => {
    callback({
      type: 'session_removed',
      sessionId: path.split('/').pop()!,
      agent: this.name,
    });
  });

  // Return cleanup function
  return () => watcher.close();
}
```

### 4. Implement the ACPSession

This is the core of your adapter — translating agent-specific events into ACP events:

```typescript
import {
  type ACPSession,
  type ACPEvent,
  type ACPCommand,
  type ACPCapabilities,
} from '@agentap-dev/adapter-base';
import { createEvent, assessRisk, categorizeTool, describeToolCall } from '@agentap-dev/acp';

class MyAgentSession implements ACPSession {
  readonly sessionId: string;
  readonly capabilities: ACPCapabilities;
  private emitter = new EventEmitter();
  private history: ACPEvent[] = [];

  constructor(sessionId: string, capabilities: ACPCapabilities) {
    this.sessionId = sessionId;
    this.capabilities = capabilities;
  }

  onEvent(callback: (event: ACPEvent) => void): () => void {
    this.emitter.on('event', callback);
    return () => this.emitter.off('event', callback);
  }

  async execute(command: ACPCommand): Promise<void> {
    switch (command.command) {
      case 'send_message':
        // Forward message to your agent
        break;
      case 'approve_tool_call':
        // Approve pending tool call
        break;
      case 'deny_tool_call':
        // Deny pending tool call
        break;
      case 'cancel':
        // Send interrupt signal
        break;
      case 'terminate':
        // Kill the agent process
        break;
    }
  }

  async getHistory(): Promise<ACPEvent[]> {
    return [...this.history];
  }

  async detach(): Promise<void> {
    // Clean up watchers/connections (don't terminate agent)
  }

  // ── Emit ACP events from agent-specific data ──────────

  private emit(event: ACPEvent): void {
    this.history.push(event);
    this.emitter.emit('event', event);
  }

  // Example: translate an agent message into ACP events
  handleAgentMessage(text: string) {
    const messageId = this.generateId();

    this.emit(
      createEvent(this.sessionId, {
        type: 'message:start',
        messageId,
        role: 'assistant',
      })
    );

    this.emit(
      createEvent(this.sessionId, {
        type: 'message:delta',
        messageId,
        role: 'assistant',
        delta: text,
      })
    );

    this.emit(
      createEvent(this.sessionId, {
        type: 'message:complete',
        messageId,
        role: 'assistant',
        content: [{ type: 'text', text }],
      })
    );
  }

  // Example: translate an agent tool call into ACP events
  handleAgentToolCall(toolName: string, input: Record<string, unknown>, output: string) {
    const toolCallId = this.generateId();

    this.emit(
      createEvent(this.sessionId, {
        type: 'tool:start',
        toolCallId,
        name: toolName,
        category: categorizeTool(toolName),
        description: describeToolCall(toolName, input),
      })
    );

    this.emit(
      createEvent(this.sessionId, {
        type: 'tool:executing',
        toolCallId,
        name: toolName,
        input,
        riskLevel: assessRisk(toolName, input),
        requiresApproval: assessRisk(toolName, input) !== 'low',
      })
    );

    this.emit(
      createEvent(this.sessionId, {
        type: 'tool:result',
        toolCallId,
        name: toolName,
        output,
        duration: 0,
      })
    );
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}
```

### 5. Override Capabilities

Declare what your adapter actually supports:

```typescript
override getCapabilities(): ACPCapabilities {
  const defaults = super.getCapabilities();
  return {
    ...defaults,
    features: {
      ...defaults.features,
      streaming: { messages: true, toolArgs: true, thinking: false },
      approval: { toolCalls: true, preview: true },
      sessionControl: { pause: true, resume: true, cancel: true },
      resources: { tokenUsage: true, costTracking: true, contextWindow: true },
      fileOperations: { diffs: true, batchedChanges: false },
      git: true,
      thinking: false,
    },
  };
}
```

### 6. Override Data Paths (optional)

Tell the daemon where your agent stores data:

```typescript
getDataPaths(): AgentDataPaths {
  return {
    sessions: join(homedir(), '.my-agent', 'sessions'),
    config: join(homedir(), '.my-agent', 'config.json'),
    logs: join(homedir(), '.my-agent', 'logs'),
  };
}
```

## Default Capabilities

When you don't override `getCapabilities()`, the base class provides conservative defaults:

```
streaming.messages: true       ← Only messages stream by default
streaming.toolArgs: false
streaming.thinking: false
approval.toolCalls: false
approval.preview: false
sessionControl.*: false        ← No session control
subAgents: false
planning.*: false
resources.*: false
fileOperations.*: false
git: false
webSearch: false
multimodal: false
userInteraction.*: false
thinking: false
customEvents: []
```

This means the mobile UI will only show basic message streaming until you override capabilities with what your adapter actually supports.

## Real-World Example

See [`@agentap-dev/adapter-claude-code`](../adapter-claude-code/) for a complete, production adapter that:

- Detects Claude Code installation via `which claude`
- Discovers sessions by scanning `~/.claude/projects/*/sessions/`
- Watches for session changes using `chokidar`
- Spawns Claude CLI with `--output-format stream-json`
- Translates Claude's streaming JSON into ACP events
- Handles tool approval flow with pending approval tracking
- Supports message sending, cancel, terminate, and resume commands

## Re-exported Types

This package re-exports all the ACP types you need so you don't have to depend on `@agentap-dev/acp` directly:

<details>
<summary>Click to expand full type list</summary>

```typescript
// Core protocol
ACPEvent, ACPEventBase, ACPEventByPrefix, ACPError,
ACPCapabilities, IntegrationMethod, ACPCommand,

// Adapter interfaces
ACPAdapter, ACPSession, AgentDataPaths,
DiscoveredSession, SessionDiscoveryEvent, StartSessionOptions,

// Event types
SessionStatus, SessionSummary,
MessageRole, MessageContent,
RiskLevel, ToolCategory, ToolStructuredOutput,
ApprovalPreview, FileChangeSummary,
TokenUsage, CostBreakdown,
EnvironmentContext, PermissionPolicy,
GitOperation, WebOperation,
```

</details>

## Adapter Lifecycle

```
Daemon starts
    │
    ▼
adapter.isInstalled()          → Is the agent available?
adapter.getVersion()           → What version?
adapter.getCapabilities()      → What features?
adapter.getDataPaths()         → Where does it store data?
    │
    ▼
adapter.discoverSessions()     → Find existing sessions
adapter.watchSessions(cb)      → Monitor for changes
    │
    ├── User selects session ───► adapter.attachToSession(id)
    │                                    │
    └── User starts new ───────► adapter.startSession(opts)
                                         │
                                         ▼
                                    ACPSession
                                         │
                               session.onEvent(cb)  ← Events flow out
                               session.execute(cmd) ← Commands flow in
                               session.getHistory() ← Replay support
                               session.detach()     ← Disconnect
```

## Contributing

### Creating a New Adapter Package

1. Create a new package at `packages/adapter-<name>/`
2. Add `@agentap-dev/adapter-base` as a dependency
3. Extend `BaseAdapter` and implement all abstract members
4. Create a session class implementing `ACPSession`
5. Override `getCapabilities()` to declare supported features
6. Add the adapter to the daemon's adapter discovery in `packages/daemon/`

### Development

```bash
pnpm build          # Build CJS + ESM + types
pnpm dev            # Watch mode
pnpm typecheck      # Type check
pnpm test           # Run tests
pnpm test:coverage  # Coverage report
```

### Testing Your Adapter

The test suite in `src/__tests__/base-adapter.test.ts` shows how to create a concrete test implementation. Follow the same pattern for your adapter:

```typescript
import { describe, it, expect } from 'vitest';
import { BaseAdapter } from '../base-adapter';

class TestAdapter extends BaseAdapter {
  readonly name = 'test-agent';
  readonly displayName = 'Test Agent';
  readonly icon = '🧪';
  readonly integrationMethod = 'sdk' as const;

  async isInstalled() {
    return true;
  }
  async getVersion() {
    return '1.0.0';
  }
  async discoverSessions() {
    return [];
  }
  watchSessions() {
    return () => {};
  }
  async attachToSession(id: string) {
    /* ... */
  }
  async startSession(opts) {
    /* ... */
  }
}

describe('TestAdapter', () => {
  it('reports capabilities', () => {
    const adapter = new TestAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.agent.name).toBe('test-agent');
    expect(caps.features.streaming.messages).toBe(true);
  });
});
```

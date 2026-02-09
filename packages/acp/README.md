# @agentap-dev/acp

**Agent Context Protocol** — the type-safe protocol specification that powers communication between AI coding agents and the Agentap mobile bridge.

ACP defines the unified event stream, command interface, and capability negotiation system that lets any AI agent be monitored and controlled from a mobile device.

## Installation

```bash
pnpm add @agentap-dev/acp
```

> **Note:** This package has zero runtime dependencies. It's primarily TypeScript type definitions with a small set of helper functions.

## Overview

ACP is a protocol-first package. It defines:

- **Events** — A unified stream of 30+ typed events flowing from agent to consumer (session lifecycle, message streaming, tool execution, approvals, file changes, etc.)
- **Commands** — Typed messages flowing from consumer to agent (send message, approve/deny tool calls, pause/resume, etc.)
- **Capabilities** — A negotiation system where adapters declare what features they support, so UIs can adapt accordingly
- **Helpers** — Utility functions for event creation, tool categorization, risk assessment, and human-readable descriptions

### Architecture

```
┌─────────────┐    ACPEvent stream    ┌─────────────┐
│             │ ───────────────────►  │             │
│  AI Agent   │                       │   Consumer  │
│  (adapter)  │ ◄───────────────────  │  (mobile/   │
│             │    ACPCommand          │   desktop)  │
└─────────────┘                       └─────────────┘
        │
        ▼
  ACPCapabilities
  (feature negotiation)
```

## Core Concepts

### Protocol Version

```typescript
import { ACP_VERSION, ACP_MIN_VERSION } from '@agentap-dev/acp';

// ACP_VERSION = '1.0.0'
// ACP_MIN_VERSION = '1.0.0'
```

### Events

Every event extends `ACPEventBase` and includes automatic sequencing:

```typescript
interface ACPEventBase {
  seq: number; // Monotonically increasing per session
  sessionId: string; // Session this event belongs to
  timestamp: string; // ISO 8601
}
```

Events are a discriminated union on the `type` field. You can filter by prefix using `ACPEventByPrefix`:

```typescript
import type { ACPEvent, ACPEventByPrefix } from '@agentap-dev/acp';

// All tool-related events
type ToolEvents = ACPEventByPrefix<'tool:'>;

// Handle events
function handleEvent(event: ACPEvent) {
  switch (event.type) {
    case 'message:delta':
      console.log(event.delta); // Streaming text
      break;
    case 'tool:executing':
      console.log(event.name, event.riskLevel);
      break;
    case 'approval:requested':
      console.log(event.description, event.preview);
      break;
  }
}
```

### Commands

Commands flow from the consumer (mobile app) to the agent:

```typescript
import type { ACPCommand } from '@agentap-dev/acp';

const commands: ACPCommand[] = [
  { command: 'send_message', message: 'Fix the login bug' },
  { command: 'approve_tool_call', requestId: 'req-1', toolCallId: 'tc-1' },
  { command: 'deny_tool_call', requestId: 'req-1', toolCallId: 'tc-1', reason: 'Too risky' },
  { command: 'cancel' },
  { command: 'pause' },
  { command: 'resume', prompt: 'Continue with the tests' },
  { command: 'terminate' },
  { command: 'answer_question', questionId: 'q-1', answer: 'Use PostgreSQL' },
  {
    command: 'set_permission_policy',
    policy: {
      autoApprove: {
        reads: true,
        writes: ['src/**/*.ts'], // Glob patterns
        commands: ['npm test'], // Glob patterns
        searches: true,
      },
    },
  },
];
```

### Capabilities

Adapters declare what they support so consumers can adapt their UI:

```typescript
import type { ACPCapabilities } from '@agentap-dev/acp';

const capabilities: ACPCapabilities = {
  protocolVersion: '1.0.0',
  agent: {
    name: 'claude-code',
    displayName: 'Claude Code',
    icon: '🟠',
    version: '1.0.0',
    integrationMethod: 'sdk', // 'sdk' | 'http' | 'pty' | 'file-watch' | 'mcp'
  },
  features: {
    streaming: { messages: true, toolArgs: false, thinking: true },
    approval: { toolCalls: true, preview: true },
    sessionControl: { pause: false, resume: true, cancel: true },
    subAgents: true,
    planning: { todos: true, planMode: true },
    resources: { tokenUsage: true, costTracking: false, contextWindow: false },
    fileOperations: { diffs: true, batchedChanges: false },
    git: true,
    webSearch: true,
    multimodal: true,
    userInteraction: { questions: true, notifications: false },
    thinking: true,
    customEvents: [],
  },
};
```

## Event Reference

### Session Lifecycle

| Event                    | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `session:started`        | Session initialized with project context                     |
| `session:resumed`        | Session resumed from previous state                          |
| `session:paused`         | Session paused by user or system                             |
| `session:completed`      | Session finished with summary (files changed, tokens, cost)  |
| `session:error`          | Session-level error occurred                                 |
| `session:status_changed` | Status transition (e.g., `running` → `waiting_for_approval`) |

**Session statuses:** `starting` | `running` | `thinking` | `waiting_for_input` | `waiting_for_approval` | `paused` | `idle` | `completed` | `error`

### Message Streaming

| Event              | Description                                 |
| ------------------ | ------------------------------------------- |
| `message:start`    | New message began (with role and ID)        |
| `message:delta`    | Streaming text chunk                        |
| `message:complete` | Full message with structured content blocks |

Message content is an array of typed blocks:

```typescript
type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean };
```

### Thinking

| Event               | Description                           |
| ------------------- | ------------------------------------- |
| `thinking:start`    | Agent began thinking                  |
| `thinking:delta`    | Streaming thinking text               |
| `thinking:complete` | Thinking finished (may be `redacted`) |

### Tool Execution

| Event             | Description                                               |
| ----------------- | --------------------------------------------------------- |
| `tool:start`      | Tool call initiated with category and description         |
| `tool:args_delta` | Streaming JSON arguments (for large inputs)               |
| `tool:executing`  | Tool about to execute with risk level and approval status |
| `tool:result`     | Tool completed with output and duration                   |
| `tool:error`      | Tool failed with error details                            |

**Tool categories:** `file_read` | `file_write` | `file_edit` | `terminal` | `search` | `web` | `git` | `mcp` | `agent` | `other`

**Risk levels:** `low` | `medium` | `high` | `critical`

**Structured output types:**

```typescript
type ToolStructuredOutput =
  | {
      type: 'file_diff';
      path: string;
      diff: string;
      changeType: 'created' | 'modified' | 'deleted';
    }
  | { type: 'search_results'; results: Array<{ file: string; line: number; content: string }> }
  | { type: 'command_output'; exitCode: number; stdout: string; stderr: string }
  | { type: 'web_content'; url: string; title?: string; summary?: string };
```

### Approval Flow

| Event                | Description                                         |
| -------------------- | --------------------------------------------------- |
| `approval:requested` | Agent needs approval for a tool call (with preview) |
| `approval:resolved`  | Approval resolved (by user, policy, or timeout)     |

Approval previews give the consumer context to make a decision:

```typescript
type ApprovalPreview =
  | { type: 'diff'; path: string; diff: string }
  | { type: 'command'; command: string; workingDir: string }
  | { type: 'description'; text: string };
```

### File Operations

| Event         | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `file:change` | Single file created, modified, or deleted (with optional diff) |
| `file:batch`  | Multiple file changes grouped together                         |

### Sub-Agents

| Event                | Description                            |
| -------------------- | -------------------------------------- |
| `subagent:spawned`   | Child agent launched for a sub-task    |
| `subagent:progress`  | Progress update from sub-agent (0-100) |
| `subagent:completed` | Sub-agent finished with result         |

### Progress & Planning

| Event                  | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `progress:todo_update` | Todo list updated (items with `pending`/`in_progress`/`completed` status) |
| `progress:plan_mode`   | Plan mode entered or exited                                               |
| `progress:update`      | Generic progress update with optional percentage                          |

### Resource Usage

| Event                     | Description                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `resource:token_usage`    | Token counts (delta and cumulative, including cache tokens) |
| `resource:cost`           | Cost breakdown (delta and cumulative)                       |
| `resource:context_window` | Context window utilization percentage                       |
| `resource:rate_limit`     | Rate limit hit with retry-after                             |

### Environment

| Event              | Description                             |
| ------------------ | --------------------------------------- |
| `environment:info` | Agent, model, project, and runtime info |

### User Interaction

| Event                      | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `interaction:question`     | Agent asking the user a question (with options) |
| `interaction:notification` | Info/warning/error/success notification         |

### Git & Web

| Event           | Description                                               |
| --------------- | --------------------------------------------------------- |
| `git:operation` | Git operation performed (commit, branch, push, PR, stash) |
| `web:operation` | Web search or fetch operation                             |

### Custom Events

For adapter-specific extensions:

```typescript
interface CustomEvent extends ACPEventBase {
  type: 'custom';
  namespace: string; // e.g., 'mycompany:analytics'
  eventName: string;
  data: Record<string, unknown>;
}
```

## Adapter & Session Interfaces

These interfaces define the contract that adapters must implement:

### ACPAdapter

```typescript
interface ACPAdapter {
  // Detection
  getCapabilities(): ACPCapabilities;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getDataPaths(): AgentDataPaths;

  // Session discovery
  discoverSessions(): Promise<DiscoveredSession[]>;
  watchSessions(callback: (event: SessionDiscoveryEvent) => void): () => void;

  // Session control
  attachToSession(sessionId: string): Promise<ACPSession>;
  startSession(options: StartSessionOptions): Promise<ACPSession>;
}
```

### ACPSession

```typescript
interface ACPSession {
  readonly sessionId: string;
  readonly capabilities: ACPCapabilities;

  // Unified event stream
  onEvent(callback: (event: ACPEvent) => void): () => void;

  // Send commands
  execute(command: ACPCommand): Promise<void>;

  // Replay past events
  getHistory(): Promise<ACPEvent[]>;

  // Disconnect without terminating the agent
  detach(): Promise<void>;
}
```

## Helper Functions

### `createEvent` — Event Factory

Creates properly-formed events with automatic sequencing and timestamps:

```typescript
import { createEvent, resetSequence } from '@agentap-dev/acp';

const event = createEvent('session-123', {
  type: 'message:delta',
  messageId: 'msg-1',
  role: 'assistant',
  delta: 'Hello ',
});
// → { seq: 1, sessionId: 'session-123', timestamp: '2025-...', type: 'message:delta', ... }

const next = createEvent('session-123', {
  type: 'message:delta',
  messageId: 'msg-1',
  role: 'assistant',
  delta: 'world!',
});
// → { seq: 2, ... } — auto-incremented

// Reset sequence for a session (e.g., on reconnect)
resetSequence('session-123');
```

### `categorizeTool` — Tool Classification

Maps tool names to categories for UI grouping:

```typescript
import { categorizeTool } from '@agentap-dev/acp';

categorizeTool('Read'); // → 'file_read'
categorizeTool('Write'); // → 'file_write'
categorizeTool('Edit'); // → 'file_edit'
categorizeTool('Bash'); // → 'terminal'
categorizeTool('Glob'); // → 'file_read'
categorizeTool('Grep'); // → 'file_read'
categorizeTool('WebSearch'); // → 'web'
categorizeTool('WebFetch'); // → 'web'
categorizeTool('Task'); // → 'agent'
```

### `assessRisk` — Risk Level Assessment

Determines the risk level of a tool call based on name and input:

```typescript
import { assessRisk } from '@agentap-dev/acp';

assessRisk('Read', { file_path: '/src/index.ts' }); // → 'low'
assessRisk('Write', { file_path: '/src/index.ts' }); // → 'medium'
assessRisk('Edit', { file_path: '/src/index.ts' }); // → 'medium'
assessRisk('Bash', { command: 'npm test' }); // → 'medium' (install command)
assessRisk('Bash', { command: 'rm -rf /' }); // → 'high' (dangerous command)
```

### `describeToolCall` — Human-Readable Descriptions

Generates short descriptions for display in the UI:

```typescript
import { describeToolCall } from '@agentap-dev/acp';

describeToolCall('Read', { file_path: '/src/index.ts' }); // → 'Read: /src/index.ts'
describeToolCall('Bash', { command: 'npm test' }); // → 'Run: npm test'
describeToolCall('Grep', { pattern: 'TODO' }); // → 'Grep: TODO'
describeToolCall('WebSearch', { query: 'react hooks' }); // → 'Search: react hooks'
```

## Error Model

All errors in ACP follow a consistent structure:

```typescript
interface ACPError {
  code: string; // Machine-readable error code
  message: string; // Human-readable description
  recoverable: boolean; // Can the session continue?
  details?: unknown; // Additional context
  agentCode?: string; // Agent-specific error code
}
```

## Protocol Flow

### Typical Session Lifecycle

```
1. adapter.isInstalled()         → Check agent availability
2. adapter.getCapabilities()     → Negotiate features
3. adapter.discoverSessions()    → Find existing sessions
4. adapter.attachToSession(id)   → Connect to session
   OR adapter.startSession(opts) → Start new session

5. session.onEvent(callback)     → Subscribe to event stream
   Events flow:
   ├── session:started
   ├── session:status_changed (idle → running)
   ├── message:start → message:delta... → message:complete
   ├── tool:start → tool:executing → tool:result
   ├── approval:requested → (user decision) → approval:resolved
   ├── resource:token_usage
   └── session:completed (with summary)

6. session.execute(command)      → Send commands back
7. session.detach()              → Disconnect (agent keeps running)
```

### Tool Approval Flow

```
Agent wants to run risky tool
        │
        ▼
  tool:start          (tool initiated)
  tool:args_delta     (streaming arguments)
  tool:executing      (risk assessed, requiresApproval: true)
  approval:requested  (sent to mobile with preview)
        │
        ▼
  User reviews on mobile
  ┌─────────┬──────────┐
  │ Approve │  Deny    │  Timeout
  └────┬────┴────┬─────┘     │
       ▼         ▼           ▼
  approval:resolved (approved/denied/timeout)
       │         │
       ▼         ▼
  tool:result  tool:error
```

## Full Type Exports

<details>
<summary>Click to expand complete export list</summary>

```typescript
// Version
export { ACP_VERSION, ACP_MIN_VERSION };

// Core types
export type { ACPError };
export type { ACPEventBase, ACPEvent, ACPEventByPrefix };
export type { ACPCapabilities, IntegrationMethod };

// Commands
export type {
  ACPCommand,
  SendMessageCommand,
  ApproveToolCallCommand,
  DenyToolCallCommand,
  AnswerQuestionCommand,
  CancelCommand,
  PauseCommand,
  ResumeCommand,
  TerminateCommand,
  SetPermissionPolicyCommand,
  PermissionPolicy,
};

// Adapter & Session
export type {
  ACPAdapter,
  ACPSession,
  AgentDataPaths,
  DiscoveredSession,
  SessionDiscoveryEvent,
  StartSessionOptions,
};

// Session events
export type {
  SessionStatus,
  SessionStartedEvent,
  SessionResumedEvent,
  SessionPausedEvent,
  SessionCompletedEvent,
  SessionErrorEvent,
  SessionStatusChangedEvent,
  SessionSummary,
};

// Message events
export type {
  MessageRole,
  MessageContent,
  MessageStartEvent,
  MessageDeltaEvent,
  MessageCompleteEvent,
};

// Thinking events
export type { ThinkingStartEvent, ThinkingDeltaEvent, ThinkingCompleteEvent };

// Tool events
export type {
  ToolCategory,
  RiskLevel,
  ToolStructuredOutput,
  ToolCallStartEvent,
  ToolCallArgsDeltaEvent,
  ToolCallExecutingEvent,
  ToolCallResultEvent,
  ToolCallErrorEvent,
};

// Approval events
export type { ApprovalPreview, ApprovalRequestedEvent, ApprovalResolvedEvent };

// File events
export type { FileChangeEvent, FileChangeBatchEvent, FileChangeSummary };

// Sub-agent events
export type { SubAgentSpawnedEvent, SubAgentProgressEvent, SubAgentCompletedEvent };

// Progress events
export type { TodoUpdateEvent, PlanModeEvent, ProgressEvent };

// Resource events
export type {
  TokenUsage,
  CostBreakdown,
  TokenUsageEvent,
  CostUpdateEvent,
  ContextWindowEvent,
  RateLimitEvent,
};

// Environment events
export type { EnvironmentContext, EnvironmentInfoEvent };

// Interaction events
export type { UserQuestionEvent, NotificationEvent };

// Git & Web events
export type { GitOperation, GitOperationEvent, WebOperation, WebOperationEvent };

// Custom events
export type { CustomEvent };

// Helpers
export {
  createEvent,
  resetSequence,
  resetAllSequences,
  categorizeTool,
  assessRisk,
  describeToolCall,
};
```

</details>

## Contributing

### Adding a New Event Type

1. Create or edit the event file in `src/events/` (group by domain)
2. Export the new type from `src/events/index.ts`
3. Add the event to the `ACPEvent` union in `src/envelope.ts`
4. Re-export the type from `src/index.ts`
5. Update this README with the new event in the reference table

### Adding a New Command

1. Define the command interface in `src/commands.ts`
2. Add it to the `ACPCommand` union type
3. Re-export from `src/index.ts`

### Adding a New Helper

1. Create the helper in `src/helpers/`
2. Export from `src/helpers/index.ts`
3. Re-export from `src/index.ts`
4. Add tests in `src/__tests__/`

### Development

```bash
pnpm build          # Build CJS + ESM + types
pnpm dev            # Watch mode
pnpm typecheck      # Type check
pnpm test           # Run tests
pnpm test:coverage  # Coverage report
```

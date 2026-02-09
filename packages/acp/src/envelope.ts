import type {
  SessionStartedEvent,
  SessionResumedEvent,
  SessionPausedEvent,
  SessionCompletedEvent,
  SessionErrorEvent,
  SessionStatusChangedEvent,
} from './events/session';
import type { MessageStartEvent, MessageDeltaEvent, MessageCompleteEvent } from './events/message';
import type {
  ThinkingStartEvent,
  ThinkingDeltaEvent,
  ThinkingCompleteEvent,
} from './events/thinking';
import type {
  ToolCallStartEvent,
  ToolCallArgsDeltaEvent,
  ToolCallExecutingEvent,
  ToolCallResultEvent,
  ToolCallErrorEvent,
} from './events/tool';
import type { ApprovalRequestedEvent, ApprovalResolvedEvent } from './events/approval';
import type { FileChangeEvent, FileChangeBatchEvent } from './events/file';
import type {
  SubAgentSpawnedEvent,
  SubAgentProgressEvent,
  SubAgentCompletedEvent,
} from './events/subagent';
import type { TodoUpdateEvent, PlanModeEvent, ProgressEvent } from './events/progress';
import type {
  TokenUsageEvent,
  CostUpdateEvent,
  ContextWindowEvent,
  RateLimitEvent,
} from './events/resource';
import type { EnvironmentInfoEvent } from './events/environment';
import type { UserQuestionEvent, NotificationEvent } from './events/interaction';
import type { GitOperationEvent } from './events/git';
import type { WebOperationEvent } from './events/web';
import type { CustomEvent } from './events/custom';

/**
 * Base envelope for every ACP event.
 * All events carry a sequence number, session ID, and timestamp.
 */
export interface ACPEventBase {
  /** Monotonically increasing sequence number within a session */
  seq: number;
  /** Session this event belongs to */
  sessionId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * The full ACP event discriminated union.
 * Consumers filter on `event.type` using colon-separated flat namespace.
 */
export type ACPEvent =
  // Session lifecycle
  | SessionStartedEvent
  | SessionResumedEvent
  | SessionPausedEvent
  | SessionCompletedEvent
  | SessionErrorEvent
  | SessionStatusChangedEvent
  // Messages
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageCompleteEvent
  // Thinking
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingCompleteEvent
  // Tool execution
  | ToolCallStartEvent
  | ToolCallArgsDeltaEvent
  | ToolCallExecutingEvent
  | ToolCallResultEvent
  | ToolCallErrorEvent
  // Approval
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  // File operations
  | FileChangeEvent
  | FileChangeBatchEvent
  // Sub-agents
  | SubAgentSpawnedEvent
  | SubAgentProgressEvent
  | SubAgentCompletedEvent
  // Progress & planning
  | TodoUpdateEvent
  | PlanModeEvent
  | ProgressEvent
  // Resource usage
  | TokenUsageEvent
  | CostUpdateEvent
  | ContextWindowEvent
  | RateLimitEvent
  // Environment
  | EnvironmentInfoEvent
  // User interaction
  | UserQuestionEvent
  | NotificationEvent
  // Git operations
  | GitOperationEvent
  // Web/search operations
  | WebOperationEvent
  // Custom (extension point)
  | CustomEvent;

/** Extract ACPEvent variants by type prefix (e.g. 'session:', 'tool:') */
export type ACPEventByPrefix<P extends string> = Extract<ACPEvent, { type: `${P}${string}` }>;

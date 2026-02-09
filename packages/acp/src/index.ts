// Version
export { ACP_VERSION, ACP_MIN_VERSION } from './version';

// Error
export type { ACPError } from './error';

// Envelope
export type { ACPEventBase, ACPEvent, ACPEventByPrefix } from './envelope';

// Capabilities
export type { ACPCapabilities, IntegrationMethod } from './capabilities';

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
} from './commands';

// Adapter & Session interfaces
export type {
  ACPAdapter,
  ACPSession,
  AgentDataPaths,
  DiscoveredSession,
  SessionDiscoveryEvent,
  StartSessionOptions,
} from './adapter';

// All event types
export type {
  // Session
  SessionStatus,
  SessionStartedEvent,
  SessionResumedEvent,
  SessionPausedEvent,
  SessionCompletedEvent,
  SessionErrorEvent,
  SessionStatusChangedEvent,
  SessionSummary,
  // Message
  MessageRole,
  MessageContent,
  MessageStartEvent,
  MessageDeltaEvent,
  MessageCompleteEvent,
  // Thinking
  ThinkingStartEvent,
  ThinkingDeltaEvent,
  ThinkingCompleteEvent,
  // Tool
  ToolCategory,
  RiskLevel,
  ToolStructuredOutput,
  ToolCallStartEvent,
  ToolCallArgsDeltaEvent,
  ToolCallExecutingEvent,
  ToolCallResultEvent,
  ToolCallErrorEvent,
  // Approval
  ApprovalPreview,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  // File
  FileChangeEvent,
  FileChangeBatchEvent,
  FileChangeSummary,
  // Sub-agent
  SubAgentSpawnedEvent,
  SubAgentProgressEvent,
  SubAgentCompletedEvent,
  // Progress
  TodoUpdateEvent,
  PlanModeEvent,
  ProgressEvent,
  // Resource
  TokenUsage,
  CostBreakdown,
  TokenUsageEvent,
  CostUpdateEvent,
  ContextWindowEvent,
  RateLimitEvent,
  // Environment
  EnvironmentContext,
  EnvironmentInfoEvent,
  // Interaction
  UserQuestionEvent,
  NotificationEvent,
  // Git
  GitOperation,
  GitOperationEvent,
  // Web
  WebOperation,
  WebOperationEvent,
  // Custom
  CustomEvent,
} from './events';

// Helpers
export {
  categorizeTool,
  assessRisk,
  describeToolCall,
  createEvent,
  resetSequence,
  resetAllSequences,
} from './helpers';

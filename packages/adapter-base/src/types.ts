/**
 * Re-export all ACP types for adapter consumers.
 * adapter-base is now a thin layer on top of @agentap-dev/acp.
 */
export type {
  // Core protocol
  ACPEvent,
  ACPEventBase,
  ACPEventByPrefix,
  ACPError,
  ACPCapabilities,
  ACPCommand,
  ACPAdapter,
  ACPSession,
  IntegrationMethod,

  // Adapter types
  AgentDataPaths,
  DiscoveredSession,
  SessionDiscoveryEvent,
  StartSessionOptions,

  // Events
  SessionStatus,
  SessionSummary,
  MessageRole,
  MessageContent,
  RiskLevel,
  ToolCategory,
  ToolStructuredOutput,
  ApprovalPreview,
  FileChangeSummary,
  TokenUsage,
  CostBreakdown,
  EnvironmentContext,
  PermissionPolicy,
  GitOperation,
  WebOperation,
} from '@agentap-dev/acp';

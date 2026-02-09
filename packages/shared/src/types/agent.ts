/**
 * Display types for agent sessions
 *
 * These types represent the UI-facing state. ACP events are processed
 * by the sessions store into these display types.
 */

// Re-export useful types from ACP
export type { RiskLevel, ToolCategory, ACPCapabilities } from '@agentap-dev/acp';

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'thinking'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'paused'
  | 'idle'
  | 'completed'
  | 'error';

export type AgentMode = 'ask' | 'auto' | 'plan';

export interface AgentSession {
  id: string;
  agent: string;
  machineId: string;
  projectPath: string;
  projectName: string;
  status: SessionStatus;
  lastMessage: string | null;
  lastActivity: Date;
  createdAt: Date;
  sessionName: string | null;
  model: string | null;
  agentMode: AgentMode | null;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: Date;
  isPartial?: boolean;
  thinking?: string;
  isThinking?: boolean;
}

export interface ToolCall {
  id: string;
  sessionId: string;
  name: string;
  category?: string;
  description?: string;
  input: Record<string, unknown>;
  status: ToolCallStatus;
  output?: string;
  error?: string;
  riskLevel?: string;
  startedAt: Date;
  completedAt?: Date;
}

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error' | 'denied';

export interface ApprovalRequest {
  id: string;
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
  riskLevel: string;
  preview?: {
    type: 'diff' | 'command' | 'description';
    content: string;
  };
  expiresAt: Date;
  createdAt: Date;
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  diff?: string;
}

export interface SessionSummary {
  filesChanged: string[];
  tokensUsed: {
    input: number;
    output: number;
  };
  duration: number;
  toolCallsCount: number;
}

import type { ACPEventBase } from '../envelope';
import type { ACPError } from '../error';
import type { EnvironmentContext } from './environment';
import type { TokenUsage, CostBreakdown } from './resource';
import type { FileChangeSummary } from './file';

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

export interface SessionStartedEvent extends ACPEventBase {
  type: 'session:started';
  agent: string;
  projectPath: string;
  projectName: string;
  model?: string;
  workingDirectory: string;
  environment?: EnvironmentContext;
}

export interface SessionResumedEvent extends ACPEventBase {
  type: 'session:resumed';
  previousSessionId?: string;
}

export interface SessionPausedEvent extends ACPEventBase {
  type: 'session:paused';
  reason?: string;
}

export interface SessionCompletedEvent extends ACPEventBase {
  type: 'session:completed';
  summary: SessionSummary;
}

export interface SessionErrorEvent extends ACPEventBase {
  type: 'session:error';
  error: ACPError;
}

export interface SessionStatusChangedEvent extends ACPEventBase {
  type: 'session:status_changed';
  from: SessionStatus;
  to: SessionStatus;
  reason?: string;
}

export interface SessionSummary {
  filesChanged: FileChangeSummary[];
  tokenUsage: TokenUsage;
  cost?: CostBreakdown;
  duration: number;
  toolCallsCount: number;
  messagesCount: number;
  errorCount: number;
}

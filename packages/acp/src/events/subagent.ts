import type { ACPEventBase } from '../envelope';
import type { TokenUsage } from './resource';

export interface SubAgentSpawnedEvent extends ACPEventBase {
  type: 'subagent:spawned';
  subAgentId: string;
  parentToolCallId: string;
  task: string;
  model?: string;
}

export interface SubAgentProgressEvent extends ACPEventBase {
  type: 'subagent:progress';
  subAgentId: string;
  message: string;
  progress?: number;
}

export interface SubAgentCompletedEvent extends ACPEventBase {
  type: 'subagent:completed';
  subAgentId: string;
  parentToolCallId: string;
  result: string;
  tokenUsage?: TokenUsage;
}

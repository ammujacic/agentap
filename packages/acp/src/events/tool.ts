import type { ACPEventBase } from '../envelope';
import type { ACPError } from '../error';

export type ToolCategory =
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'terminal'
  | 'search'
  | 'web'
  | 'git'
  | 'mcp'
  | 'agent'
  | 'other';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolStructuredOutput =
  | {
      type: 'file_diff';
      path: string;
      diff: string;
      changeType: 'created' | 'modified' | 'deleted';
    }
  | {
      type: 'search_results';
      results: Array<{ file: string; line: number; content: string }>;
    }
  | {
      type: 'command_output';
      exitCode: number;
      stdout: string;
      stderr: string;
    }
  | {
      type: 'web_content';
      url: string;
      title?: string;
      summary?: string;
    };

export interface ToolCallStartEvent extends ACPEventBase {
  type: 'tool:start';
  toolCallId: string;
  name: string;
  category: ToolCategory;
  description?: string;
}

export interface ToolCallArgsDeltaEvent extends ACPEventBase {
  type: 'tool:args_delta';
  toolCallId: string;
  delta: string;
}

export interface ToolCallExecutingEvent extends ACPEventBase {
  type: 'tool:executing';
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

export interface ToolCallResultEvent extends ACPEventBase {
  type: 'tool:result';
  toolCallId: string;
  name: string;
  output: string;
  duration: number;
  structured?: ToolStructuredOutput;
}

export interface ToolCallErrorEvent extends ACPEventBase {
  type: 'tool:error';
  toolCallId: string;
  name: string;
  error: ACPError;
  duration?: number;
}

/**
 * WebSocket wire protocol types — ACP-based
 */

import type { ACPEvent, ACPCommand, ACPCapabilities } from '@agentap-dev/acp';
import type { AgentSession } from './agent';

// ============================================================================
// Client → Daemon Messages
// ============================================================================

export type ClientMessage =
  | AuthMessage
  | PingMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | CommandMessage
  | StartSessionMessage
  | TerminateSessionMessage;

export interface AuthMessage {
  type: 'auth';
  token: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface SubscribeMessage {
  type: 'subscribe';
  sessionIds?: string[];
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  sessionIds: string[];
}

export interface CommandMessage {
  type: 'command';
  sessionId: string;
  command: ACPCommand;
}

export interface StartSessionMessage {
  type: 'start_session';
  agent: string;
  projectPath: string;
  prompt: string;
}

export interface TerminateSessionMessage {
  type: 'terminate_session';
  sessionId: string;
}

// ============================================================================
// Daemon → Client Messages
// ============================================================================

export type ServerMessage =
  | AuthSuccessMessage
  | AuthErrorMessage
  | SessionsListMessage
  | ACPEventMessage
  | HistoryCompleteMessage
  | ErrorMessage
  | PongMessage
  | LinkSuccessMessage;

export interface AuthSuccessMessage {
  type: 'auth_success';
  machineName: string;
  machineId: string;
  capabilities: ACPCapabilities[];
}

export interface AuthErrorMessage {
  type: 'auth_error';
  message: string;
}

export interface SessionsListMessage {
  type: 'sessions_list';
  sessions: AgentSession[];
}

export interface ACPEventMessage {
  type: 'acp_event';
  event: ACPEvent;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  code: string;
}

export interface PongMessage {
  type: 'pong';
}

export interface HistoryCompleteMessage {
  type: 'history_complete';
  sessionId: string;
}

export interface LinkSuccessMessage {
  type: 'link_success';
  userId: string;
}

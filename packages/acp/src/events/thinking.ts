import type { ACPEventBase } from '../envelope';

export interface ThinkingStartEvent extends ACPEventBase {
  type: 'thinking:start';
  messageId: string;
}

export interface ThinkingDeltaEvent extends ACPEventBase {
  type: 'thinking:delta';
  messageId: string;
  delta: string;
}

export interface ThinkingCompleteEvent extends ACPEventBase {
  type: 'thinking:complete';
  messageId: string;
  content: string;
  redacted?: boolean;
}

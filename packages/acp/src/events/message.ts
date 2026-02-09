import type { ACPEventBase } from '../envelope';

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean };

export interface MessageStartEvent extends ACPEventBase {
  type: 'message:start';
  messageId: string;
  role: MessageRole;
}

export interface MessageDeltaEvent extends ACPEventBase {
  type: 'message:delta';
  messageId: string;
  role: MessageRole;
  delta: string;
}

export interface MessageCompleteEvent extends ACPEventBase {
  type: 'message:complete';
  messageId: string;
  role: MessageRole;
  content: MessageContent[];
  model?: string;
  stopReason?: string;
}

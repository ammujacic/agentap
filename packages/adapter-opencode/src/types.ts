/**
 * OpenCode storage file types — derived from actual JSON files in
 * ~/.local/share/opencode/storage/
 */

// ── Session file: storage/session/{projectID}/{sessionID}.json ──

export interface OpenCodeSessionFile {
  id: string;
  slug: string;
  version: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  time: {
    created: number; // ms epoch
    updated: number;
    compacting?: number;
    archived?: number;
  };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
  };
  share?: { url: string };
}

// ── Message files: storage/message/{sessionID}/{messageID}.json ──

export interface OpenCodeUserMessage {
  id: string;
  sessionID: string;
  role: 'user';
  time: { created: number };
  summary?: {
    title?: string;
    body?: string;
    diffs: unknown[];
  };
  agent: string;
  model: {
    providerID: string;
    modelID: string;
  };
  system?: string;
}

export interface OpenCodeAssistantMessage {
  id: string;
  sessionID: string;
  role: 'assistant';
  time: {
    created: number;
    completed?: number;
  };
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string;
  agent: string;
  path: {
    cwd: string;
    root: string;
  };
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  finish?: string;
  error?: { name: string; message?: string; [key: string]: unknown };
}

export type OpenCodeMessageFile = OpenCodeUserMessage | OpenCodeAssistantMessage;

// ── Part files: storage/part/{messageID}/{partID}.json ──

interface OpenCodePartBase {
  id: string;
  sessionID: string;
  messageID: string;
}

export interface OpenCodeTextPart extends OpenCodePartBase {
  type: 'text';
  text: string;
  synthetic?: boolean;
  time?: { start: number; end?: number };
}

export interface OpenCodeReasoningPart extends OpenCodePartBase {
  type: 'reasoning';
  text: string;
  time: { start: number; end?: number };
}

export interface OpenCodeToolPart extends OpenCodePartBase {
  type: 'tool';
  callID: string;
  tool: string;
  state:
    | {
        status: 'pending';
        input: Record<string, unknown>;
        raw: string;
      }
    | {
        status: 'running';
        input: Record<string, unknown>;
        title?: string;
        time: { start: number };
      }
    | {
        status: 'completed';
        input: Record<string, unknown>;
        output: string;
        title: string;
        metadata: Record<string, unknown>;
        time: { start: number; end: number };
      }
    | {
        status: 'error';
        input: Record<string, unknown>;
        error: string;
        time: { start: number; end: number };
      };
}

export interface OpenCodeStepStartPart extends OpenCodePartBase {
  type: 'step-start';
  snapshot: string;
}

export interface OpenCodeStepFinishPart extends OpenCodePartBase {
  type: 'step-finish';
  reason: string;
  snapshot: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}

export type OpenCodePartFile =
  | OpenCodeTextPart
  | OpenCodeReasoningPart
  | OpenCodeToolPart
  | OpenCodeStepStartPart
  | OpenCodeStepFinishPart;

// ── Permission (HTTP API only — not persisted to storage) ──

export interface OpenCodePermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

// ── SSE event shape from GET /event ──

export interface OpenCodeSSEEvent {
  type: string;
  properties: Record<string, unknown>;
}

// ── Server info from GET /global/health ──

export interface ServerInfo {
  url: string;
  version: string;
}

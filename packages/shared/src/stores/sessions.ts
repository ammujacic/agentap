/**
 * Agent sessions store — processes ACP events into display state
 */

import { create } from 'zustand';
import type { ACPEvent } from '@agentap-dev/acp';
import { extractSessionTitle } from '../utils';
import type { AgentSession, AgentMessage, ToolCall, ApprovalRequest } from '../types/agent';

// ── Pure event processing helper ─────────────────────────────
// Operates on mutable arrays so both live and batch paths can share logic.

interface MutableSessionState {
  messages: AgentMessage[];
  toolCalls: ToolCall[];
  sessions: AgentSession[];
  pendingApprovals: ApprovalRequest[];
}

function upsertMessage(messages: AgentMessage[], msg: AgentMessage): void {
  const idx = messages.findIndex((m) => m.id === msg.id);
  if (idx >= 0) messages[idx] = msg;
  else messages.push(msg);
}

function applyACPEvent(state: MutableSessionState, event: ACPEvent): void {
  const sessionId = event.sessionId;

  switch (event.type) {
    case 'session:status_changed': {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.status = event.to;
        session.lastActivity = new Date();
      }
      break;
    }

    case 'session:completed': {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) session.status = 'completed';
      break;
    }

    case 'session:error': {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) session.status = 'error';
      break;
    }

    case 'message:start':
      upsertMessage(state.messages, {
        id: event.messageId,
        sessionId,
        role: event.role,
        content: '',
        timestamp: new Date(event.timestamp),
        isPartial: true,
      });
      break;

    case 'message:delta': {
      const existing = state.messages.find((m) => m.id === event.messageId);
      const previousContent = existing?.content ?? '';

      upsertMessage(state.messages, {
        id: event.messageId,
        sessionId,
        role: event.role,
        content: previousContent + event.delta,
        timestamp: new Date(event.timestamp),
        isPartial: true,
      });

      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) session.lastActivity = new Date();
      break;
    }

    case 'message:complete': {
      const textParts = event.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text);
      const fullContent = textParts.join('');

      upsertMessage(state.messages, {
        id: event.messageId,
        sessionId,
        role: event.role,
        content: fullContent,
        timestamp: new Date(event.timestamp),
        isPartial: false,
      });

      if (event.role === 'user' && fullContent) {
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session && !session.sessionName) {
          const title = extractSessionTitle(fullContent);
          if (title) session.sessionName = title;
        }
      }

      if (event.role === 'assistant' && fullContent) {
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.lastMessage = fullContent;
          session.lastActivity = new Date();
        }
      }
      break;
    }

    case 'tool:start':
      if (!state.toolCalls.some((t) => t.id === event.toolCallId)) {
        state.toolCalls.push({
          id: event.toolCallId,
          sessionId,
          name: event.name,
          category: event.category,
          description: event.description,
          input: {},
          status: 'pending',
          startedAt: new Date(event.timestamp),
        });
      }
      break;

    case 'tool:executing': {
      const tool = state.toolCalls.find((t) => t.id === event.toolCallId);
      if (tool) {
        tool.input = event.input as Record<string, unknown>;
        tool.status = 'running';
        tool.riskLevel = event.riskLevel;
      }
      break;
    }

    case 'tool:result': {
      const tool = state.toolCalls.find((t) => t.id === event.toolCallId);
      if (tool) {
        tool.status = 'completed';
        tool.output = event.output;
        tool.completedAt = new Date(event.timestamp);
      }
      break;
    }

    case 'tool:error': {
      const tool = state.toolCalls.find((t) => t.id === event.toolCallId);
      if (tool) {
        tool.status = 'error';
        tool.error = event.error.message;
        tool.completedAt = new Date(event.timestamp);
      }
      break;
    }

    case 'approval:requested': {
      if (!state.pendingApprovals.some((a) => a.id === event.toolCallId)) {
        let preview: ApprovalRequest['preview'];
        if (event.preview) {
          if (event.preview.type === 'diff') {
            preview = {
              type: 'diff',
              content: event.preview.diff,
            };
          } else if (event.preview.type === 'command') {
            preview = {
              type: 'command',
              content: event.preview.command,
            };
          } else {
            preview = {
              type: 'description',
              content: event.preview.text,
            };
          }
        }

        state.pendingApprovals.push({
          id: event.toolCallId,
          requestId: event.requestId,
          sessionId,
          toolName: event.toolName,
          toolInput: event.toolInput as Record<string, unknown>,
          description: event.description,
          riskLevel: event.riskLevel,
          preview,
          expiresAt: new Date(event.expiresAt),
          createdAt: new Date(event.timestamp),
        });
      }

      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) session.status = 'waiting_for_approval';
      break;
    }

    case 'approval:resolved': {
      const idx = state.pendingApprovals.findIndex((a) => a.id === event.toolCallId);
      if (idx >= 0) state.pendingApprovals.splice(idx, 1);
      break;
    }

    case 'thinking:start': {
      // Find the associated assistant message and mark it as thinking
      const msg = state.messages.find((m) => m.id === event.messageId);
      if (msg) {
        msg.isThinking = true;
        msg.thinking = '';
      }
      break;
    }

    case 'thinking:delta': {
      const msg = state.messages.find((m) => m.id === event.messageId);
      if (msg) {
        msg.thinking = (msg.thinking || '') + event.delta;
      }
      break;
    }

    case 'thinking:complete': {
      const msg = state.messages.find((m) => m.id === event.messageId);
      if (msg) {
        msg.thinking = event.content;
        msg.isThinking = false;
      }
      break;
    }

    case 'environment:info': {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) session.model = event.context.model.id;
      break;
    }

    default:
      break;
  }
}

// ── Helper to apply a single event via set() ─────────────────

function applyEventToStore(storeState: SessionsState, event: ACPEvent): Partial<SessionsState> {
  const sessionId = event.sessionId;
  const msgs = [...(storeState.messages.get(sessionId) || [])];
  const tools = [...(storeState.toolCalls.get(sessionId) || [])];
  const sessions = storeState.sessions.map((s) => ({
    ...s,
  }));
  const approvals = [...storeState.pendingApprovals];

  applyACPEvent(
    {
      messages: msgs,
      toolCalls: tools,
      sessions,
      pendingApprovals: approvals,
    },
    event
  );

  const newMessages = new Map(storeState.messages);
  newMessages.set(sessionId, msgs);
  const newToolCalls = new Map(storeState.toolCalls);
  newToolCalls.set(sessionId, tools);

  return {
    messages: newMessages,
    toolCalls: newToolCalls,
    sessions,
    pendingApprovals: approvals,
  };
}

// ── Store ────────────────────────────────────────────────────

export interface SessionsState {
  sessions: AgentSession[];
  selectedSessionId: string | null;
  messages: Map<string, AgentMessage[]>;
  toolCalls: Map<string, ToolCall[]>;
  pendingApprovals: ApprovalRequest[];
  loadingHistory: Set<string>;
  historyBuffers: Map<string, ACPEvent[]>;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSessions: (sessions: AgentSession[]) => void;
  updateSession: (id: string, updates: Partial<AgentSession>) => void;
  removeSession: (id: string) => void;
  selectSession: (id: string | null) => void;
  addMessage: (sessionId: string, message: AgentMessage) => void;
  addToolCall: (sessionId: string, toolCall: ToolCall) => void;
  updateToolCall: (sessionId: string, toolCallId: string, updates: Partial<ToolCall>) => void;
  addApproval: (request: ApprovalRequest) => void;
  removeApproval: (requestId: string) => void;
  handleACPEvent: (event: ACPEvent) => void;
  startHistoryLoading: (sessionId: string) => void;
  completeHistoryLoading: (sessionId: string) => void;
  setSessionsForMachine: (machineId: string, sessions: AgentSession[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearSessionData: (sessionId: string) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  messages: new Map(),
  toolCalls: new Map(),
  pendingApprovals: [],
  loadingHistory: new Set(),
  historyBuffers: new Map(),
  isLoading: false,
  error: null,

  setSessions: (sessions) => set({ sessions, isLoading: false, error: null }),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  removeSession: (id) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const newToolCalls = new Map(state.toolCalls);
      newMessages.delete(id);
      newToolCalls.delete(id);

      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        messages: newMessages,
        toolCalls: newToolCalls,
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
      };
    }),

  selectSession: (id) => set({ selectedSessionId: id }),

  addMessage: (sessionId, message) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const existing = newMessages.get(sessionId) || [];

      const index = existing.findIndex((m) => m.id === message.id);
      const updated = [...existing];
      if (index >= 0) {
        updated[index] = message;
      } else {
        updated.push(message);
      }

      newMessages.set(sessionId, updated);
      return { messages: newMessages };
    }),

  addToolCall: (sessionId, toolCall) =>
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(sessionId) || [];
      // Deduplicate — history replays can resend tool:start for existing tools
      if (existing.some((t) => t.id === toolCall.id)) {
        return state;
      }
      newToolCalls.set(sessionId, [...existing, toolCall]);
      return { toolCalls: newToolCalls };
    }),

  updateToolCall: (sessionId, toolCallId, updates) =>
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(sessionId) || [];
      const index = existing.findIndex((t) => t.id === toolCallId);

      if (index >= 0) {
        const updated = [...existing];
        updated[index] = { ...existing[index], ...updates };
        newToolCalls.set(sessionId, updated);
      }

      return { toolCalls: newToolCalls };
    }),

  addApproval: (request) =>
    set((state) => {
      if (state.pendingApprovals.some((a) => a.id === request.id)) {
        return state;
      }
      return {
        pendingApprovals: [...state.pendingApprovals, request],
      };
    }),

  removeApproval: (requestId) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== requestId),
    })),

  handleACPEvent: (event: ACPEvent) => {
    const state = get();
    const sessionId = event.sessionId;

    // Buffer events while history is loading for this session
    if (state.loadingHistory.has(sessionId)) {
      set((s) => {
        const newBuffers = new Map(s.historyBuffers);
        const buf = [...(newBuffers.get(sessionId) || []), event];
        newBuffers.set(sessionId, buf);
        return { historyBuffers: newBuffers };
      });
      return;
    }

    // Live event — apply immediately in a single set()
    set((s) => applyEventToStore(s, event));
  },

  startHistoryLoading: (sessionId: string) =>
    set((state) => {
      const newLoading = new Set(state.loadingHistory);
      newLoading.add(sessionId);
      const newBuffers = new Map(state.historyBuffers);
      newBuffers.set(sessionId, []);
      return {
        loadingHistory: newLoading,
        historyBuffers: newBuffers,
      };
    }),

  completeHistoryLoading: (sessionId: string) =>
    set((state) => {
      const buffer = state.historyBuffers.get(sessionId) || [];
      const newLoading = new Set(state.loadingHistory);
      newLoading.delete(sessionId);
      const newBuffers = new Map(state.historyBuffers);
      newBuffers.delete(sessionId);

      // Process all buffered events in a single state update
      const msgs = [...(state.messages.get(sessionId) || [])];
      const tools = [...(state.toolCalls.get(sessionId) || [])];
      const sessions = state.sessions.map((s) => ({
        ...s,
      }));
      const approvals = [...state.pendingApprovals];

      const mutable: MutableSessionState = {
        messages: msgs,
        toolCalls: tools,
        sessions,
        pendingApprovals: approvals,
      };

      for (const event of buffer) {
        applyACPEvent(mutable, event);
      }

      const newMessages = new Map(state.messages);
      newMessages.set(sessionId, mutable.messages);
      const newToolCalls = new Map(state.toolCalls);
      newToolCalls.set(sessionId, mutable.toolCalls);

      return {
        messages: newMessages,
        toolCalls: newToolCalls,
        sessions: mutable.sessions,
        pendingApprovals: mutable.pendingApprovals,
        loadingHistory: newLoading,
        historyBuffers: newBuffers,
      };
    }),

  setSessionsForMachine: (machineId, sessions) =>
    set((state) => {
      const otherSessions = state.sessions.filter((s) => s.machineId !== machineId);
      // Build a lookup of existing sessions so we can preserve
      // fields that were set client-side (e.g. sessionName from history replay)
      const existingByIdMap = new Map(state.sessions.map((s) => [s.id, s]));
      // Date objects become ISO strings over WebSocket JSON — parse them back
      // Also clean sessionName in case it contains system/IDE tags
      const deserialized = sessions.map((s) => {
        const existing = existingByIdMap.get(s.id);
        const incomingName = s.sessionName ? extractSessionTitle(s.sessionName) : null;
        return {
          ...s,
          // Prefer: incoming clean name > existing store name > null
          sessionName: incomingName || existing?.sessionName || null,
          lastActivity:
            s.lastActivity instanceof Date
              ? s.lastActivity
              : new Date(s.lastActivity as unknown as string),
          createdAt:
            s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt as unknown as string),
        };
      });
      // Deduplicate by session id — adapter file watchers can report the same session multiple times
      const seen = new Set<string>();
      const uniqueSessions = deserialized.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      return {
        sessions: [...otherSessions, ...uniqueSessions],
        isLoading: false,
        error: null,
      };
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  clearSessionData: (sessionId) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const newToolCalls = new Map(state.toolCalls);
      newMessages.delete(sessionId);
      newToolCalls.delete(sessionId);
      const newLoading = new Set(state.loadingHistory);
      newLoading.delete(sessionId);
      const newBuffers = new Map(state.historyBuffers);
      newBuffers.delete(sessionId);
      return {
        messages: newMessages,
        toolCalls: newToolCalls,
        loadingHistory: newLoading,
        historyBuffers: newBuffers,
      };
    }),
}));

// Stable empty arrays to avoid infinite re-render loops in useSyncExternalStore
const EMPTY_MESSAGES: AgentMessage[] = [];
const EMPTY_TOOL_CALLS: ToolCall[] = [];

// Selectors
export const selectSelectedSession = (state: SessionsState): AgentSession | null =>
  state.sessions.find((s) => s.id === state.selectedSessionId) ?? null;

export const selectSessionMessages =
  (sessionId: string) =>
  (state: SessionsState): AgentMessage[] =>
    state.messages.get(sessionId) ?? EMPTY_MESSAGES;

export const selectSessionToolCalls =
  (sessionId: string) =>
  (state: SessionsState): ToolCall[] =>
    state.toolCalls.get(sessionId) ?? EMPTY_TOOL_CALLS;

export const selectActiveSessions = (state: SessionsState): AgentSession[] =>
  state.sessions.filter((s) => s.status === 'running' || s.status === 'waiting_for_approval');

export const selectPendingApprovalsCount = (state: SessionsState): number =>
  state.pendingApprovals.length;

export const selectSessionsByMachine =
  (machineId: string) =>
  (state: SessionsState): AgentSession[] =>
    state.sessions.filter((s) => s.machineId === machineId);

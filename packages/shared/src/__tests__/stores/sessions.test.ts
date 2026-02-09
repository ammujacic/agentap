import { describe, it, expect, beforeEach } from 'vitest';
import type { ACPEvent } from '@agentap-dev/acp';
import {
  useSessionsStore,
  selectSelectedSession,
  selectSessionMessages,
  selectSessionToolCalls,
  selectActiveSessions,
  selectPendingApprovalsCount,
  selectSessionsByMachine,
} from '../../stores/sessions';
import type { AgentSession, AgentMessage, ToolCall, ApprovalRequest } from '../../types/agent';

// ── Factories ────────────────────────────────────────────────

let _seq = 0;

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: `session-${Date.now()}-${Math.random()}`,
    agent: 'claude-code',
    machineId: 'machine-1',
    projectPath: '/home/user/project',
    projectName: 'my-project',
    status: 'running',
    lastMessage: null,
    lastActivity: new Date('2025-01-01T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    sessionName: null,
    model: null,
    agentMode: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    sessionId: 'session-1',
    role: 'assistant',
    content: 'Hello world',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: `tool-${Date.now()}-${Math.random()}`,
    sessionId: 'session-1',
    name: 'Read',
    input: {},
    status: 'pending',
    startedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: `approval-${Date.now()}-${Math.random()}`,
    requestId: `req-${Date.now()}-${Math.random()}`,
    sessionId: 'session-1',
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /' },
    description: 'Execute dangerous command',
    riskLevel: 'high',
    expiresAt: new Date('2025-01-01T01:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeEvent(type: string, overrides: Record<string, unknown> = {}): ACPEvent {
  _seq++;
  return {
    seq: _seq,
    sessionId: 'session-1',
    timestamp: '2025-01-01T00:00:00Z',
    type,
    ...overrides,
  } as unknown as ACPEvent;
}

// ── Reset store before each test ─────────────────────────────

beforeEach(() => {
  _seq = 0;
  useSessionsStore.setState({
    sessions: [],
    selectedSessionId: null,
    messages: new Map(),
    toolCalls: new Map(),
    pendingApprovals: [],
    loadingHistory: new Set(),
    historyBuffers: new Map(),
    isLoading: false,
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────
// 1. Basic CRUD
// ─────────────────────────────────────────────────────────────

describe('Basic CRUD', () => {
  it('setSessions replaces sessions and clears loading/error', () => {
    const store = useSessionsStore.getState();
    store.setLoading(true);
    store.setError('something broke');

    const sessions = [makeSession({ id: 's1' }), makeSession({ id: 's2' })];
    useSessionsStore.getState().setSessions(sessions);

    const state = useSessionsStore.getState();
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0].id).toBe('s1');
    expect(state.sessions[1].id).toBe('s2');
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('updateSession merges partial updates into the matched session', () => {
    const session = makeSession({ id: 's1', status: 'running' });
    useSessionsStore.getState().setSessions([session]);
    useSessionsStore.getState().updateSession('s1', { status: 'completed', lastMessage: 'done' });

    const updated = useSessionsStore.getState().sessions[0];
    expect(updated.status).toBe('completed');
    expect(updated.lastMessage).toBe('done');
    expect(updated.id).toBe('s1');
  });

  it('updateSession does not modify unrelated sessions', () => {
    const s1 = makeSession({ id: 's1', status: 'running' });
    const s2 = makeSession({ id: 's2', status: 'running' });
    useSessionsStore.getState().setSessions([s1, s2]);
    useSessionsStore.getState().updateSession('s1', { status: 'completed' });

    const state = useSessionsStore.getState();
    expect(state.sessions[0].status).toBe('completed');
    expect(state.sessions[1].status).toBe('running');
  });

  it('removeSession removes session and its messages/toolCalls', () => {
    const session = makeSession({ id: 's1' });
    useSessionsStore.getState().setSessions([session]);
    useSessionsStore.getState().addMessage('s1', makeMessage({ sessionId: 's1' }));
    useSessionsStore.getState().addToolCall('s1', makeToolCall({ sessionId: 's1' }));

    useSessionsStore.getState().removeSession('s1');

    const state = useSessionsStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.messages.has('s1')).toBe(false);
    expect(state.toolCalls.has('s1')).toBe(false);
  });

  it('removeSession clears selectedSessionId if it matches', () => {
    const session = makeSession({ id: 's1' });
    useSessionsStore.getState().setSessions([session]);
    useSessionsStore.getState().selectSession('s1');
    expect(useSessionsStore.getState().selectedSessionId).toBe('s1');

    useSessionsStore.getState().removeSession('s1');
    expect(useSessionsStore.getState().selectedSessionId).toBeNull();
  });

  it('removeSession preserves selectedSessionId if it does not match', () => {
    const s1 = makeSession({ id: 's1' });
    const s2 = makeSession({ id: 's2' });
    useSessionsStore.getState().setSessions([s1, s2]);
    useSessionsStore.getState().selectSession('s2');

    useSessionsStore.getState().removeSession('s1');
    expect(useSessionsStore.getState().selectedSessionId).toBe('s2');
  });

  it('selectSession sets selectedSessionId', () => {
    useSessionsStore.getState().selectSession('abc');
    expect(useSessionsStore.getState().selectedSessionId).toBe('abc');
  });

  it('selectSession can set null', () => {
    useSessionsStore.getState().selectSession('abc');
    useSessionsStore.getState().selectSession(null);
    expect(useSessionsStore.getState().selectedSessionId).toBeNull();
  });

  it('setLoading updates isLoading', () => {
    useSessionsStore.getState().setLoading(true);
    expect(useSessionsStore.getState().isLoading).toBe(true);
    useSessionsStore.getState().setLoading(false);
    expect(useSessionsStore.getState().isLoading).toBe(false);
  });

  it('setError sets error and clears isLoading', () => {
    useSessionsStore.getState().setLoading(true);
    useSessionsStore.getState().setError('oops');

    const state = useSessionsStore.getState();
    expect(state.error).toBe('oops');
    expect(state.isLoading).toBe(false);
  });

  it('setError with null clears error', () => {
    useSessionsStore.getState().setError('oops');
    useSessionsStore.getState().setError(null);
    expect(useSessionsStore.getState().error).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Message management
// ─────────────────────────────────────────────────────────────

describe('Message management', () => {
  it('addMessage adds a new message for a session', () => {
    const msg = makeMessage({ id: 'msg-1', sessionId: 's1' });
    useSessionsStore.getState().addMessage('s1', msg);

    const messages = useSessionsStore.getState().messages.get('s1');
    expect(messages).toHaveLength(1);
    expect(messages![0].id).toBe('msg-1');
  });

  it('addMessage upserts if message id already exists', () => {
    const msg1 = makeMessage({ id: 'msg-1', sessionId: 's1', content: 'first' });
    const msg2 = makeMessage({ id: 'msg-1', sessionId: 's1', content: 'updated' });

    useSessionsStore.getState().addMessage('s1', msg1);
    useSessionsStore.getState().addMessage('s1', msg2);

    const messages = useSessionsStore.getState().messages.get('s1');
    expect(messages).toHaveLength(1);
    expect(messages![0].content).toBe('updated');
  });

  it('addMessage appends different messages to same session', () => {
    useSessionsStore.getState().addMessage('s1', makeMessage({ id: 'a', sessionId: 's1' }));
    useSessionsStore.getState().addMessage('s1', makeMessage({ id: 'b', sessionId: 's1' }));

    const messages = useSessionsStore.getState().messages.get('s1');
    expect(messages).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. ToolCall management
// ─────────────────────────────────────────────────────────────

describe('ToolCall management', () => {
  it('addToolCall adds a new tool call for a session', () => {
    const tc = makeToolCall({ id: 'tc-1', sessionId: 's1' });
    useSessionsStore.getState().addToolCall('s1', tc);

    const toolCalls = useSessionsStore.getState().toolCalls.get('s1');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls![0].id).toBe('tc-1');
  });

  it('addToolCall deduplicates by id', () => {
    const tc = makeToolCall({ id: 'tc-1', sessionId: 's1' });
    useSessionsStore.getState().addToolCall('s1', tc);
    useSessionsStore.getState().addToolCall('s1', { ...tc, status: 'running' });

    const toolCalls = useSessionsStore.getState().toolCalls.get('s1');
    expect(toolCalls).toHaveLength(1);
    // Should keep original since duplicate is ignored
    expect(toolCalls![0].status).toBe('pending');
  });

  it('updateToolCall merges partial updates into matched tool call', () => {
    const tc = makeToolCall({ id: 'tc-1', sessionId: 's1', status: 'pending' });
    useSessionsStore.getState().addToolCall('s1', tc);
    useSessionsStore
      .getState()
      .updateToolCall('s1', 'tc-1', { status: 'running', riskLevel: 'high' });

    const toolCalls = useSessionsStore.getState().toolCalls.get('s1');
    expect(toolCalls![0].status).toBe('running');
    expect(toolCalls![0].riskLevel).toBe('high');
  });

  it('updateToolCall does nothing if tool call not found', () => {
    useSessionsStore.getState().addToolCall('s1', makeToolCall({ id: 'tc-1', sessionId: 's1' }));
    useSessionsStore.getState().updateToolCall('s1', 'nonexistent', { status: 'error' });

    const toolCalls = useSessionsStore.getState().toolCalls.get('s1');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls![0].status).toBe('pending');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Approval management
// ─────────────────────────────────────────────────────────────

describe('Approval management', () => {
  it('addApproval adds a new approval request', () => {
    const approval = makeApproval({ id: 'a1' });
    useSessionsStore.getState().addApproval(approval);

    expect(useSessionsStore.getState().pendingApprovals).toHaveLength(1);
    expect(useSessionsStore.getState().pendingApprovals[0].id).toBe('a1');
  });

  it('addApproval deduplicates by id', () => {
    const approval = makeApproval({ id: 'a1' });
    useSessionsStore.getState().addApproval(approval);
    useSessionsStore.getState().addApproval({ ...approval, description: 'changed' });

    expect(useSessionsStore.getState().pendingApprovals).toHaveLength(1);
    expect(useSessionsStore.getState().pendingApprovals[0].description).toBe(
      'Execute dangerous command'
    );
  });

  it('removeApproval removes matching approval by id', () => {
    useSessionsStore.getState().addApproval(makeApproval({ id: 'a1' }));
    useSessionsStore.getState().addApproval(makeApproval({ id: 'a2' }));
    useSessionsStore.getState().removeApproval('a1');

    const approvals = useSessionsStore.getState().pendingApprovals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0].id).toBe('a2');
  });

  it('removeApproval does nothing for non-existent id', () => {
    useSessionsStore.getState().addApproval(makeApproval({ id: 'a1' }));
    useSessionsStore.getState().removeApproval('nonexistent');
    expect(useSessionsStore.getState().pendingApprovals).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. handleACPEvent — session events
// ─────────────────────────────────────────────────────────────

describe('handleACPEvent — session events', () => {
  it('session:status_changed updates session status and lastActivity', () => {
    const session = makeSession({ id: 'session-1', status: 'running' });
    useSessionsStore.getState().setSessions([session]);

    const beforeTime = new Date();
    useSessionsStore.getState().handleACPEvent(
      makeEvent('session:status_changed', {
        sessionId: 'session-1',
        from: 'running',
        to: 'thinking',
      })
    );

    const updated = useSessionsStore.getState().sessions[0];
    expect(updated.status).toBe('thinking');
    expect(updated.lastActivity.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
  });

  it('session:status_changed does nothing if session not found', () => {
    useSessionsStore.getState().setSessions([makeSession({ id: 'other' })]);
    useSessionsStore.getState().handleACPEvent(
      makeEvent('session:status_changed', {
        sessionId: 'session-1',
        from: 'running',
        to: 'thinking',
      })
    );

    expect(useSessionsStore.getState().sessions[0].status).toBe('running');
  });

  it('session:completed sets status to completed', () => {
    const session = makeSession({ id: 'session-1', status: 'running' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('session:completed', {
        sessionId: 'session-1',
        summary: {
          filesChanged: [],
          tokenUsage: { input: 0, output: 0 },
          duration: 100,
          toolCallsCount: 0,
          messagesCount: 0,
          errorCount: 0,
        },
      })
    );

    expect(useSessionsStore.getState().sessions[0].status).toBe('completed');
  });

  it('session:error sets status to error', () => {
    const session = makeSession({ id: 'session-1', status: 'running' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('session:error', {
        sessionId: 'session-1',
        error: { code: 'CRASH', message: 'Something broke', recoverable: false },
      })
    );

    expect(useSessionsStore.getState().sessions[0].status).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────
// 6. handleACPEvent — message events
// ─────────────────────────────────────────────────────────────

describe('handleACPEvent — message events', () => {
  it('message:start creates a partial message', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
      })
    );

    const messages = useSessionsStore.getState().messages.get('session-1');
    expect(messages).toHaveLength(1);
    expect(messages![0]).toMatchObject({
      id: 'msg-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      isPartial: true,
    });
  });

  it('message:delta appends delta to existing message content', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
      })
    );

    const beforeTime = new Date();
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:delta', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        delta: 'Hello ',
      })
    );
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:delta', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        delta: 'world!',
      })
    );

    const messages = useSessionsStore.getState().messages.get('session-1');
    expect(messages![0].content).toBe('Hello world!');
    expect(messages![0].isPartial).toBe(true);

    // Should also update session lastActivity
    const updatedSession = useSessionsStore.getState().sessions[0];
    expect(updatedSession.lastActivity.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
  });

  it('message:delta creates message if it does not exist yet', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:delta', {
        sessionId: 'session-1',
        messageId: 'msg-new',
        role: 'assistant',
        delta: 'content',
      })
    );

    const messages = useSessionsStore.getState().messages.get('session-1');
    expect(messages).toHaveLength(1);
    expect(messages![0].content).toBe('content');
  });

  it('message:complete sets full content and clears isPartial', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Final answer' }],
      })
    );

    const messages = useSessionsStore.getState().messages.get('session-1');
    expect(messages![0].content).toBe('Final answer');
    expect(messages![0].isPartial).toBe(false);
  });

  it('message:complete joins multiple text parts', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'tool_use', toolCallId: 'tc-1', name: 'Read', input: {} },
          { type: 'text', text: 'Part 2' },
        ],
      })
    );

    const messages = useSessionsStore.getState().messages.get('session-1');
    expect(messages![0].content).toBe('Part 1Part 2');
  });

  it('message:complete with role=user sets sessionName on first message via extractSessionTitle', () => {
    const session = makeSession({ id: 'session-1', sessionName: null });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'Fix the login bug' }],
      })
    );

    expect(useSessionsStore.getState().sessions[0].sessionName).toBe('Fix the login bug');
  });

  it('message:complete with role=user does not overwrite existing sessionName', () => {
    const session = makeSession({ id: 'session-1', sessionName: 'Existing Name' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'A different title' }],
      })
    );

    expect(useSessionsStore.getState().sessions[0].sessionName).toBe('Existing Name');
  });

  it('message:complete with role=user strips system tags from sessionName', () => {
    const session = makeSession({ id: 'session-1', sessionName: null });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<system-reminder>secret stuff</system-reminder>Fix the auth flow',
          },
        ],
      })
    );

    expect(useSessionsStore.getState().sessions[0].sessionName).toBe('Fix the auth flow');
  });

  it('message:complete with role=assistant sets lastMessage and lastActivity', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    const beforeTime = new Date();
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'I fixed the bug' }],
      })
    );

    const updated = useSessionsStore.getState().sessions[0];
    expect(updated.lastMessage).toBe('I fixed the bug');
    expect(updated.lastActivity.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
  });

  it('message:complete with role=assistant and empty content does not set lastMessage', () => {
    const session = makeSession({ id: 'session-1', lastMessage: 'previous' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        content: [],
      })
    );

    expect(useSessionsStore.getState().sessions[0].lastMessage).toBe('previous');
  });
});

// ─────────────────────────────────────────────────────────────
// 7. handleACPEvent — tool events
// ─────────────────────────────────────────────────────────────

describe('handleACPEvent — tool events', () => {
  it('tool:start adds a tool call with pending status', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('tool:start', {
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        name: 'Bash',
        category: 'terminal',
        description: 'Run a bash command',
      })
    );

    const toolCalls = useSessionsStore.getState().toolCalls.get('session-1');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls![0]).toMatchObject({
      id: 'tc-1',
      sessionId: 'session-1',
      name: 'Bash',
      category: 'terminal',
      description: 'Run a bash command',
      status: 'pending',
      input: {},
    });
  });

  it('tool:start deduplicates by toolCallId', () => {
    const event = makeEvent('tool:start', {
      sessionId: 'session-1',
      toolCallId: 'tc-1',
      name: 'Bash',
      category: 'terminal',
    });

    useSessionsStore.getState().handleACPEvent(event);
    useSessionsStore.getState().handleACPEvent(event);

    const toolCalls = useSessionsStore.getState().toolCalls.get('session-1');
    expect(toolCalls).toHaveLength(1);
  });

  it('tool:executing updates input, status to running, and riskLevel', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('tool:start', {
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        name: 'Bash',
        category: 'terminal',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('tool:executing', {
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        name: 'Bash',
        input: { command: 'ls -la' },
        riskLevel: 'low',
        requiresApproval: false,
      })
    );

    const toolCalls = useSessionsStore.getState().toolCalls.get('session-1');
    expect(toolCalls![0].status).toBe('running');
    expect(toolCalls![0].input).toEqual({ command: 'ls -la' });
    expect(toolCalls![0].riskLevel).toBe('low');
  });

  it('tool:result marks tool as completed with output', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('tool:start', {
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        name: 'Read',
        category: 'file_read',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('tool:result', {
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        name: 'Read',
        output: 'file contents here',
        duration: 50,
      })
    );

    const toolCalls = useSessionsStore.getState().toolCalls.get('session-1');
    expect(toolCalls![0].status).toBe('completed');
    expect(toolCalls![0].output).toBe('file contents here');
    expect(toolCalls![0].completedAt).toBeInstanceOf(Date);
  });

  it('tool:error marks tool as error with message', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('tool:start', {
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        name: 'Bash',
        category: 'terminal',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('tool:error', {
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        name: 'Bash',
        error: { code: 'EXEC_FAIL', message: 'Command not found', recoverable: true },
        duration: 10,
      })
    );

    const toolCalls = useSessionsStore.getState().toolCalls.get('session-1');
    expect(toolCalls![0].status).toBe('error');
    expect(toolCalls![0].error).toBe('Command not found');
    expect(toolCalls![0].completedAt).toBeInstanceOf(Date);
  });
});

// ─────────────────────────────────────────────────────────────
// 8. handleACPEvent — approval events
// ─────────────────────────────────────────────────────────────

describe('handleACPEvent — approval events', () => {
  it('approval:requested adds pending approval and sets session status', () => {
    const session = makeSession({ id: 'session-1', status: 'running' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('approval:requested', {
        sessionId: 'session-1',
        requestId: 'req-1',
        toolCallId: 'tc-1',
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /' },
        description: 'Delete everything',
        riskLevel: 'critical',
        expiresAt: '2025-01-01T01:00:00Z',
      })
    );

    const state = useSessionsStore.getState();
    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.pendingApprovals[0]).toMatchObject({
      id: 'tc-1',
      requestId: 'req-1',
      sessionId: 'session-1',
      toolName: 'Bash',
      riskLevel: 'critical',
    });
    expect(state.pendingApprovals[0].expiresAt).toBeInstanceOf(Date);
    expect(state.pendingApprovals[0].createdAt).toBeInstanceOf(Date);
    expect(state.sessions[0].status).toBe('waiting_for_approval');
  });

  it('approval:requested with diff preview', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('approval:requested', {
        sessionId: 'session-1',
        requestId: 'req-1',
        toolCallId: 'tc-1',
        toolName: 'Edit',
        toolInput: {},
        description: 'Edit file',
        riskLevel: 'medium',
        expiresAt: '2025-01-01T01:00:00Z',
        preview: { type: 'diff', path: '/file.ts', diff: '+added line' },
      })
    );

    const approval = useSessionsStore.getState().pendingApprovals[0];
    expect(approval.preview).toEqual({ type: 'diff', content: '+added line' });
  });

  it('approval:requested with command preview', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('approval:requested', {
        sessionId: 'session-1',
        requestId: 'req-1',
        toolCallId: 'tc-2',
        toolName: 'Bash',
        toolInput: {},
        description: 'Run command',
        riskLevel: 'high',
        expiresAt: '2025-01-01T01:00:00Z',
        preview: { type: 'command', command: 'npm install', workingDir: '/home' },
      })
    );

    const approval = useSessionsStore.getState().pendingApprovals[0];
    expect(approval.preview).toEqual({ type: 'command', content: 'npm install' });
  });

  it('approval:requested with description preview', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('approval:requested', {
        sessionId: 'session-1',
        requestId: 'req-1',
        toolCallId: 'tc-3',
        toolName: 'WebFetch',
        toolInput: {},
        description: 'Fetch URL',
        riskLevel: 'low',
        expiresAt: '2025-01-01T01:00:00Z',
        preview: { type: 'description', text: 'Fetching https://example.com' },
      })
    );

    const approval = useSessionsStore.getState().pendingApprovals[0];
    expect(approval.preview).toEqual({
      type: 'description',
      content: 'Fetching https://example.com',
    });
  });

  it('approval:requested deduplicates by toolCallId', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    const event = makeEvent('approval:requested', {
      sessionId: 'session-1',
      requestId: 'req-1',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      toolInput: {},
      description: 'Run',
      riskLevel: 'high',
      expiresAt: '2025-01-01T01:00:00Z',
    });

    useSessionsStore.getState().handleACPEvent(event);
    useSessionsStore.getState().handleACPEvent(event);

    expect(useSessionsStore.getState().pendingApprovals).toHaveLength(1);
  });

  it('approval:resolved removes the pending approval', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('approval:requested', {
        sessionId: 'session-1',
        requestId: 'req-1',
        toolCallId: 'tc-1',
        toolName: 'Bash',
        toolInput: {},
        description: 'Run',
        riskLevel: 'high',
        expiresAt: '2025-01-01T01:00:00Z',
      })
    );
    expect(useSessionsStore.getState().pendingApprovals).toHaveLength(1);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('approval:resolved', {
        sessionId: 'session-1',
        requestId: 'req-1',
        toolCallId: 'tc-1',
        approved: true,
        resolvedBy: 'user',
      })
    );

    expect(useSessionsStore.getState().pendingApprovals).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. handleACPEvent — thinking events
// ─────────────────────────────────────────────────────────────

describe('handleACPEvent — thinking events', () => {
  it('thinking:start sets isThinking=true on the message', () => {
    // First create a message
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('thinking:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
      })
    );

    const msg = useSessionsStore.getState().messages.get('session-1')![0];
    expect(msg.isThinking).toBe(true);
    expect(msg.thinking).toBe('');
  });

  it('thinking:delta appends to thinking content', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('thinking:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('thinking:delta', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        delta: 'Let me think ',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('thinking:delta', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        delta: 'about this...',
      })
    );

    const msg = useSessionsStore.getState().messages.get('session-1')![0];
    expect(msg.thinking).toBe('Let me think about this...');
  });

  it('thinking:complete sets thinking content and isThinking=false', () => {
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('thinking:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
      })
    );

    useSessionsStore.getState().handleACPEvent(
      makeEvent('thinking:complete', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        content: 'Full thinking text here',
      })
    );

    const msg = useSessionsStore.getState().messages.get('session-1')![0];
    expect(msg.thinking).toBe('Full thinking text here');
    expect(msg.isThinking).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 10. handleACPEvent — environment events
// ─────────────────────────────────────────────────────────────

describe('handleACPEvent — environment events', () => {
  it('environment:info sets session.model from context.model.id', () => {
    const session = makeSession({ id: 'session-1', model: null });
    useSessionsStore.getState().setSessions([session]);

    useSessionsStore.getState().handleACPEvent(
      makeEvent('environment:info', {
        sessionId: 'session-1',
        context: {
          agent: { name: 'claude-code', version: '1.0.0', displayName: 'Claude Code' },
          model: { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', provider: 'anthropic' },
          project: { path: '/home/user/project', name: 'my-project' },
          runtime: { os: 'darwin', arch: 'arm64' },
        },
      })
    );

    expect(useSessionsStore.getState().sessions[0].model).toBe('claude-opus-4-6');
  });
});

// ─────────────────────────────────────────────────────────────
// 11. handleACPEvent — unknown event type
// ─────────────────────────────────────────────────────────────

describe('handleACPEvent — unknown event type', () => {
  it('ignores unknown event types without errors', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);

    // Should not throw
    useSessionsStore
      .getState()
      .handleACPEvent(makeEvent('some:unknown_event', { sessionId: 'session-1' }));

    // State unchanged
    expect(useSessionsStore.getState().sessions[0].status).toBe('running');
  });
});

// ─────────────────────────────────────────────────────────────
// 12. History buffering
// ─────────────────────────────────────────────────────────────

describe('History buffering', () => {
  it('startHistoryLoading marks session as loading and creates empty buffer', () => {
    useSessionsStore.getState().startHistoryLoading('session-1');

    const state = useSessionsStore.getState();
    expect(state.loadingHistory.has('session-1')).toBe(true);
    expect(state.historyBuffers.get('session-1')).toEqual([]);
  });

  it('handleACPEvent buffers events while history is loading', () => {
    const session = makeSession({ id: 'session-1' });
    useSessionsStore.getState().setSessions([session]);
    useSessionsStore.getState().startHistoryLoading('session-1');

    useSessionsStore.getState().handleACPEvent(
      makeEvent('session:status_changed', {
        sessionId: 'session-1',
        from: 'running',
        to: 'thinking',
      })
    );

    // Session should NOT be updated yet
    expect(useSessionsStore.getState().sessions[0].status).toBe('running');

    // Event should be buffered
    const buffer = useSessionsStore.getState().historyBuffers.get('session-1');
    expect(buffer).toHaveLength(1);
    expect(buffer![0].type).toBe('session:status_changed');
  });

  it('completeHistoryLoading applies all buffered events', () => {
    const session = makeSession({ id: 'session-1', status: 'running' });
    useSessionsStore.getState().setSessions([session]);
    useSessionsStore.getState().startHistoryLoading('session-1');

    // Buffer multiple events
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:start', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
      })
    );
    useSessionsStore.getState().handleACPEvent(
      makeEvent('message:delta', {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        delta: 'Hello',
      })
    );
    useSessionsStore.getState().handleACPEvent(
      makeEvent('session:status_changed', {
        sessionId: 'session-1',
        from: 'running',
        to: 'thinking',
      })
    );

    // Nothing applied yet
    expect(useSessionsStore.getState().messages.get('session-1')).toBeUndefined();
    expect(useSessionsStore.getState().sessions[0].status).toBe('running');

    // Complete loading — all buffered events should be applied
    useSessionsStore.getState().completeHistoryLoading('session-1');

    const state = useSessionsStore.getState();
    expect(state.loadingHistory.has('session-1')).toBe(false);
    expect(state.historyBuffers.has('session-1')).toBe(false);

    const messages = state.messages.get('session-1');
    expect(messages).toHaveLength(1);
    expect(messages![0].content).toBe('Hello');
    expect(state.sessions[0].status).toBe('thinking');
  });

  it('completeHistoryLoading with no buffered events is a no-op', () => {
    useSessionsStore.getState().startHistoryLoading('session-1');
    useSessionsStore.getState().completeHistoryLoading('session-1');

    const state = useSessionsStore.getState();
    expect(state.loadingHistory.has('session-1')).toBe(false);
    expect(state.historyBuffers.has('session-1')).toBe(false);
  });

  it('events for non-loading sessions are applied immediately', () => {
    const session = makeSession({ id: 'session-1', status: 'running' });
    useSessionsStore.getState().setSessions([session]);

    // session-2 is loading, but session-1 is not
    useSessionsStore.getState().startHistoryLoading('session-2');

    useSessionsStore.getState().handleACPEvent(
      makeEvent('session:status_changed', {
        sessionId: 'session-1',
        from: 'running',
        to: 'completed',
      })
    );

    expect(useSessionsStore.getState().sessions[0].status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────
// 13. setSessionsForMachine
// ─────────────────────────────────────────────────────────────

describe('setSessionsForMachine', () => {
  it('replaces sessions for specific machine and preserves others', () => {
    const existing1 = makeSession({ id: 's1', machineId: 'machine-1' });
    const existing2 = makeSession({ id: 's2', machineId: 'machine-2' });
    useSessionsStore.getState().setSessions([existing1, existing2]);

    const newSession = makeSession({ id: 's3', machineId: 'machine-1' });
    useSessionsStore.getState().setSessionsForMachine('machine-1', [newSession]);

    const state = useSessionsStore.getState();
    expect(state.sessions).toHaveLength(2);
    const ids = state.sessions.map((s) => s.id);
    expect(ids).toContain('s2'); // machine-2 session preserved
    expect(ids).toContain('s3'); // new machine-1 session added
    expect(ids).not.toContain('s1'); // old machine-1 session replaced
  });

  it('deduplicates sessions by id', () => {
    const session = makeSession({ id: 's1', machineId: 'machine-1' });
    useSessionsStore.getState().setSessionsForMachine('machine-1', [session, { ...session }]);

    const state = useSessionsStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe('s1');
  });

  it('parses ISO date strings for lastActivity and createdAt', () => {
    const session = {
      ...makeSession({ id: 's1', machineId: 'machine-1' }),
      lastActivity: '2025-06-15T12:00:00Z' as unknown as Date,
      createdAt: '2025-06-15T10:00:00Z' as unknown as Date,
    };

    useSessionsStore.getState().setSessionsForMachine('machine-1', [session]);

    const stored = useSessionsStore.getState().sessions[0];
    expect(stored.lastActivity).toBeInstanceOf(Date);
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(stored.lastActivity.toISOString()).toBe('2025-06-15T12:00:00.000Z');
    expect(stored.createdAt.toISOString()).toBe('2025-06-15T10:00:00.000Z');
  });

  it('preserves Date objects for lastActivity and createdAt', () => {
    const lastActivity = new Date('2025-06-15T12:00:00Z');
    const createdAt = new Date('2025-06-15T10:00:00Z');
    const session = makeSession({ id: 's1', machineId: 'machine-1', lastActivity, createdAt });

    useSessionsStore.getState().setSessionsForMachine('machine-1', [session]);

    const stored = useSessionsStore.getState().sessions[0];
    expect(stored.lastActivity).toBeInstanceOf(Date);
    expect(stored.lastActivity.getTime()).toBe(lastActivity.getTime());
  });

  it('strips system tags from incoming sessionName', () => {
    const session = makeSession({
      id: 's1',
      machineId: 'machine-1',
      sessionName: '<system-reminder>instructions</system-reminder>Fix the bug',
    });

    useSessionsStore.getState().setSessionsForMachine('machine-1', [session]);

    expect(useSessionsStore.getState().sessions[0].sessionName).toBe('Fix the bug');
  });

  it('preserves existing sessionName if incoming has no real name', () => {
    const existing = makeSession({
      id: 's1',
      machineId: 'machine-1',
      sessionName: 'Previously Set Name',
    });
    useSessionsStore.getState().setSessions([existing]);

    const incoming = makeSession({
      id: 's1',
      machineId: 'machine-1',
      sessionName: null,
    });
    useSessionsStore.getState().setSessionsForMachine('machine-1', [incoming]);

    expect(useSessionsStore.getState().sessions[0].sessionName).toBe('Previously Set Name');
  });

  it('preserves existing sessionName when incoming has only system tags', () => {
    const existing = makeSession({
      id: 's1',
      machineId: 'machine-1',
      sessionName: 'Real Name',
    });
    useSessionsStore.getState().setSessions([existing]);

    const incoming = makeSession({
      id: 's1',
      machineId: 'machine-1',
      sessionName: '<system-reminder>only tags here</system-reminder>',
    });
    useSessionsStore.getState().setSessionsForMachine('machine-1', [incoming]);

    expect(useSessionsStore.getState().sessions[0].sessionName).toBe('Real Name');
  });

  it('clears isLoading and error', () => {
    useSessionsStore.getState().setLoading(true);
    useSessionsStore.getState().setError('previous error');

    useSessionsStore.getState().setSessionsForMachine('machine-1', []);

    const state = useSessionsStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 14. clearSessionData
// ─────────────────────────────────────────────────────────────

describe('clearSessionData', () => {
  it('clears messages, toolCalls, loadingHistory, and historyBuffers for a session', () => {
    // Populate data for session
    useSessionsStore.getState().addMessage('session-1', makeMessage({ sessionId: 'session-1' }));
    useSessionsStore.getState().addToolCall('session-1', makeToolCall({ sessionId: 'session-1' }));
    useSessionsStore.getState().startHistoryLoading('session-1');

    useSessionsStore.getState().clearSessionData('session-1');

    const state = useSessionsStore.getState();
    expect(state.messages.has('session-1')).toBe(false);
    expect(state.toolCalls.has('session-1')).toBe(false);
    expect(state.loadingHistory.has('session-1')).toBe(false);
    expect(state.historyBuffers.has('session-1')).toBe(false);
  });

  it('does not affect data for other sessions', () => {
    useSessionsStore.getState().addMessage('session-1', makeMessage({ sessionId: 'session-1' }));
    useSessionsStore.getState().addMessage('session-2', makeMessage({ sessionId: 'session-2' }));

    useSessionsStore.getState().clearSessionData('session-1');

    expect(useSessionsStore.getState().messages.has('session-1')).toBe(false);
    expect(useSessionsStore.getState().messages.has('session-2')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 15. Selectors
// ─────────────────────────────────────────────────────────────

describe('Selectors', () => {
  describe('selectSelectedSession', () => {
    it('returns the selected session', () => {
      const session = makeSession({ id: 's1' });
      useSessionsStore.getState().setSessions([session]);
      useSessionsStore.getState().selectSession('s1');

      const selected = selectSelectedSession(useSessionsStore.getState());
      expect(selected).not.toBeNull();
      expect(selected!.id).toBe('s1');
    });

    it('returns null if no session is selected', () => {
      const selected = selectSelectedSession(useSessionsStore.getState());
      expect(selected).toBeNull();
    });

    it('returns null if selected session does not exist', () => {
      useSessionsStore.getState().selectSession('nonexistent');
      const selected = selectSelectedSession(useSessionsStore.getState());
      expect(selected).toBeNull();
    });
  });

  describe('selectSessionMessages', () => {
    it('returns messages for existing session', () => {
      const msg = makeMessage({ id: 'msg-1', sessionId: 's1' });
      useSessionsStore.getState().addMessage('s1', msg);

      const messages = selectSessionMessages('s1')(useSessionsStore.getState());
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-1');
    });

    it('returns EMPTY_MESSAGES (stable reference) for unknown session', () => {
      const messages1 = selectSessionMessages('unknown')(useSessionsStore.getState());
      const messages2 = selectSessionMessages('unknown')(useSessionsStore.getState());

      expect(messages1).toEqual([]);
      expect(messages1).toBe(messages2); // Same reference
    });
  });

  describe('selectSessionToolCalls', () => {
    it('returns tool calls for existing session', () => {
      const tc = makeToolCall({ id: 'tc-1', sessionId: 's1' });
      useSessionsStore.getState().addToolCall('s1', tc);

      const toolCalls = selectSessionToolCalls('s1')(useSessionsStore.getState());
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].id).toBe('tc-1');
    });

    it('returns stable empty array for unknown session', () => {
      const tc1 = selectSessionToolCalls('unknown')(useSessionsStore.getState());
      const tc2 = selectSessionToolCalls('unknown')(useSessionsStore.getState());

      expect(tc1).toEqual([]);
      expect(tc1).toBe(tc2); // Same reference
    });
  });

  describe('selectActiveSessions', () => {
    it('returns sessions with running or waiting_for_approval status', () => {
      useSessionsStore
        .getState()
        .setSessions([
          makeSession({ id: 's1', status: 'running' }),
          makeSession({ id: 's2', status: 'completed' }),
          makeSession({ id: 's3', status: 'waiting_for_approval' }),
          makeSession({ id: 's4', status: 'error' }),
          makeSession({ id: 's5', status: 'idle' }),
        ]);

      const active = selectActiveSessions(useSessionsStore.getState());
      expect(active).toHaveLength(2);
      const ids = active.map((s) => s.id);
      expect(ids).toContain('s1');
      expect(ids).toContain('s3');
    });

    it('returns empty array when no active sessions exist', () => {
      useSessionsStore
        .getState()
        .setSessions([
          makeSession({ id: 's1', status: 'completed' }),
          makeSession({ id: 's2', status: 'error' }),
        ]);

      const active = selectActiveSessions(useSessionsStore.getState());
      expect(active).toHaveLength(0);
    });
  });

  describe('selectPendingApprovalsCount', () => {
    it('returns the number of pending approvals', () => {
      useSessionsStore.getState().addApproval(makeApproval({ id: 'a1' }));
      useSessionsStore.getState().addApproval(makeApproval({ id: 'a2' }));

      const count = selectPendingApprovalsCount(useSessionsStore.getState());
      expect(count).toBe(2);
    });

    it('returns 0 when no approvals exist', () => {
      const count = selectPendingApprovalsCount(useSessionsStore.getState());
      expect(count).toBe(0);
    });
  });

  describe('selectSessionsByMachine', () => {
    it('returns sessions for a specific machine', () => {
      useSessionsStore
        .getState()
        .setSessions([
          makeSession({ id: 's1', machineId: 'machine-1' }),
          makeSession({ id: 's2', machineId: 'machine-2' }),
          makeSession({ id: 's3', machineId: 'machine-1' }),
        ]);

      const machineOneSessions = selectSessionsByMachine('machine-1')(useSessionsStore.getState());
      expect(machineOneSessions).toHaveLength(2);
      const ids = machineOneSessions.map((s) => s.id);
      expect(ids).toContain('s1');
      expect(ids).toContain('s3');
    });

    it('returns empty array for machine with no sessions', () => {
      useSessionsStore.getState().setSessions([makeSession({ id: 's1', machineId: 'machine-1' })]);

      const sessions = selectSessionsByMachine('machine-999')(useSessionsStore.getState());
      expect(sessions).toHaveLength(0);
    });
  });
});

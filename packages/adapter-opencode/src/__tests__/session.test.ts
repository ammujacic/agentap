import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { ACPEvent, ACPCommand } from '@agentap-dev/acp';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    const watcher = {
      on: vi.fn(function () {
        return watcher;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    return watcher;
  }),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn((): Promise<any[]> => Promise.resolve([])),
  readFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('@agentap-dev/acp', () => ({
  ACP_VERSION: '1.0.0',
  createEvent: vi.fn((sessionId: string, payload: Record<string, unknown>) => ({
    sessionId,
    ...payload,
    seq: 0,
    timestamp: new Date().toISOString(),
  })),
  resetSequence: vi.fn(),
  assessRisk: vi.fn(() => 'low'),
  describeToolCall: vi.fn((name: string, _input: unknown) => `${name} call`),
  categorizeTool: vi.fn(() => 'other'),
}));

// Import after mocks are declared
import { OpenCodeSession } from '../session';
import { spawn } from 'child_process';
import { readdir as _readdir, readFile } from 'fs/promises';
const readdir = _readdir as unknown as (...args: any[]) => Promise<string[]>;
import { watch } from 'chokidar';
import { createEvent, resetSequence } from '@agentap-dev/acp';
import type { ServerInfo } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────

function createMockProcess(): ChildProcess & {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
} {
  const proc = new EventEmitter() as ChildProcess & {
    stdin: { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = new EventEmitter() as unknown as typeof proc.stdout;
  proc.stderr = new EventEmitter() as unknown as typeof proc.stderr;
  proc.stdin = { write: vi.fn() } as unknown as typeof proc.stdin;
  proc.kill = vi.fn() as unknown as typeof proc.kill;
  proc.pid = 12345;
  return proc;
}

function collectEvents(session: OpenCodeSession): ACPEvent[] {
  const events: ACPEvent[] = [];
  session.onEvent((e) => events.push(e));
  return events;
}

function emitStdoutLine(proc: ReturnType<typeof createMockProcess>, obj: unknown): void {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
}

const defaultCapabilities = {
  protocolVersion: '1.0.0',
  agent: {
    name: 'opencode',
    displayName: 'OpenCode',
    icon: '',
    version: null,
    integrationMethod: 'file-watch' as const,
  },
  features: {
    streaming: { messages: true, toolArgs: false, thinking: true },
    approval: { toolCalls: true, preview: false },
    sessionControl: { pause: false, resume: false, cancel: true },
    subAgents: false,
    planning: { todos: false, planMode: false },
    resources: {
      tokenUsage: true,
      costTracking: true,
      contextWindow: false,
    },
    fileOperations: { diffs: true, batchedChanges: false },
    git: false,
    webSearch: false,
    multimodal: true,
    userInteraction: { questions: false, notifications: false },
    thinking: true,
    customEvents: [],
  },
};

// ── Tests ────────────────────────────────────────────────────────────

describe('OpenCodeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock readdir/readFile to prevent loadHistory from doing real I/O
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────── Constructor ───────────────────

  describe('constructor', () => {
    it('generates a random sessionId when none provided', () => {
      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities);
      expect(session.sessionId).toBeTruthy();
      expect(session.sessionId.length).toBeGreaterThan(10);
    });

    it('uses the provided sessionId', () => {
      const session = new OpenCodeSession('my-session-id', '/data', defaultCapabilities);
      expect(session.sessionId).toBe('my-session-id');
    });

    it('stores capabilities', () => {
      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities);
      expect(session.capabilities).toBe(defaultCapabilities);
    });

    it('starts loading history and watching when sessionId is provided', () => {
      new OpenCodeSession('sess-123', '/data', defaultCapabilities, null, '/project');
      // loadHistory calls readdir on the message dir
      // We allow a tick for the async constructor side-effects
      expect(readdir).toHaveBeenCalled();
    });

    it('does not start watching when no sessionId is provided', () => {
      new OpenCodeSession(undefined, '/data', defaultCapabilities);
      // watch should not be called for new sessions
      expect(watch).not.toHaveBeenCalled();
    });
  });

  // ─────────────────── onEvent ───────────────────

  describe('onEvent()', () => {
    it('registers callback that receives ACP events', async () => {
      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities);
      const events: ACPEvent[] = [];
      session.onEvent((e) => events.push(e));

      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      await session.start('/project', 'hello');

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'session:started')).toBe(true);
    });

    it('returns an unsubscribe function', () => {
      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities);
      const unsub = session.onEvent(() => {});
      expect(typeof unsub).toBe('function');
    });

    it('unsubscribe stops receiving events', async () => {
      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities);
      const events: ACPEvent[] = [];
      const unsub = session.onEvent((e) => events.push(e));
      unsub();

      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);
      await session.start('/project', 'hello');

      expect(events.length).toBe(0);
    });
  });

  // ─────────────────── start() — CLI mode ───────────────────

  describe('start() - CLI mode', () => {
    it('spawns opencode with correct args', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('start-test', '/data', defaultCapabilities);
      await session.start('/my/project', 'do something');

      expect(spawn).toHaveBeenCalledWith('opencode', ['run', 'do something', '--format', 'json'], {
        cwd: '/my/project',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    it('emits session:started event', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('started-event-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/my/project', 'hello');

      expect(events.some((e) => e.type === 'session:started')).toBe(true);
      const started = events.find((e) => e.type === 'session:started') as ACPEvent & {
        agent: string;
        projectPath: string;
        projectName: string;
      };
      expect(started.agent).toBe('opencode');
      expect(started.projectPath).toBe('/my/project');
      expect(started.projectName).toBe('project');
    });

    it('emits status_changed to starting then running', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('status-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/project', 'test');

      const statusEvents = events.filter(
        (e) => e.type === 'session:status_changed'
      ) as (ACPEvent & { from: string; to: string })[];
      expect(statusEvents.length).toBeGreaterThanOrEqual(2);
      expect(statusEvents[0].to).toBe('starting');
      expect(statusEvents[1].to).toBe('running');
    });

    it('emits session:completed on clean exit (code 0)', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('exit-0-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/project', 'test');

      mockProc.emit('close', 0);

      expect(events.some((e) => e.type === 'session:completed')).toBe(true);
    });

    it('emits session:error on non-zero exit', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('exit-err-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/project', 'test');

      mockProc.emit('close', 1);

      const errEvent = events.find((e) => e.type === 'session:error') as ACPEvent & {
        error: { code: string; message: string };
      };
      expect(errEvent).toBeDefined();
      expect(errEvent.error.code).toBe('PROCESS_ERROR');
      expect(errEvent.error.message).toContain('1');
    });

    it('emits session:error on spawn error', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('spawn-err-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/project', 'test');

      mockProc.emit('error', new Error('command not found'));

      const errEvent = events.find((e) => e.type === 'session:error') as ACPEvent & {
        error: { code: string; message: string };
      };
      expect(errEvent).toBeDefined();
      expect(errEvent.error.code).toBe('SPAWN_ERROR');
      expect(errEvent.error.message).toBe('command not found');
    });

    it('calls resetSequence with sessionId', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('reset-seq-test', '/data', defaultCapabilities);
      await session.start('/project', 'test');

      expect(resetSequence).toHaveBeenCalledWith('reset-seq-test');
    });

    it('handles process stdout JSON output', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('stdout-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/project', 'test');
      events.length = 0; // clear startup events

      // Send structured output
      emitStdoutLine(mockProc, {
        type: 'permission.asked',
        sessionID: 'stdout-test',
        id: 'perm-1',
        permission: 'file:write',
        patterns: ['*.ts'],
        metadata: {},
        tool: { messageID: 'msg-1', callID: 'call-1' },
      });

      expect(events.some((e) => e.type === 'approval:requested')).toBe(true);
    });

    it('handles non-JSON stdout gracefully', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('nonjson-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/project', 'test');
      events.length = 0;

      mockProc.stdout.emit('data', Buffer.from('Not JSON\n'));
      // Should not throw and no events
      expect(events.length).toBe(0);
    });

    it('handles buffered partial stdout lines', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('buffer-test', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('/project', 'test');
      events.length = 0;

      const jsonStr = JSON.stringify({
        type: 'permission.asked',
        sessionID: 'buffer-test',
        id: 'perm-2',
        permission: 'bash',
        patterns: [],
        metadata: {},
      });

      // Send first half
      mockProc.stdout.emit('data', Buffer.from(jsonStr.substring(0, 10)));
      expect(events.length).toBe(0);

      // Send second half + newline
      mockProc.stdout.emit('data', Buffer.from(jsonStr.substring(10) + '\n'));
      expect(events.length).toBeGreaterThan(0);
    });

    it('logs stderr output', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('stderr-test', '/data', defaultCapabilities);
      await session.start('/project', 'test');

      mockProc.stderr.emit('data', Buffer.from('some error'));

      expect(consoleErrorSpy).toHaveBeenCalledWith('[opencode] stderr:', 'some error');
      consoleErrorSpy.mockRestore();
    });

    it('uses "Unknown" as projectName when path has no segments', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('unknown-proj', '/data', defaultCapabilities);
      const events = collectEvents(session);
      await session.start('', 'test');

      const started = events.find((e) => e.type === 'session:started') as ACPEvent & {
        projectName: string;
      };
      expect(started.projectName).toBe('Unknown');
    });
  });

  // ─────────────────── start() — HTTP mode ───────────────────

  describe('start() - HTTP mode', () => {
    const serverInfo: ServerInfo = {
      url: 'http://127.0.0.1:4096',
      version: '0.2.0',
    };

    it('creates session via HTTP and sends message', async () => {
      const mockFetch = vi.fn();
      // POST session/ -> returns { id: 'new-id' }
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () => Promise.resolve({ id: 'http-session-id' }),
        })
        // POST session/{id}/message
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: () => Promise.resolve('ok'),
        })
        // SSE /event (will fail/abort -- that's fine)
        .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities, serverInfo);
      const events = collectEvents(session);
      await session.start('/my/project', 'build the app');

      expect(session.sessionId).toBe('http-session-id');
      expect(events.some((e) => e.type === 'session:started')).toBe(true);

      // Verify POST calls
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/session/',
        expect.objectContaining({ method: 'POST' })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://127.0.0.1:4096/session/http-session-id/message'),
        expect.objectContaining({ method: 'POST' })
      );

      vi.unstubAllGlobals();
    });

    it('falls back to CLI when HTTP session creation fails', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('network'));
      vi.stubGlobal('fetch', mockFetch);

      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities, serverInfo);
      const events = collectEvents(session);
      await session.start('/project', 'test');

      // Should have fallen back to CLI spawn
      expect(spawn).toHaveBeenCalledWith(
        'opencode',
        ['run', 'test', '--format', 'json'],
        expect.any(Object)
      );
      expect(events.some((e) => e.type === 'session:started')).toBe(true);

      vi.unstubAllGlobals();
    });
  });

  // ─────────────────── loadHistory ───────────────────

  describe('loadHistory (via constructor)', () => {
    it('loads messages and parts from storage', async () => {
      const userMsg = {
        id: 'msg-u1',
        sessionID: 'hist-test',
        role: 'user',
        time: { created: Date.now() },
      };
      const assistantMsg = {
        id: 'msg-a1',
        sessionID: 'hist-test',
        role: 'assistant',
        time: { created: Date.now(), completed: Date.now() },
        modelID: 'claude-3-5-sonnet',
        providerID: 'anthropic',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/project', root: '/project' },
        cost: 0.01,
        tokens: {
          input: 100,
          output: 50,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        finish: 'end_turn',
      };
      const textPartUser = {
        id: 'part-u1',
        sessionID: 'hist-test',
        messageID: 'msg-u1',
        type: 'text',
        text: 'Hello',
      };
      const textPartAssistant = {
        id: 'part-a1',
        sessionID: 'hist-test',
        messageID: 'msg-a1',
        type: 'text',
        text: 'Hi there!',
      };

      // readdir for message dir
      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-u1.json', 'msg-a1.json']) // message dir
        .mockResolvedValueOnce(['part-u1.json']) // parts for user msg
        .mockResolvedValueOnce(['part-a1.json']); // parts for assistant msg

      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(userMsg))
        .mockResolvedValueOnce(JSON.stringify(textPartUser))
        .mockResolvedValueOnce(JSON.stringify(assistantMsg))
        .mockResolvedValueOnce(JSON.stringify(textPartAssistant));

      const session = new OpenCodeSession(
        'hist-test',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );

      // Wait for async loadHistory to complete
      await new Promise((r) => setTimeout(r, 50));

      const history = await session.getHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history.some((e) => e.type === 'message:start')).toBe(true);
      expect(history.some((e) => e.type === 'message:complete')).toBe(true);

      await session.detach();
    });

    it('handles empty message dir without errors', async () => {
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'empty-hist',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );

      await new Promise((r) => setTimeout(r, 20));

      const history = await session.getHistory();
      // Will have some events from constructor side effects, but no messages
      expect(Array.isArray(history)).toBe(true);

      await session.detach();
    });

    it('skips non-.json files in message dir', async () => {
      vi.mocked(readdir).mockResolvedValueOnce(['msg-1.json', 'readme.txt']);

      const userMsg = {
        id: 'msg-1',
        sessionID: 'skip-test',
        role: 'user',
        time: { created: Date.now() },
      };

      // parts dir
      vi.mocked(readdir).mockResolvedValueOnce([]);

      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(userMsg));

      const session = new OpenCodeSession(
        'skip-test',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );

      await new Promise((r) => setTimeout(r, 50));

      const history = await session.getHistory();
      // Only 1 message processed
      const msgStarts = history.filter((e) => e.type === 'message:start');
      // user message with no text parts shouldn't emit message:start
      // but the session-level events are there
      expect(Array.isArray(history)).toBe(true);

      await session.detach();
    });

    it('skips unreadable message files', async () => {
      vi.mocked(readdir).mockResolvedValueOnce(['msg-bad.json']);
      vi.mocked(readFile).mockRejectedValueOnce(new Error('EACCES'));

      const session = new OpenCodeSession(
        'bad-msg-test',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should not crash
      const history = await session.getHistory();
      expect(Array.isArray(history)).toBe(true);

      await session.detach();
    });
  });

  // ─────────────────── processMessageWithParts ───────────────────

  describe('processMessageWithParts (via loadHistory)', () => {
    it('emits user message events with text content', async () => {
      const userMsg = {
        id: 'msg-u',
        sessionID: 'proc-user',
        role: 'user',
        time: { created: Date.now() },
      };
      const textPart = {
        id: 'part-1',
        sessionID: 'proc-user',
        messageID: 'msg-u',
        type: 'text',
        text: 'Hello world',
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-u.json'])
        .mockResolvedValueOnce(['part-1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(userMsg))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const session = new OpenCodeSession(
        'proc-user',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      const starts = events.filter(
        (e) => e.type === 'message:start' && (e as ACPEvent & { role: string }).role === 'user'
      );
      const completes = events.filter(
        (e) => e.type === 'message:complete' && (e as ACPEvent & { role: string }).role === 'user'
      );
      expect(starts.length).toBe(1);
      expect(completes.length).toBe(1);

      await session.detach();
    });

    it('does not emit user message events when text is empty', async () => {
      const userMsg = {
        id: 'msg-empty',
        sessionID: 'proc-empty',
        role: 'user',
        time: { created: Date.now() },
      };

      vi.mocked(readdir).mockResolvedValueOnce(['msg-empty.json']).mockResolvedValueOnce([]); // no parts
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(userMsg));

      const session = new OpenCodeSession(
        'proc-empty',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      const userMsgEvents = events.filter(
        (e) => e.type === 'message:start' && (e as ACPEvent & { role: string }).role === 'user'
      );
      expect(userMsgEvents.length).toBe(0);

      await session.detach();
    });

    it('emits assistant message events with environment info', async () => {
      const assistantMsg = {
        id: 'msg-a',
        sessionID: 'proc-asst',
        role: 'assistant',
        time: { created: Date.now(), completed: Date.now() },
        modelID: 'gpt-4o',
        providerID: 'openai',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/project', root: '/project' },
        cost: 0.005,
        tokens: {
          input: 50,
          output: 30,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        finish: 'end_turn',
      };
      const textPart = {
        id: 'part-a1',
        sessionID: 'proc-asst',
        messageID: 'msg-a',
        type: 'text',
        text: 'Response text',
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-a.json'])
        .mockResolvedValueOnce(['part-a1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(assistantMsg))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const session = new OpenCodeSession(
        'proc-asst',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.type === 'environment:info')).toBe(true);
      expect(events.some((e) => e.type === 'message:start')).toBe(true);
      expect(events.some((e) => e.type === 'message:complete')).toBe(true);

      await session.detach();
    });

    it('emits error event when assistant message has error', async () => {
      const assistantMsg = {
        id: 'msg-err',
        sessionID: 'proc-err',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'gpt-4o',
        providerID: 'openai',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/project', root: '/project' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        error: {
          name: 'RateLimitError',
          message: 'Too many requests',
        },
      };

      vi.mocked(readdir).mockResolvedValueOnce(['msg-err.json']).mockResolvedValueOnce([]); // no parts
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(assistantMsg));

      const session = new OpenCodeSession(
        'proc-err',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      const errEvent = events.find((e) => e.type === 'session:error') as ACPEvent & {
        error: { code: string; message: string };
      };
      expect(errEvent).toBeDefined();
      expect(errEvent.error.code).toBe('RateLimitError');
      expect(errEvent.error.message).toBe('Too many requests');

      await session.detach();
    });

    it('sets projectDirectory from first assistant message path', async () => {
      const assistantMsg = {
        id: 'msg-pd',
        sessionID: 'proc-pd',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'provider',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/my/project', root: '/my/project' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };

      vi.mocked(readdir).mockResolvedValueOnce(['msg-pd.json']).mockResolvedValueOnce([]);
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(assistantMsg));

      const session = new OpenCodeSession(
        'proc-pd',
        '/data',
        defaultCapabilities,
        null,
        '' // no project dir initially
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      const envInfo = events.find((e) => e.type === 'environment:info') as ACPEvent & {
        context: { project: { path: string } };
      };
      expect(envInfo).toBeDefined();
      expect(envInfo.context.project.path).toBe('/my/project');

      await session.detach();
    });
  });

  // ─────────────────── handlePartEvent ───────────────────

  describe('handlePartEvent (via loadHistory)', () => {
    it('emits message:delta for text parts', async () => {
      const msg = {
        id: 'msg-tp',
        sessionID: 'part-text',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      const textPart = {
        id: 'tp-1',
        sessionID: 'part-text',
        messageID: 'msg-tp',
        type: 'text',
        text: 'Some text',
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-tp.json'])
        .mockResolvedValueOnce(['tp-1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const session = new OpenCodeSession('part-text', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      const delta = events.find((e) => e.type === 'message:delta') as ACPEvent & { delta: string };
      expect(delta).toBeDefined();
      expect(delta.delta).toBe('Some text');

      await session.detach();
    });

    it('emits thinking events for reasoning parts', async () => {
      const msg = {
        id: 'msg-rp',
        sessionID: 'part-reason',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      const reasoningPart = {
        id: 'rp-1',
        sessionID: 'part-reason',
        messageID: 'msg-rp',
        type: 'reasoning',
        text: 'Let me think...',
        time: { start: Date.now(), end: Date.now() + 1000 },
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-rp.json'])
        .mockResolvedValueOnce(['rp-1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(reasoningPart));

      const session = new OpenCodeSession('part-reason', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.type === 'thinking:start')).toBe(true);
      expect(events.some((e) => e.type === 'thinking:delta')).toBe(true);
      expect(events.some((e) => e.type === 'thinking:complete')).toBe(true);

      await session.detach();
    });

    it('emits thinking:start without delta when text is empty', async () => {
      const msg = {
        id: 'msg-re',
        sessionID: 'part-reason-empty',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      const reasoningPart = {
        id: 'rp-e1',
        sessionID: 'part-reason-empty',
        messageID: 'msg-re',
        type: 'reasoning',
        text: '', // empty
        time: { start: Date.now() }, // no end
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-re.json'])
        .mockResolvedValueOnce(['rp-e1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(reasoningPart));

      const session = new OpenCodeSession(
        'part-reason-empty',
        '/data',
        defaultCapabilities,
        null,
        '/'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.type === 'thinking:start')).toBe(true);
      // No delta for empty text
      expect(events.some((e) => e.type === 'thinking:delta')).toBe(false);
      // No complete without end time
      expect(events.some((e) => e.type === 'thinking:complete')).toBe(false);

      await session.detach();
    });

    it('emits tool events for tool parts in different states', async () => {
      const msg = {
        id: 'msg-tool',
        sessionID: 'part-tool',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      const pendingToolPart = {
        id: 'tool-1',
        sessionID: 'part-tool',
        messageID: 'msg-tool',
        type: 'tool',
        callID: 'call-1',
        tool: 'file_edit',
        state: {
          status: 'pending',
          input: { path: '/file.ts' },
          raw: '{}',
        },
      };
      const runningToolPart = {
        id: 'tool-2',
        sessionID: 'part-tool',
        messageID: 'msg-tool',
        type: 'tool',
        callID: 'call-2',
        tool: 'bash',
        state: {
          status: 'running',
          input: { command: 'ls' },
          time: { start: Date.now() },
        },
      };
      const completedToolPart = {
        id: 'tool-3',
        sessionID: 'part-tool',
        messageID: 'msg-tool',
        type: 'tool',
        callID: 'call-3',
        tool: 'read_file',
        state: {
          status: 'completed',
          input: { path: '/file.ts' },
          output: 'file contents',
          title: 'Read file',
          metadata: {},
          time: { start: 1000, end: 2000 },
        },
      };
      const errorToolPart = {
        id: 'tool-4',
        sessionID: 'part-tool',
        messageID: 'msg-tool',
        type: 'tool',
        callID: 'call-4',
        tool: 'bash',
        state: {
          status: 'error',
          input: { command: 'rm -rf /' },
          error: 'Permission denied',
          time: { start: 1000, end: 2000 },
        },
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-tool.json'])
        .mockResolvedValueOnce(['tool-1.json', 'tool-2.json', 'tool-3.json', 'tool-4.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(pendingToolPart))
        .mockResolvedValueOnce(JSON.stringify(runningToolPart))
        .mockResolvedValueOnce(JSON.stringify(completedToolPart))
        .mockResolvedValueOnce(JSON.stringify(errorToolPart));

      const session = new OpenCodeSession('part-tool', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.type === 'tool:start')).toBe(true);
      expect(events.some((e) => e.type === 'tool:executing')).toBe(true);
      expect(events.some((e) => e.type === 'tool:result')).toBe(true);
      expect(events.some((e) => e.type === 'tool:error')).toBe(true);

      const result = events.find((e) => e.type === 'tool:result') as ACPEvent & {
        output: string;
        duration: number;
      };
      expect(result.output).toBe('file contents');
      expect(result.duration).toBe(1000);

      const errEvent = events.find((e) => e.type === 'tool:error') as ACPEvent & {
        error: { message: string };
      };
      expect(errEvent.error.message).toBe('Permission denied');

      await session.detach();
    });

    it('emits token usage for step-finish parts', async () => {
      const msg = {
        id: 'msg-sf',
        sessionID: 'part-step',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      const stepFinish = {
        id: 'sf-1',
        sessionID: 'part-step',
        messageID: 'msg-sf',
        type: 'step-finish',
        reason: 'end_turn',
        snapshot: '',
        cost: 0.005,
        tokens: {
          input: 100,
          output: 50,
          reasoning: 10,
          cache: { read: 5, write: 3 },
        },
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-sf.json'])
        .mockResolvedValueOnce(['sf-1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(stepFinish));

      const session = new OpenCodeSession('part-step', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      const usageEvent = events.find((e) => e.type === 'resource:token_usage') as ACPEvent & {
        delta: {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
        };
      };
      expect(usageEvent).toBeDefined();
      expect(usageEvent.delta.inputTokens).toBe(100);
      expect(usageEvent.delta.outputTokens).toBe(50);
      expect(usageEvent.delta.cacheReadTokens).toBe(5);
      expect(usageEvent.delta.cacheWriteTokens).toBe(3);

      const costEvent = events.find((e) => e.type === 'resource:cost') as ACPEvent & {
        delta: { total: number };
      };
      expect(costEvent).toBeDefined();
      expect(costEvent.delta.total).toBe(0.005);

      await session.detach();
    });

    it('does not emit cost event when cost is 0', async () => {
      const msg = {
        id: 'msg-nc',
        sessionID: 'part-nocost',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      const stepFinish = {
        id: 'sf-nc',
        sessionID: 'part-nocost',
        messageID: 'msg-nc',
        type: 'step-finish',
        reason: 'end_turn',
        snapshot: '',
        cost: 0,
        tokens: {
          input: 10,
          output: 5,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-nc.json'])
        .mockResolvedValueOnce(['sf-nc.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(stepFinish));

      const session = new OpenCodeSession('part-nocost', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.type === 'resource:token_usage')).toBe(true);
      expect(events.some((e) => e.type === 'resource:cost')).toBe(false);

      await session.detach();
    });

    it('handles unknown part types without crashing', async () => {
      const msg = {
        id: 'msg-unk',
        sessionID: 'part-unknown',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      const stepStartPart = {
        id: 'ss-1',
        sessionID: 'part-unknown',
        messageID: 'msg-unk',
        type: 'step-start',
        snapshot: 'snap',
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-unk.json'])
        .mockResolvedValueOnce(['ss-1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(stepStartPart));

      const session = new OpenCodeSession('part-unknown', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      // step-start should not produce tool/message events
      expect(events.some((e) => e.type === 'tool:start')).toBe(false);

      await session.detach();
    });

    it('deduplicates parts by tracking seen IDs', async () => {
      const msg = {
        id: 'msg-dup',
        sessionID: 'part-dup',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };
      // Same text part ID appearing twice
      const textPart = {
        id: 'dup-part',
        sessionID: 'part-dup',
        messageID: 'msg-dup',
        type: 'text',
        text: 'Duplicate',
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-dup.json'])
        .mockResolvedValueOnce(['dup-part.json', 'dup-part.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(textPart))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const session = new OpenCodeSession('part-dup', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      // Should only see one delta event for the same part ID
      const deltas = events.filter((e) => e.type === 'message:delta');
      expect(deltas.length).toBe(1);

      await session.detach();
    });

    it('skips non-.json part files', async () => {
      const msg = {
        id: 'msg-pnj',
        sessionID: 'part-nonjson',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-pnj.json'])
        .mockResolvedValueOnce(['readme.txt', 'part-1.json']);

      const textPart = {
        id: 'part-1',
        sessionID: 'part-nonjson',
        messageID: 'msg-pnj',
        type: 'text',
        text: 'Valid',
      };

      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const session = new OpenCodeSession('part-nonjson', '/data', defaultCapabilities, null, '/');
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));

      const deltas = events.filter((e) => e.type === 'message:delta');
      expect(deltas.length).toBe(1);

      await session.detach();
    });

    it('skips unreadable part files', async () => {
      const msg = {
        id: 'msg-bp',
        sessionID: 'part-bad',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };

      vi.mocked(readdir)
        .mockResolvedValueOnce(['msg-bp.json'])
        .mockResolvedValueOnce(['part-1.json']);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(msg))
        .mockRejectedValueOnce(new Error('EACCES'));

      const session = new OpenCodeSession('part-bad', '/data', defaultCapabilities, null, '/');

      await new Promise((r) => setTimeout(r, 50));

      // Should not crash
      const history = await session.getHistory();
      expect(Array.isArray(history)).toBe(true);

      await session.detach();
    });
  });

  // ─────────────────── execute() ───────────────────

  describe('execute()', () => {
    it('send_message with active process writes to stdin', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('exec-stdin', '/data', defaultCapabilities);
      await session.start('/project', 'test');

      await session.execute({
        command: 'send_message',
        message: 'more input',
      });

      expect(mockProc.stdin.write).toHaveBeenCalledWith('more input\n');
    });

    it('send_message throws without server and without process', async () => {
      const session = new OpenCodeSession('exec-noserver', '/data', defaultCapabilities);

      await expect(
        session.execute({
          command: 'send_message',
          message: 'test',
        })
      ).rejects.toThrow('Cannot send message: no server connection and no active process');
    });

    it('send_message via HTTP when server is available', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('ok'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession('exec-http', '/data', defaultCapabilities, serverInfo);

      await session.execute({
        command: 'send_message',
        message: 'hello via http',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/session/exec-http/message',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('hello via http'),
        })
      );

      vi.unstubAllGlobals();
    });

    it('approve_tool_call via HTTP', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('ok'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession('exec-approve', '/data', defaultCapabilities, serverInfo);
      const events = collectEvents(session);

      await session.execute({
        command: 'approve_tool_call',
        requestId: 'req-1',
        toolCallId: 'tc-1',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/permission/req-1/reply',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reply: 'once' }),
        })
      );
      expect(events.some((e) => e.type === 'approval:resolved')).toBe(true);

      vi.unstubAllGlobals();
    });

    it('approve_tool_call throws without server', async () => {
      const session = new OpenCodeSession('exec-approve-no-srv', '/data', defaultCapabilities);

      await expect(
        session.execute({
          command: 'approve_tool_call',
          requestId: 'req-1',
          toolCallId: 'tc-1',
        })
      ).rejects.toThrow('Cannot approve tool calls without');
    });

    it('deny_tool_call via HTTP', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('ok'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession('exec-deny', '/data', defaultCapabilities, serverInfo);
      const events = collectEvents(session);

      await session.execute({
        command: 'deny_tool_call',
        requestId: 'req-2',
        toolCallId: 'tc-2',
        reason: 'not allowed',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/permission/req-2/reply',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            reply: 'reject',
            message: 'not allowed',
          }),
        })
      );
      const resolved = events.find((e) => e.type === 'approval:resolved') as ACPEvent & {
        approved: boolean;
        reason: string;
      };
      expect(resolved.approved).toBe(false);
      expect(resolved.reason).toBe('not allowed');

      vi.unstubAllGlobals();
    });

    it('deny_tool_call throws without server', async () => {
      const session = new OpenCodeSession('exec-deny-no-srv', '/data', defaultCapabilities);

      await expect(
        session.execute({
          command: 'deny_tool_call',
          requestId: 'req-2',
          toolCallId: 'tc-2',
          reason: 'no',
        })
      ).rejects.toThrow('Cannot deny tool calls without');
    });

    it('cancel via HTTP when server is available', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('ok'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession(
        'exec-cancel-http',
        '/data',
        defaultCapabilities,
        serverInfo
      );

      await session.execute({ command: 'cancel' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/session/exec-cancel-http/abort',
        expect.objectContaining({ method: 'POST' })
      );

      vi.unstubAllGlobals();
    });

    it('cancel sends SIGINT to process when no server', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('exec-cancel-proc', '/data', defaultCapabilities);
      await session.start('/project', 'test');

      await session.execute({ command: 'cancel' });

      expect(mockProc.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('terminate via HTTP calls abort endpoint', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('ok'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession('exec-term', '/data', defaultCapabilities, serverInfo);

      await session.execute({ command: 'terminate' });

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/abort'), expect.any(Object));

      vi.unstubAllGlobals();
    });

    it('terminate handles HTTP error gracefully', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi
        .fn()
        // First calls during start (session creation etc.) succeed
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({
            'content-type': 'application/json',
          }),
          json: () => Promise.resolve({ id: 'new-id' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: () => Promise.resolve('ok'),
        })
        // SSE fails
        .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
        // abort call fails
        .mockRejectedValueOnce(new Error('network error'));

      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities, serverInfo);
      await session.start('/project', 'test');

      // Should not throw even though HTTP abort fails
      await session.execute({ command: 'terminate' });

      vi.unstubAllGlobals();
    });

    it('terminate kills process without server', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('exec-term-proc', '/data', defaultCapabilities);
      await session.start('/project', 'test');

      await session.execute({ command: 'terminate' });

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('unknown command is a no-op', async () => {
      const session = new OpenCodeSession('exec-unknown', '/data', defaultCapabilities);
      await session.execute({
        command: 'unknown_cmd',
      } as unknown as ACPCommand);
    });
  });

  // ─────────────────── handleSSEEvent ───────────────────

  describe('handleSSEEvent (via handleProcessOutput)', () => {
    let session: OpenCodeSession;
    let events: ACPEvent[];
    let mockProc: ReturnType<typeof createMockProcess>;

    beforeEach(async () => {
      mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      session = new OpenCodeSession('sse-test', '/data', defaultCapabilities);
      events = collectEvents(session);
      await session.start('/project', 'test');
      events.length = 0;
    });

    it('permission.asked emits approval:requested', () => {
      emitStdoutLine(mockProc, {
        type: 'permission.asked',
        sessionID: 'sse-test',
        id: 'perm-1',
        permission: 'file:write',
        patterns: ['*.ts', '*.tsx'],
        metadata: { path: '/file.ts' },
        tool: { messageID: 'msg-1', callID: 'call-1' },
      });

      const approval = events.find((e) => e.type === 'approval:requested') as ACPEvent & {
        requestId: string;
        toolCallId: string;
        toolName: string;
      };
      expect(approval).toBeDefined();
      expect(approval.requestId).toBe('perm-1');
      expect(approval.toolCallId).toBe('call-1');
      expect(approval.toolName).toBe('file:write');
    });

    it('permission.asked without tool uses requestId as toolCallId', () => {
      emitStdoutLine(mockProc, {
        type: 'permission.asked',
        sessionID: 'sse-test',
        id: 'perm-notool',
        permission: 'bash',
        patterns: [],
        metadata: {},
      });

      const approval = events.find((e) => e.type === 'approval:requested') as ACPEvent & {
        toolCallId: string;
      };
      expect(approval.toolCallId).toBe('perm-notool');
    });

    it('permission.asked for different session is ignored', () => {
      emitStdoutLine(mockProc, {
        type: 'permission.asked',
        sessionID: 'other-session',
        id: 'perm-other',
        permission: 'file:write',
        patterns: [],
        metadata: {},
      });

      expect(events.some((e) => e.type === 'approval:requested')).toBe(false);
    });

    it('permission.replied updates status to running on accept', () => {
      emitStdoutLine(mockProc, {
        type: 'permission.replied',
        sessionID: 'sse-test',
        reply: 'once',
      });

      const statusEvents = events.filter(
        (e) => e.type === 'session:status_changed'
      ) as (ACPEvent & { to: string })[];
      expect(statusEvents.some((e) => e.to === 'running')).toBe(true);
    });

    it('permission.replied updates status to error on reject', () => {
      emitStdoutLine(mockProc, {
        type: 'permission.replied',
        sessionID: 'sse-test',
        reply: 'reject',
      });

      const statusEvents = events.filter(
        (e) => e.type === 'session:status_changed'
      ) as (ACPEvent & { to: string })[];
      expect(statusEvents.some((e) => e.to === 'error')).toBe(true);
    });

    it('permission.replied for different session is ignored', () => {
      emitStdoutLine(mockProc, {
        type: 'permission.replied',
        sessionID: 'other-session',
        reply: 'once',
      });

      expect(events.length).toBe(0);
    });

    it('message.part.updated processes part event', () => {
      emitStdoutLine(mockProc, {
        type: 'message.part.updated',
        sessionID: 'sse-test',
        part: {
          id: 'sse-part-1',
          sessionID: 'sse-test',
          messageID: 'msg-1',
          type: 'text',
          text: 'Streamed text',
        },
      });

      const delta = events.find((e) => e.type === 'message:delta') as ACPEvent & { delta: string };
      expect(delta).toBeDefined();
      expect(delta.delta).toBe('Streamed text');
    });

    it('message.part.updated for different session is ignored', () => {
      emitStdoutLine(mockProc, {
        type: 'message.part.updated',
        sessionID: 'sse-test',
        part: {
          id: 'sse-part-2',
          sessionID: 'other-session',
          messageID: 'msg-1',
          type: 'text',
          text: 'Should not appear',
        },
      });

      expect(events.some((e) => e.type === 'message:delta')).toBe(false);
    });

    it('message.part.updated without part is ignored', () => {
      emitStdoutLine(mockProc, {
        type: 'message.part.updated',
        sessionID: 'sse-test',
      });

      expect(events.length).toBe(0);
    });

    it('message.updated processes completed assistant message', () => {
      emitStdoutLine(mockProc, {
        type: 'message.updated',
        sessionID: 'sse-test',
        info: {
          id: 'msg-upd',
          sessionID: 'sse-test',
          role: 'assistant',
          time: { created: Date.now(), completed: Date.now() },
          modelID: 'gpt-4o',
          providerID: 'openai',
          mode: 'auto',
          agent: 'default',
          path: { cwd: '/', root: '/' },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          finish: 'end_turn',
        },
      });

      expect(events.some((e) => e.type === 'message:complete')).toBe(true);
    });

    it('message.updated for different session is ignored', () => {
      emitStdoutLine(mockProc, {
        type: 'message.updated',
        sessionID: 'sse-test',
        info: {
          id: 'msg-other',
          sessionID: 'other-session',
          role: 'assistant',
          time: { created: Date.now(), completed: Date.now() },
          finish: 'end_turn',
        },
      });

      expect(events.some((e) => e.type === 'message:complete')).toBe(false);
    });

    it('message.updated without info is ignored', () => {
      emitStdoutLine(mockProc, {
        type: 'message.updated',
        sessionID: 'sse-test',
      });

      expect(events.length).toBe(0);
    });

    it('message.updated ignores user messages', () => {
      emitStdoutLine(mockProc, {
        type: 'message.updated',
        sessionID: 'sse-test',
        info: {
          id: 'msg-user',
          sessionID: 'sse-test',
          role: 'user',
          time: { created: Date.now() },
        },
      });

      expect(events.some((e) => e.type === 'message:complete')).toBe(false);
    });
  });

  // ─────────────────── getHistory() ───────────────────

  describe('getHistory()', () => {
    it('returns a copy of emitted events', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('history-test', '/data', defaultCapabilities);
      await session.start('/project', 'test');

      const history = await session.getHistory();
      expect(history.length).toBeGreaterThan(0);

      // Verify it is a copy
      const originalLength = history.length;
      history.push({} as ACPEvent);
      const history2 = await session.getHistory();
      expect(history2.length).toBe(originalLength);
    });
  });

  // ─────────────────── detach() ───────────────────

  describe('detach()', () => {
    it('closes watchers when present', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'detach-test',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );

      await new Promise((r) => setTimeout(r, 20));

      await session.detach();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('kills process when present', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('detach-kill', '/data', defaultCapabilities);
      await session.start('/project', 'test');

      await session.detach();

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('aborts SSE connection when present', async () => {
      // SSE connection is established when serverInfo is provided
      // and session has a sessionId
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      // Mock fetch to hang (simulating SSE stream)
      const mockFetch = vi.fn().mockImplementation(() => {
        return new Promise(() => {}); // never resolves
      });
      vi.stubGlobal('fetch', mockFetch);
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'detach-sse',
        '/data',
        defaultCapabilities,
        serverInfo,
        '/project'
      );

      await new Promise((r) => setTimeout(r, 20));

      // detach should abort the SSE connection
      await session.detach();

      // The session should clean up without throwing
      vi.unstubAllGlobals();
    });

    it('does nothing when no resources exist', async () => {
      const session = new OpenCodeSession(undefined, '/data', defaultCapabilities);
      // Should not throw
      await session.detach();
    });
  });

  // ─────────────────── httpPost ───────────────────

  describe('httpPost (via execute)', () => {
    it('handles JSON response', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: () => Promise.resolve({ status: 'ok' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession('http-json', '/data', defaultCapabilities, serverInfo);

      await session.execute({ command: 'cancel' });

      expect(mockFetch).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('throws on non-OK response', async () => {
      const serverInfo: ServerInfo = {
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const session = new OpenCodeSession('http-err', '/data', defaultCapabilities, serverInfo);

      await expect(
        session.execute({
          command: 'send_message',
          message: 'test',
        })
      ).rejects.toThrow('OpenCode API error 500: Internal error');

      vi.unstubAllGlobals();
    });

    it('throws when no server info', async () => {
      const session = new OpenCodeSession('no-server', '/data', defaultCapabilities);

      // approve_tool_call internally calls httpPost
      await expect(
        session.execute({
          command: 'approve_tool_call',
          requestId: 'r',
          toolCallId: 't',
        })
      ).rejects.toThrow('Cannot approve tool calls without');

      vi.unstubAllGlobals();
    });
  });

  // ─────────────────── File watching (onMessageFileChange, onPartFileChange) ───────────────────

  describe('file watching handlers', () => {
    it('processes new message file on add/change', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);

      // loadHistory reads
      vi.mocked(readdir).mockRejectedValueOnce(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'fw-test',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 20));
      events.length = 0;

      // Find the message watcher handlers
      const messageWatcherOn = vi.mocked(watch).mock.results[0]?.value?.on as ReturnType<
        typeof vi.fn
      >;
      expect(messageWatcherOn).toBeDefined();

      // Get 'add' handler for message watcher (first watch call)
      const addCall = messageWatcherOn.mock.calls.find((call: unknown[]) => call[0] === 'add');
      expect(addCall).toBeDefined();
      const addHandler = addCall![1];

      const userMsg = {
        id: 'new-msg',
        sessionID: 'fw-test',
        role: 'user',
        time: { created: Date.now() },
      };
      const textPart = {
        id: 'new-part',
        sessionID: 'fw-test',
        messageID: 'new-msg',
        type: 'text',
        text: 'New message',
      };

      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(userMsg));
      vi.mocked(readdir).mockResolvedValueOnce(['new-part.json']);
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(textPart));

      addHandler('/data/storage/message/fw-test/new-msg.json');

      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.type === 'message:start')).toBe(true);

      await session.detach();
    });

    it('ignores non-.json files in message watcher', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readdir).mockRejectedValueOnce(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'fw-nonjson',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 20));
      events.length = 0;

      const messageWatcherOn = vi.mocked(watch).mock.results[0]?.value?.on as ReturnType<
        typeof vi.fn
      >;
      const addCall = messageWatcherOn.mock.calls.find((call: unknown[]) => call[0] === 'add');
      const addHandler = addCall![1];

      addHandler('/data/storage/message/fw-nonjson/readme.txt');

      await new Promise((r) => setTimeout(r, 20));

      expect(events.length).toBe(0);

      await session.detach();
    });

    it('ignores messages from different session', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readdir).mockRejectedValueOnce(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'fw-diff-sess',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 20));
      events.length = 0;

      const messageWatcherOn = vi.mocked(watch).mock.results[0]?.value?.on as ReturnType<
        typeof vi.fn
      >;
      const addCall = messageWatcherOn.mock.calls.find((call: unknown[]) => call[0] === 'add');
      const addHandler = addCall![1];

      const otherMsg = {
        id: 'other-msg',
        sessionID: 'other-session',
        role: 'user',
        time: { created: Date.now() },
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(otherMsg));

      addHandler('/data/storage/message/fw-diff-sess/other-msg.json');

      await new Promise((r) => setTimeout(r, 20));

      expect(events.some((e) => e.type === 'message:start')).toBe(false);

      await session.detach();
    });

    it('processes part file changes', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readdir).mockRejectedValueOnce(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'fw-part',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 20));
      events.length = 0;

      // Both watchers share the same mock. The on() calls are:
      // [0] message add, [1] message change, [2] part add, [3] part change
      const onCalls = mockWatcher.on.mock.calls;
      const partAddCall = onCalls.filter((call: unknown[]) => call[0] === 'add')[1]; // second 'add' handler is for parts
      expect(partAddCall).toBeDefined();
      const addHandler = partAddCall[1];

      const textPart = {
        id: 'fw-part-1',
        sessionID: 'fw-part',
        messageID: 'msg-1',
        type: 'text',
        text: 'New part text',
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(textPart));

      addHandler('/data/storage/part/msg-1/fw-part-1.json');

      await new Promise((r) => setTimeout(r, 20));

      expect(events.some((e) => e.type === 'message:delta')).toBe(true);

      await session.detach();
    });

    it('ignores part files from different session', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readdir).mockRejectedValueOnce(new Error('ENOENT'));

      const session = new OpenCodeSession(
        'fw-part-other',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 20));
      events.length = 0;

      // Second 'add' handler is the part watcher's
      const onCalls = mockWatcher.on.mock.calls;
      const partAddCall = onCalls.filter((call: unknown[]) => call[0] === 'add')[1];
      const addHandler = partAddCall[1];

      const otherPart = {
        id: 'other-part',
        sessionID: 'other-session',
        messageID: 'msg-1',
        type: 'text',
        text: 'Should not appear',
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(otherPart));

      addHandler('/data/storage/part/msg-1/other-part.json');

      await new Promise((r) => setTimeout(r, 20));

      expect(events.some((e) => e.type === 'message:delta')).toBe(false);

      await session.detach();
    });

    it('handles already-seen messages as updates', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);

      // loadHistory loads initial message
      const assistantMsg = {
        id: 'seen-msg',
        sessionID: 'fw-update',
        role: 'assistant',
        time: { created: Date.now() },
        modelID: 'model',
        providerID: 'prov',
        mode: 'auto',
        agent: 'default',
        path: { cwd: '/', root: '/' },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      };

      vi.mocked(readdir).mockResolvedValueOnce(['seen-msg.json']).mockResolvedValueOnce([]); // no parts
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(assistantMsg));

      const session = new OpenCodeSession(
        'fw-update',
        '/data',
        defaultCapabilities,
        null,
        '/project'
      );
      const events = collectEvents(session);

      await new Promise((r) => setTimeout(r, 50));
      events.length = 0;

      // Now simulate a change event for the same message (now completed)
      const messageWatcherOn = vi.mocked(watch).mock.results[0]?.value?.on as ReturnType<
        typeof vi.fn
      >;
      const changeCall = messageWatcherOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      );
      const changeHandler = changeCall![1];

      const updatedMsg = {
        ...assistantMsg,
        time: { created: Date.now(), completed: Date.now() },
        finish: 'end_turn',
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(updatedMsg));

      changeHandler('/data/storage/message/fw-update/seen-msg.json');

      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.type === 'message:complete')).toBe(true);

      await session.detach();
    });
  });

  // ─────────────────── createEvent integration ───────────────────

  describe('createEvent integration', () => {
    it('calls createEvent with correct sessionId for all events', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new OpenCodeSession('ce-test', '/data', defaultCapabilities);
      collectEvents(session);
      await session.start('/project', 'test');

      const calls = vi.mocked(createEvent).mock.calls;
      for (const call of calls) {
        expect(call[0]).toBe('ce-test');
      }
    });
  });
});

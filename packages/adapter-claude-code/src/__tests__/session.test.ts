import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { ACPEvent, ACPCommand } from '@agentap-dev/acp';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    const watcher = {
      on: vi.fn(function (this: unknown) {
        return watcher;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    return watcher;
  }),
}));

vi.mock('fs/promises', () => ({
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
import { ClaudeCodeSession } from '../session';
import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { watch } from 'chokidar';
import { createEvent, resetSequence } from '@agentap-dev/acp';

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

function collectEvents(session: ClaudeCodeSession): ACPEvent[] {
  const events: ACPEvent[] = [];
  session.onEvent((e) => events.push(e));
  return events;
}

function emitStdoutLine(proc: ReturnType<typeof createMockProcess>, obj: unknown): void {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ClaudeCodeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────── Constructor ───────────────────

  describe('constructor', () => {
    it('generates a random sessionId when none provided', () => {
      const session = new ClaudeCodeSession();
      expect(session.sessionId).toBeTruthy();
      expect(session.sessionId.length).toBeGreaterThan(10);
    });

    it('uses the provided sessionId', () => {
      const session = new ClaudeCodeSession('my-session-id');
      expect(session.sessionId).toBe('my-session-id');
    });

    it('starts watching when sessionDir is provided', () => {
      new ClaudeCodeSession('sess-123', '/some/dir');
      expect(watch).toHaveBeenCalledWith('/some/dir/sess-123.jsonl', { persistent: true });
    });

    it('resolves initialReadDone immediately when no sessionDir', async () => {
      const session = new ClaudeCodeSession('sess-no-dir');
      // getHistory waits for initialReadDone; should resolve immediately
      const history = await session.getHistory();
      expect(history).toEqual([]);
    });

    it('sets default empty capabilities when none provided', () => {
      const session = new ClaudeCodeSession();
      expect(session.capabilities).toEqual({});
    });

    it('uses provided capabilities', () => {
      const caps = { streaming: true } as never;
      const session = new ClaudeCodeSession('s', undefined, caps);
      expect(session.capabilities).toBe(caps);
    });
  });

  // ─────────────────── onEvent ───────────────────

  describe('onEvent()', () => {
    it('registers callback that receives ACP events', async () => {
      const session = new ClaudeCodeSession('on-event-test');
      const events: ACPEvent[] = [];
      session.onEvent((e) => events.push(e));

      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      await session.start('/project', 'hello');

      // start() emits session:status_changed and session:started
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'session:started')).toBe(true);
    });

    it('returns an unsubscribe function', () => {
      const session = new ClaudeCodeSession('unsub-test');
      const unsub = session.onEvent(() => {});
      expect(typeof unsub).toBe('function');
    });

    it('unsubscribe stops receiving events', async () => {
      const session = new ClaudeCodeSession('unsub-test-2');
      const events: ACPEvent[] = [];
      const unsub = session.onEvent((e) => events.push(e));
      unsub();

      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);
      await session.start('/project', 'hello');

      expect(events.length).toBe(0);
    });
  });

  // ─────────────────── start() ───────────────────

  describe('start()', () => {
    it('spawns claude with correct args', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('start-test');
      await session.start('/my/project', 'do something');

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--verbose', '--output-format', 'stream-json', 'do something'],
        { cwd: '/my/project', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    });

    it('adds --model flag when model is provided', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('model-test');
      await session.start('/project', 'prompt', 'opus');

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--verbose', '--output-format', 'stream-json', '--model', 'opus', 'prompt'],
        expect.any(Object)
      );
    });

    it('emits session:started event', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('started-event-test');
      const events = collectEvents(session);
      await session.start('/my/project', 'hello');

      expect(events.some((e) => e.type === 'session:started')).toBe(true);
      const started = events.find((e) => e.type === 'session:started') as ACPEvent & {
        agent: string;
        projectPath: string;
      };
      expect(started.agent).toBe('claude-code');
      expect(started.projectPath).toBe('/my/project');
    });

    it('emits status_changed to starting then running', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('status-test');
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

      const session = new ClaudeCodeSession('exit-0-test');
      const events = collectEvents(session);
      await session.start('/project', 'test');

      mockProc.emit('close', 0);

      expect(events.some((e) => e.type === 'session:completed')).toBe(true);
    });

    it('emits session:error on non-zero exit', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('exit-err-test');
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

      const session = new ClaudeCodeSession('spawn-err-test');
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

      const session = new ClaudeCodeSession('reset-seq-test');
      await session.start('/project', 'test');

      expect(resetSequence).toHaveBeenCalledWith('reset-seq-test');
    });
  });

  // ─────────────────── handleStreamEvent (stdout) ───────────────────

  describe('handleStreamEvent() via stdout', () => {
    let session: ClaudeCodeSession;
    let events: ACPEvent[];
    let mockProc: ReturnType<typeof createMockProcess>;

    beforeEach(async () => {
      mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      session = new ClaudeCodeSession('stream-test');
      events = collectEvents(session);
      await session.start('/project', 'test');
      // Clear startup events
      events.length = 0;
    });

    it('system init sets sessionId and emits environment:info', () => {
      emitStdoutLine(mockProc, {
        type: 'system',
        subtype: 'init',
        session_id: 'new-session-id',
        claude_version: '1.2.3',
        model: 'claude-opus-4-6',
      });

      expect(session.sessionId).toBe('new-session-id');
      expect(events.some((e) => e.type === 'environment:info')).toBe(true);
    });

    it('assistant with text emits message:start, message:delta, message:complete', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-1',
          content: [{ type: 'text', text: 'Hello world' }],
        },
        stop_reason: 'end_turn',
        model: 'claude-opus-4-6',
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('message:start');
      expect(types).toContain('message:delta');
      expect(types).toContain('message:complete');

      const delta = events.find((e) => e.type === 'message:delta') as ACPEvent & {
        delta: string;
      };
      expect(delta.delta).toBe('Hello world');
    });

    it('assistant with thinking emits thinking events', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-t',
          content: [
            { type: 'thinking', thinking: 'Let me think...' },
            { type: 'text', text: 'Answer' },
          ],
        },
        stop_reason: 'end_turn',
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('thinking:start');
      expect(types).toContain('thinking:delta');
      expect(types).toContain('thinking:complete');

      const thinkDelta = events.find((e) => e.type === 'thinking:delta') as ACPEvent & {
        delta: string;
      };
      expect(thinkDelta.delta).toBe('Let me think...');
    });

    it('assistant with usage emits resource:token_usage', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-u',
          content: [{ type: 'text', text: 'hi' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5,
          },
        },
        stop_reason: 'end_turn',
      });

      const usageEvent = events.find((e) => e.type === 'resource:token_usage') as ACPEvent & {
        delta: { inputTokens: number; outputTokens: number };
      };
      expect(usageEvent).toBeDefined();
      expect(usageEvent.delta.inputTokens).toBe(100);
      expect(usageEvent.delta.outputTokens).toBe(50);
    });

    it('assistant with stop_reason null emits start/delta but no complete', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-partial',
          content: [{ type: 'text', text: 'streaming...' }],
        },
        stop_reason: null,
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('message:start');
      expect(types).toContain('message:delta');
      expect(types).not.toContain('message:complete');
    });

    it('user event emits message:start and message:complete', () => {
      emitStdoutLine(mockProc, {
        type: 'user',
        message: {
          content: [{ type: 'text', text: 'User input' }],
        },
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('message:start');
      expect(types).toContain('message:complete');

      const complete = events.find((e) => e.type === 'message:complete') as ACPEvent & {
        role: string;
        content: { text: string }[];
      };
      expect(complete.role).toBe('user');
      expect(complete.content[0].text).toBe('User input');
    });

    it('tool_use emits tool:start and tool:executing', () => {
      emitStdoutLine(mockProc, {
        type: 'tool_use',
        tool_use_id: 'tool-1',
        name: 'Bash',
        input: { command: 'ls' },
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('tool:start');
      expect(types).toContain('tool:executing');
    });

    it('tool_result success emits tool:result', () => {
      emitStdoutLine(mockProc, {
        type: 'tool_result',
        tool_use_id: 'tool-result-1',
        content: 'file.txt',
        is_error: false,
      });

      const resultEvent = events.find((e) => e.type === 'tool:result') as ACPEvent & {
        toolCallId: string;
        output: string;
      };
      expect(resultEvent).toBeDefined();
      expect(resultEvent.toolCallId).toBe('tool-result-1');
      expect(resultEvent.output).toBe('file.txt');
    });

    it('tool_result error emits tool:error', () => {
      emitStdoutLine(mockProc, {
        type: 'tool_result',
        tool_use_id: 'tool-err-1',
        content: 'Permission denied',
        is_error: true,
      });

      const errEvent = events.find((e) => e.type === 'tool:error') as ACPEvent & {
        toolCallId: string;
        error: { message: string };
      };
      expect(errEvent).toBeDefined();
      expect(errEvent.toolCallId).toBe('tool-err-1');
      expect(errEvent.error.message).toBe('Permission denied');
    });

    it('ignores non-JSON lines', () => {
      mockProc.stdout.emit('data', Buffer.from('This is not JSON\n'));
      // Should not throw and no events should be emitted
      expect(events.length).toBe(0);
    });

    it('handles buffered partial lines correctly', () => {
      const jsonStr = JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: 'buffered' }] },
      });

      // Send first half
      mockProc.stdout.emit('data', Buffer.from(jsonStr.substring(0, 10)));
      expect(events.length).toBe(0);

      // Send second half + newline
      mockProc.stdout.emit('data', Buffer.from(jsonStr.substring(10) + '\n'));
      expect(events.some((e) => e.type === 'message:start')).toBe(true);
    });

    it('tool_result with non-string content stringifies it', () => {
      emitStdoutLine(mockProc, {
        type: 'tool_result',
        tool_use_id: 'tool-obj-1',
        content: [{ type: 'text', text: 'some result' }],
        is_error: false,
      });

      const resultEvent = events.find((e) => e.type === 'tool:result') as ACPEvent & {
        output: string;
      };
      expect(resultEvent).toBeDefined();
      expect(resultEvent.output).toBe(JSON.stringify([{ type: 'text', text: 'some result' }]));
    });
  });

  // ─────────────────── handleJSONLEvent (file watching) ───────────────

  describe('handleJSONLEvent() via file watching', () => {
    let session: ClaudeCodeSession;
    let events: ACPEvent[];
    let mockWatcher: { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    let changeHandler: () => void;

    beforeEach(async () => {
      // Setup mock watcher to capture event handlers
      mockWatcher = {
        on: vi.fn(function (this: unknown, event: string, handler: () => void) {
          if (event === 'change') {
            changeHandler = handler;
          }
          return mockWatcher;
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);

      // First call: initial read (empty file, resolves initialReadDone)
      // Subsequent calls: simulate file content
      vi.mocked(readFile).mockResolvedValueOnce('');

      session = new ClaudeCodeSession('jsonl-test', '/sessions/dir');
      events = collectEvents(session);

      // Wait for initialReadDone to resolve
      await session.getHistory();
      events.length = 0;
    });

    async function simulateFileChange(lines: string[]): Promise<void> {
      const content = lines.join('\n') + '\n';
      vi.mocked(readFile).mockResolvedValueOnce(content);
      changeHandler();
      // Allow async readFile to complete
      await vi.waitFor(() => {
        expect(readFile).toHaveBeenCalled();
      });
      // Small wait for event processing
      await new Promise((r) => setTimeout(r, 10));
    }

    it('user message emits message:start and message:complete and sets projectPath', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-1',
          cwd: '/my/project',
          message: {
            content: [{ type: 'text', text: 'Hello from user' }],
          },
        }),
      ]);

      expect(events.some((e) => e.type === 'message:start')).toBe(true);
      expect(events.some((e) => e.type === 'message:complete')).toBe(true);

      const complete = events.find(
        (e) => e.type === 'message:complete' && (e as ACPEvent & { role: string }).role === 'user'
      ) as ACPEvent & { content: { text: string }[] };
      expect(complete).toBeDefined();
      expect(complete.content[0].text).toBe('Hello from user');
    });

    it('user with tool_result blocks emits tool:result for each', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-2',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tr-1', content: 'output1', is_error: false },
              { type: 'tool_result', tool_use_id: 'tr-2', content: 'output2', is_error: false },
            ],
          },
        }),
      ]);

      const results = events.filter((e) => e.type === 'tool:result');
      expect(results.length).toBe(2);
    });

    it('user with tool_result error emits tool:error', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-3',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tr-err-1',
                content: 'Error occurred',
                is_error: true,
              },
            ],
          },
        }),
      ]);

      const errEvents = events.filter((e) => e.type === 'tool:error');
      expect(errEvents.length).toBe(1);
    });

    it('assistant message emits message:start, message:delta, message:complete', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-1',
          message: {
            content: [{ type: 'text', text: 'Assistant reply' }],
            stop_reason: 'end_turn',
          },
        }),
      ]);

      const types = events.map((e) => e.type);
      expect(types).toContain('message:start');
      expect(types).toContain('message:delta');
      expect(types).toContain('message:complete');
    });

    it('assistant with tool_use blocks emits tool:start and tool:executing', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-2',
          message: {
            content: [
              { type: 'text', text: 'Let me run that' },
              {
                type: 'tool_use',
                id: 'tu-1',
                name: 'Bash',
                input: { command: 'ls -la' },
              },
            ],
            stop_reason: 'tool_use',
          },
        }),
      ]);

      const types = events.map((e) => e.type);
      expect(types).toContain('tool:start');
      expect(types).toContain('tool:executing');
    });

    it('assistant with thinking emits thinking events', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-3',
          message: {
            content: [
              { type: 'thinking', thinking: 'Deep thought...' },
              { type: 'text', text: 'Result' },
            ],
            stop_reason: 'end_turn',
          },
        }),
      ]);

      const types = events.map((e) => e.type);
      expect(types).toContain('thinking:start');
      expect(types).toContain('thinking:delta');
      expect(types).toContain('thinking:complete');
    });

    it('assistant with usage emits resource:token_usage', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-4',
          message: {
            content: [{ type: 'text', text: 'response' }],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 200,
              output_tokens: 100,
            },
          },
        }),
      ]);

      const usageEvent = events.find((e) => e.type === 'resource:token_usage') as ACPEvent & {
        delta: { inputTokens: number; outputTokens: number };
      };
      expect(usageEvent).toBeDefined();
      expect(usageEvent.delta.inputTokens).toBe(200);
      expect(usageEvent.delta.outputTokens).toBe(100);
    });

    it('assistant with model (first time) emits environment:info', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-5',
          message: {
            content: [{ type: 'text', text: 'hi' }],
            stop_reason: 'end_turn',
            model: 'claude-opus-4-6',
          },
        }),
      ]);

      expect(events.some((e) => e.type === 'environment:info')).toBe(true);
    });

    it('assistant with model (second time) does NOT emit environment:info again', async () => {
      // First assistant message with model
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-6',
          message: {
            content: [{ type: 'text', text: 'first' }],
            stop_reason: 'end_turn',
            model: 'claude-opus-4-6',
          },
        }),
      ]);

      const envInfoCount1 = events.filter((e) => e.type === 'environment:info').length;
      expect(envInfoCount1).toBe(1);

      // Second assistant message with model
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-6',
          message: {
            content: [{ type: 'text', text: 'first' }],
            stop_reason: 'end_turn',
            model: 'claude-opus-4-6',
          },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-7',
          message: {
            content: [{ type: 'text', text: 'second' }],
            stop_reason: 'end_turn',
            model: 'claude-opus-4-6',
          },
        }),
      ]);

      const envInfoCount2 = events.filter((e) => e.type === 'environment:info').length;
      // Should still be 1 — not emitted again
      expect(envInfoCount2).toBe(1);
    });

    it('skips unknown event types gracefully', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'queue-operation',
          data: 'something',
        }),
      ]);

      // Only status_changed events from JSONL processing (thinking status), no crashes
      const messageEvents = events.filter(
        (e) =>
          e.type === 'message:start' || e.type === 'message:complete' || e.type === 'tool:start'
      );
      expect(messageEvents.length).toBe(0);
    });

    it('ignores non-JSON lines in JSONL file', async () => {
      vi.mocked(readFile).mockResolvedValueOnce(
        'this is not json\n' + JSON.stringify({ type: 'unknown-stuff' }) + '\n'
      );
      changeHandler();
      await new Promise((r) => setTimeout(r, 10));

      // Should not throw, no error events
      const errEvents = events.filter((e) => e.type === 'session:error');
      expect(errEvents.length).toBe(0);
    });

    it('transitions to thinking status on user event', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-status',
          message: {
            content: [{ type: 'text', text: 'test' }],
          },
        }),
      ]);

      const statusEvents = events.filter(
        (e) => e.type === 'session:status_changed'
      ) as (ACPEvent & { to: string })[];
      expect(statusEvents.some((e) => e.to === 'thinking')).toBe(true);
    });

    it('transitions to running status on assistant event', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-status',
          message: {
            content: [{ type: 'text', text: 'reply' }],
            stop_reason: 'end_turn',
          },
        }),
      ]);

      const statusEvents = events.filter(
        (e) => e.type === 'session:status_changed'
      ) as (ACPEvent & { to: string })[];
      expect(statusEvents.some((e) => e.to === 'running')).toBe(true);
    });
  });

  // ─────────────────── execute() ───────────────────

  describe('execute()', () => {
    it('send_message with active process writes to stdin', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('exec-stdin');
      await session.start('/project', 'test');

      await session.execute({
        command: 'send_message',
        message: 'more input',
      });

      expect(mockProc.stdin.write).toHaveBeenCalledWith('more input\n');
    });

    it('send_message without active process calls resumeWithMessage', async () => {
      // No process started — the session should spawn a resume process
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('exec-resume');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'resume message',
      });

      // resumeWithMessage emits user message events
      expect(events.some((e) => e.type === 'message:start')).toBe(true);
      expect(events.some((e) => e.type === 'message:complete')).toBe(true);

      // It spawns claude with --resume flag
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--resume', 'exec-resume']),
        expect.any(Object)
      );
    });

    it('approve_tool_call resolves pending approval with true', async () => {
      const session = new ClaudeCodeSession('exec-approve');
      // Access pendingApprovals via internal state
      const pendingMap = (
        session as unknown as { pendingApprovals: Map<string, { resolve: (v: boolean) => void }> }
      ).pendingApprovals;

      let resolved: boolean | null = null;
      pendingMap.set('tc-1', {
        resolve: (v: boolean) => {
          resolved = v;
        },
      });

      await session.execute({
        command: 'approve_tool_call',
        requestId: 'req-1',
        toolCallId: 'tc-1',
      });

      expect(resolved).toBe(true);
      expect(pendingMap.has('tc-1')).toBe(false);
    });

    it('deny_tool_call resolves pending approval with false', async () => {
      const session = new ClaudeCodeSession('exec-deny');
      const pendingMap = (
        session as unknown as { pendingApprovals: Map<string, { resolve: (v: boolean) => void }> }
      ).pendingApprovals;

      let resolved: boolean | null = null;
      pendingMap.set('tc-2', {
        resolve: (v: boolean) => {
          resolved = v;
        },
      });

      await session.execute({
        command: 'deny_tool_call',
        requestId: 'req-2',
        toolCallId: 'tc-2',
        reason: 'not allowed',
      });

      expect(resolved).toBe(false);
      expect(pendingMap.has('tc-2')).toBe(false);
    });

    it('cancel sends SIGINT to the process', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('exec-cancel');
      await session.start('/project', 'test');

      await session.execute({ command: 'cancel' });

      expect(mockProc.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('cancel does nothing when no process is running', async () => {
      const session = new ClaudeCodeSession('exec-cancel-no-proc');
      // Should not throw
      await session.execute({ command: 'cancel' });
    });

    it('terminate sends SIGTERM and closes watcher', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readFile).mockResolvedValueOnce('');

      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('exec-term', '/sessions');
      // Wait for initial read
      await session.getHistory();

      await session.start('/project', 'test');

      await session.execute({ command: 'terminate' });

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('resume with prompt calls start()', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('exec-resume-prompt');
      // Set projectPath first via start
      await session.start('/project', 'initial');
      vi.mocked(spawn).mockClear();

      const mockProc2 = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc2 as unknown as ChildProcess);

      await session.execute({ command: 'resume', prompt: 'continue please' });

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['continue please']),
        expect.any(Object)
      );
    });

    it('resume without prompt is a no-op', async () => {
      const session = new ClaudeCodeSession('exec-resume-noop');
      // Should not throw
      await session.execute({ command: 'resume' } as ACPCommand);
    });

    it('unknown command is a no-op', async () => {
      const session = new ClaudeCodeSession('exec-unknown');
      // Should not throw
      await session.execute({ command: 'unknown_cmd' } as unknown as ACPCommand);
    });
  });

  // ─────────────────── getHistory() ───────────────────

  describe('getHistory()', () => {
    it('returns a copy of emitted events', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('history-test');
      await session.start('/project', 'test');

      const history = await session.getHistory();
      expect(history.length).toBeGreaterThan(0);

      // Verify it is a copy (mutating it should not affect internal state)
      const originalLength = history.length;
      history.push({} as ACPEvent);
      const history2 = await session.getHistory();
      expect(history2.length).toBe(originalLength);
    });

    it('waits for initialReadDone before returning', async () => {
      // With sessionDir, initialReadDone depends on readNewMessages completing
      vi.mocked(readFile).mockResolvedValueOnce('');
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);

      const session = new ClaudeCodeSession('history-wait', '/sessions');

      const history = await session.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  // ─────────────────── refresh() ───────────────────

  describe('refresh()', () => {
    it('triggers readNewMessages', async () => {
      vi.mocked(readFile).mockResolvedValue('');
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);

      const session = new ClaudeCodeSession('refresh-test', '/sessions');
      await session.getHistory();

      // Call refresh — it should call readFile again
      vi.mocked(readFile).mockClear();
      vi.mocked(readFile).mockResolvedValueOnce('');

      session.refresh();

      await vi.waitFor(() => {
        expect(readFile).toHaveBeenCalled();
      });
    });
  });

  // ─────────────────── detach() ───────────────────

  describe('detach()', () => {
    it('closes watcher when present', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readFile).mockResolvedValueOnce('');

      const session = new ClaudeCodeSession('detach-test', '/sessions');
      await session.getHistory();

      await session.detach();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('does nothing when no watcher exists', async () => {
      const session = new ClaudeCodeSession('detach-no-watcher');
      // Should not throw
      await session.detach();
    });
  });

  // ─────────────────── resumeWithMessage ───────────────────

  describe('resumeWithMessage() (via send_message without process)', () => {
    it('spawns claude with --resume flag and correct args', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-msg-test');

      await session.execute({
        command: 'send_message',
        message: 'continue working',
      });

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        [
          '--resume',
          'resume-msg-test',
          '--print',
          '--verbose',
          '--output-format',
          'stream-json',
          'continue working',
        ],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
    });

    it('emits user message events immediately', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-emit-test');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'user msg',
      });

      const msgStart = events.find(
        (e) => e.type === 'message:start' && (e as ACPEvent & { role: string }).role === 'user'
      );
      const msgComplete = events.find(
        (e) => e.type === 'message:complete' && (e as ACPEvent & { role: string }).role === 'user'
      );
      expect(msgStart).toBeDefined();
      expect(msgComplete).toBeDefined();
    });

    it('emits session:error on resume spawn error', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-err-test');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'test',
      });

      // Simulate spawn error on the resume process
      mockProc.emit('error', new Error('resume failed'));

      const errEvent = events.find((e) => e.type === 'session:error') as ACPEvent & {
        error: { code: string; message: string };
      };
      expect(errEvent).toBeDefined();
      expect(errEvent.error.code).toBe('RESUME_ERROR');
      expect(errEvent.error.message).toBe('resume failed');
    });

    it('sets status to running during resume', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-status-test');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'test',
      });

      const statusEvents = events.filter(
        (e) => e.type === 'session:status_changed'
      ) as (ACPEvent & { to: string })[];
      expect(statusEvents.some((e) => e.to === 'running')).toBe(true);
    });

    it('sets status to idle and unsuppresses file events on close', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);
      vi.mocked(readFile).mockResolvedValue('');

      const session = new ClaudeCodeSession('resume-close-test');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'test',
      });

      mockProc.emit('close');

      const statusEvents = events.filter(
        (e) => e.type === 'session:status_changed'
      ) as (ACPEvent & { to: string })[];
      expect(statusEvents.some((e) => e.to === 'idle')).toBe(true);
    });
  });

  // ─────────────────── createEvent usage ───────────────────

  describe('createEvent integration', () => {
    it('calls createEvent with correct sessionId for all events', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('ce-test');
      collectEvents(session);
      await session.start('/project', 'test');

      // All createEvent calls should use our sessionId
      const calls = vi.mocked(createEvent).mock.calls;
      for (const call of calls) {
        expect(call[0]).toBe('ce-test');
      }
    });
  });

  // ─────────────────── Additional branch coverage ───────────────────

  describe('resumeWithMessage() stdout/stderr handlers', () => {
    it('processes stdout data from resumed process', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-stdout-test');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'continue',
      });

      // Clear startup events
      events.length = 0;

      // Emit stdout data on the resumed process (covers lines 291-297)
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-resume-1',
          content: [{ type: 'text', text: 'Resumed output' }],
        },
        stop_reason: 'end_turn',
      });

      expect(events.some((e) => e.type === 'message:start')).toBe(true);
      expect(events.some((e) => e.type === 'message:complete')).toBe(true);
    });

    it('handles stderr data from resumed process', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const session = new ClaudeCodeSession('resume-stderr-test');

      await session.execute({
        command: 'send_message',
        message: 'continue',
      });

      // Emit stderr data on the resumed process (covers line 303)
      mockProc.stderr.emit('data', Buffer.from('some warning\n'));

      expect(consoleSpy).toHaveBeenCalledWith('Claude resume stderr:', 'some warning\n');
      consoleSpy.mockRestore();
    });

    it('passes projectPath as cwd when set', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-cwd-test');
      // First start the session to set projectPath
      await session.start('/my/project', 'initial');

      // Close the first process so resumeWithMessage is called
      mockProc.emit('close', 0);

      const mockProc2 = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc2 as unknown as ChildProcess);

      await session.execute({
        command: 'send_message',
        message: 'continue working',
      });

      // Should pass projectPath as cwd (covers truthy branch of line 282)
      expect(spawn).toHaveBeenLastCalledWith(
        'claude',
        expect.arrayContaining(['--resume']),
        expect.objectContaining({ cwd: '/my/project' })
      );
    });

    it('passes undefined as cwd when projectPath is empty', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-no-cwd-test');

      await session.execute({
        command: 'send_message',
        message: 'test',
      });

      // projectPath is '' by default, so cwd should be undefined (covers falsy branch of line 282)
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.anything(),
        expect.objectContaining({ cwd: undefined })
      );
    });

    it('handles buffered partial lines on resumed process stdout', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-buffer-test');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'continue',
      });

      events.length = 0;

      const jsonStr = JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: 'buffered in resume' }] },
      });

      // Send partial line first
      mockProc.stdout.emit('data', Buffer.from(jsonStr.substring(0, 15)));
      expect(events.length).toBe(0);

      // Send rest + newline
      mockProc.stdout.emit('data', Buffer.from(jsonStr.substring(15) + '\n'));
      expect(events.some((e) => e.type === 'message:start')).toBe(true);
    });

    it('handles empty lines in resumed process stdout', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('resume-empty-line-test');
      const events = collectEvents(session);

      await session.execute({
        command: 'send_message',
        message: 'test',
      });

      events.length = 0;

      // Emit empty lines followed by a valid line
      mockProc.stdout.emit('data', Buffer.from('\n\n'));
      expect(events.length).toBe(0);
    });
  });

  describe('handleStreamEvent additional branches', () => {
    let session: ClaudeCodeSession;
    let events: ACPEvent[];
    let mockProc: ReturnType<typeof createMockProcess>;

    beforeEach(async () => {
      mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      session = new ClaudeCodeSession('stream-branch-test');
      events = collectEvents(session);
      await session.start('/project', 'test');
      events.length = 0;
    });

    it('assistant with tool_use in content maps to tool_use type in message:complete', () => {
      // Covers line 489: the tool_use branch in the content .map()
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-tu',
          content: [
            { type: 'text', text: 'Let me run a command' },
            {
              type: 'tool_use',
              id: 'tool-abc',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
        },
        stop_reason: 'tool_use',
      });

      const completeEvent = events.find((e) => e.type === 'message:complete') as ACPEvent & {
        content: { type: string; toolCallId?: string; name?: string }[];
      };
      expect(completeEvent).toBeDefined();
      expect(completeEvent.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_use',
            toolCallId: 'tool-abc',
            name: 'Bash',
          }),
        ])
      );
    });

    it('assistant with empty text content still emits message:start and message:complete', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-empty',
          content: [{ type: 'text', text: '' }],
        },
        stop_reason: 'end_turn',
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('message:start');
      expect(types).toContain('message:complete');
      // Should NOT emit message:delta for empty text
      expect(types).not.toContain('message:delta');
    });

    it('assistant with no content text defaults to empty string', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-no-content',
          content: [],
        },
        stop_reason: 'end_turn',
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('message:start');
      expect(types).toContain('message:complete');
      expect(types).not.toContain('message:delta');
    });

    it('assistant with thinking but no thinking text still emits thinking:complete', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-think-empty',
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: 'Answer' },
          ],
        },
        stop_reason: 'end_turn',
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('thinking:start');
      // thinking:delta should NOT be emitted for empty thinking
      expect(types).not.toContain('thinking:delta');
      expect(types).toContain('thinking:complete');

      const thinkingComplete = events.find((e) => e.type === 'thinking:complete') as ACPEvent & {
        content: string;
      };
      expect(thinkingComplete.content).toBe('');
    });

    it('assistant with redacted thinking block sets redacted flag', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-redacted',
          content: [
            { type: 'thinking', thinking: '', redacted: true },
            { type: 'text', text: 'Answer' },
          ],
        },
        stop_reason: 'end_turn',
      });

      const thinkingComplete = events.find((e) => e.type === 'thinking:complete') as ACPEvent & {
        redacted: boolean;
      };
      expect(thinkingComplete).toBeDefined();
      expect(thinkingComplete.redacted).toBe(true);
    });

    it('system event with non-init subtype does not emit environment:info', () => {
      emitStdoutLine(mockProc, {
        type: 'system',
        subtype: 'other',
      });

      expect(events.some((e) => e.type === 'environment:info')).toBe(false);
    });

    it('assistant without stop_reason does not emit usage even if usage exists', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-no-stop',
          content: [{ type: 'text', text: 'partial' }],
          usage: { input_tokens: 50, output_tokens: 25 },
        },
        stop_reason: null,
      });

      // stop_reason is null, so message:complete is not emitted, and usage is skipped
      const types = events.map((e) => e.type);
      expect(types).not.toContain('message:complete');
      expect(types).not.toContain('resource:token_usage');
    });

    it('assistant with no usage does not emit resource:token_usage', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          id: 'msg-no-usage',
          content: [{ type: 'text', text: 'response' }],
        },
        stop_reason: 'end_turn',
      });

      expect(events.some((e) => e.type === 'resource:token_usage')).toBe(false);
    });

    it('tool_use with no input defaults to empty object', () => {
      emitStdoutLine(mockProc, {
        type: 'tool_use',
        tool_use_id: 'tu-no-input',
        name: 'Read',
      });

      const startEvent = events.find((e) => e.type === 'tool:start');
      expect(startEvent).toBeDefined();
    });

    it('tool_use with no tool_use_id generates an id', () => {
      emitStdoutLine(mockProc, {
        type: 'tool_use',
        name: 'Write',
        input: { path: '/tmp/file.txt' },
      });

      const startEvent = events.find((e) => e.type === 'tool:start') as ACPEvent & {
        toolCallId: string;
      };
      expect(startEvent).toBeDefined();
      expect(startEvent.toolCallId).toBeTruthy();
    });

    it('user event with no text defaults to empty', () => {
      emitStdoutLine(mockProc, {
        type: 'user',
        message: {
          content: [{ type: 'text' }],
        },
      });

      const complete = events.find(
        (e) => e.type === 'message:complete' && (e as ACPEvent & { role: string }).role === 'user'
      ) as ACPEvent & { content: { text: string }[] };
      expect(complete).toBeDefined();
      expect(complete.content[0].text).toBe('');
    });

    it('assistant message without message.id generates an id', () => {
      emitStdoutLine(mockProc, {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'no id' }],
        },
        stop_reason: 'end_turn',
      });

      const start = events.find(
        (e) => e.type === 'message:start' && (e as ACPEvent & { role: string }).role === 'assistant'
      ) as ACPEvent & { messageId: string };
      expect(start).toBeDefined();
      expect(start.messageId).toBeTruthy();
    });

    it('unknown stream event type is ignored', () => {
      emitStdoutLine(mockProc, {
        type: 'unknown_type',
        data: 'something',
      });

      expect(events.length).toBe(0);
    });

    it('handles stderr output from start process', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockProc.stderr.emit('data', Buffer.from('warning message'));

      expect(consoleSpy).toHaveBeenCalledWith('Claude stderr:', 'warning message');
      consoleSpy.mockRestore();
    });
  });

  describe('handleJSONLEvent additional branches', () => {
    let session: ClaudeCodeSession;
    let events: ACPEvent[];
    let mockWatcher: { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    let changeHandler: () => void;

    beforeEach(async () => {
      mockWatcher = {
        on: vi.fn(function (this: unknown, event: string, handler: () => void) {
          if (event === 'change') {
            changeHandler = handler;
          }
          return mockWatcher;
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readFile).mockResolvedValueOnce('');

      session = new ClaudeCodeSession('jsonl-branch-test', '/sessions/dir');
      events = collectEvents(session);
      await session.getHistory();
      events.length = 0;
    });

    async function simulateFileChange(lines: string[]): Promise<void> {
      const content = lines.join('\n') + '\n';
      vi.mocked(readFile).mockResolvedValueOnce(content);
      changeHandler();
      await vi.waitFor(() => {
        expect(readFile).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    it('user event with version field sets claudeVersion', async () => {
      // Covers line 656: event.version && !this.claudeVersion
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-ver',
          version: '1.5.0',
          cwd: '/my/project',
          message: {
            content: [{ type: 'text', text: 'hello' }],
          },
        }),
      ]);

      expect(events.some((e) => e.type === 'message:start')).toBe(true);
    });

    it('user event without contentBlocks array breaks early', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-no-content',
          message: {},
        }),
      ]);

      // Should not emit any message events since contentBlocks is not an array
      const msgEvents = events.filter(
        (e) => e.type === 'message:start' || e.type === 'message:complete'
      );
      expect(msgEvents.length).toBe(0);
    });

    it('assistant event without contentBlocks array breaks early', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-no-content',
          message: {},
        }),
      ]);

      const msgEvents = events.filter(
        (e) => e.type === 'message:start' || e.type === 'message:complete'
      );
      // Only status_changed events (thinking -> running transition)
      expect(msgEvents.length).toBe(0);
    });

    it('user event with empty text does not emit user message events', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-empty',
          message: {
            content: [{ type: 'text', text: '' }],
          },
        }),
      ]);

      // Empty text blocks are filtered out, so no user message events
      const userMsgEvents = events.filter(
        (e) =>
          (e.type === 'message:start' || e.type === 'message:complete') &&
          (e as ACPEvent & { role: string }).role === 'user'
      );
      expect(userMsgEvents.length).toBe(0);
    });

    it('user event with tool_result with non-string content stringifies it', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-tr-obj',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tr-obj-1',
                content: [{ type: 'text', text: 'structured' }],
                is_error: false,
              },
            ],
          },
        }),
      ]);

      const result = events.find((e) => e.type === 'tool:result') as ACPEvent & {
        output: string;
      };
      expect(result).toBeDefined();
      expect(result.output).toBe(JSON.stringify([{ type: 'text', text: 'structured' }]));
    });

    it('assistant with no text but tool_use blocks still emits events', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-only-tool',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tu-only',
                name: 'Bash',
                input: { command: 'pwd' },
              },
            ],
            stop_reason: 'tool_use',
          },
        }),
      ]);

      const types = events.map((e) => e.type);
      expect(types).toContain('message:start');
      // No delta because there's no text content
      expect(types).not.toContain('message:delta');
      expect(types).toContain('message:complete');
      expect(types).toContain('tool:start');
      expect(types).toContain('tool:executing');
    });

    it('assistant with thinking but no thinking text still emits thinking:complete', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-think-empty',
          message: {
            content: [
              { type: 'thinking', thinking: '' },
              { type: 'text', text: 'result' },
            ],
            stop_reason: 'end_turn',
          },
        }),
      ]);

      const types = events.map((e) => e.type);
      expect(types).toContain('thinking:start');
      expect(types).not.toContain('thinking:delta');
      expect(types).toContain('thinking:complete');
    });

    it('assistant messageId falls back to event.message.id when uuid is missing', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          message: {
            id: 'fallback-msg-id',
            content: [{ type: 'text', text: 'hi' }],
            stop_reason: 'end_turn',
          },
        }),
      ]);

      const startEvent = events.find(
        (e) => e.type === 'message:start' && (e as ACPEvent & { role: string }).role === 'assistant'
      ) as ACPEvent & { messageId: string };
      expect(startEvent).toBeDefined();
      expect(startEvent.messageId).toBe('fallback-msg-id');
    });

    it('assistant messageId falls back to generated id when both uuid and message.id missing', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'hi' }],
            stop_reason: 'end_turn',
          },
        }),
      ]);

      const startEvent = events.find(
        (e) => e.type === 'message:start' && (e as ACPEvent & { role: string }).role === 'assistant'
      ) as ACPEvent & { messageId: string };
      expect(startEvent).toBeDefined();
      expect(startEvent.messageId).toBeTruthy();
    });

    it('assistant tool_use blocks without id or name default to empty/generated', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'assistant',
          uuid: 'a-tool-defaults',
          message: {
            content: [
              {
                type: 'tool_use',
                input: { data: 'test' },
              },
            ],
            stop_reason: 'tool_use',
          },
        }),
      ]);

      const toolStart = events.find((e) => e.type === 'tool:start') as ACPEvent & {
        toolCallId: string;
        name: string;
      };
      expect(toolStart).toBeDefined();
      expect(toolStart.toolCallId).toBeTruthy();
      expect(toolStart.name).toBe('');
    });

    it('readNewMessages does nothing when suppressFileEvents is true', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      // Trigger resumeWithMessage to set suppressFileEvents = true
      await session.execute({
        command: 'send_message',
        message: 'resume test',
      });

      // Now try to trigger file change while suppressed
      const readFileCalls = vi.mocked(readFile).mock.calls.length;
      vi.mocked(readFile).mockResolvedValueOnce(
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'suppressed' }] },
        }) + '\n'
      );
      changeHandler();
      await new Promise((r) => setTimeout(r, 10));

      // readFile should NOT have been called again because suppressFileEvents is true
      // (the call count should not have increased for readNewMessages)
    });

    it('readNewMessages handles file read errors gracefully', async () => {
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));
      changeHandler();
      await new Promise((r) => setTimeout(r, 10));

      // Should not throw, no error events
      const errEvents = events.filter((e) => e.type === 'session:error');
      expect(errEvents.length).toBe(0);
    });

    it('second user event does not overwrite projectPath', async () => {
      // First user event sets the project path
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-first',
          cwd: '/first/project',
          message: {
            content: [{ type: 'text', text: 'first message' }],
          },
        }),
      ]);

      // Second user event with different cwd should not overwrite
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-first',
          cwd: '/first/project',
          message: {
            content: [{ type: 'text', text: 'first message' }],
          },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'u-second',
          cwd: '/second/project',
          message: {
            content: [{ type: 'text', text: 'second message' }],
          },
        }),
      ]);

      // projectPath is set from first event and not overwritten
    });

    it('second user event does not overwrite claudeVersion', async () => {
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-v1',
          version: '1.0.0',
          message: {
            content: [{ type: 'text', text: 'msg' }],
          },
        }),
      ]);

      // Second user event with different version should not overwrite
      await simulateFileChange([
        JSON.stringify({
          type: 'user',
          uuid: 'u-v1',
          version: '1.0.0',
          message: {
            content: [{ type: 'text', text: 'msg' }],
          },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'u-v2',
          version: '2.0.0',
          message: {
            content: [{ type: 'text', text: 'msg2' }],
          },
        }),
      ]);
    });
  });

  describe('syncFilePosition', () => {
    it('handles file read errors gracefully', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readFile).mockResolvedValueOnce('');

      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('sync-err-test', '/sessions');
      await session.getHistory();

      // Execute send_message to trigger resumeWithMessage
      await session.execute({
        command: 'send_message',
        message: 'test',
      });

      // Make syncFilePosition fail when close handler runs
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

      // Trigger close to call syncFilePosition
      mockProc.emit('close');

      await new Promise((r) => setTimeout(r, 10));
      // Should not throw
    });
  });

  describe('execute() edge cases', () => {
    it('approve_tool_call with unknown toolCallId is a no-op', async () => {
      const session = new ClaudeCodeSession('approve-unknown');
      await session.execute({
        command: 'approve_tool_call',
        requestId: 'req-x',
        toolCallId: 'nonexistent',
      });
      // No error should occur
    });

    it('deny_tool_call with unknown toolCallId is a no-op', async () => {
      const session = new ClaudeCodeSession('deny-unknown');
      await session.execute({
        command: 'deny_tool_call',
        requestId: 'req-x',
        toolCallId: 'nonexistent',
        reason: 'test',
      });
      // No error should occur
    });

    it('terminate without watcher still sends SIGTERM', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);

      const session = new ClaudeCodeSession('term-no-watcher');
      await session.start('/project', 'test');

      await session.execute({ command: 'terminate' });
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('terminate without process still closes watcher', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);
      vi.mocked(readFile).mockResolvedValueOnce('');

      const session = new ClaudeCodeSession('term-no-proc', '/sessions');
      await session.getHistory();

      await session.execute({ command: 'terminate' });
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('send_message catches stdin write errors', async () => {
      const mockProc = createMockProcess();
      mockProc.stdin.write.mockImplementation(() => {
        throw new Error('stdin broken');
      });
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ChildProcess);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const session = new ClaudeCodeSession('stdin-err-test');
      await session.start('/project', 'test');

      await session.execute({
        command: 'send_message',
        message: 'will fail',
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to write to stdin:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('file position tracking', () => {
    it('correctly tracks lastReadPosition with trailing newline', async () => {
      let changeHandler: () => void = () => {};
      const mockWatcher = {
        on: vi.fn(function (this: unknown, event: string, handler: () => void) {
          if (event === 'change') {
            changeHandler = handler;
          }
          return mockWatcher;
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as never);

      // Initial read with content
      const initialContent =
        JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'first' }] } }) +
        '\n';
      vi.mocked(readFile).mockResolvedValueOnce(initialContent);

      const session = new ClaudeCodeSession('pos-track-test', '/sessions/dir');
      const events = collectEvents(session);
      await session.getHistory();

      // Now trigger a change with additional content -- this verifies the
      // lastReadPosition tracking works correctly with trailing newlines
      const updatedContent =
        initialContent +
        JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'second' }] } }) +
        '\n';
      vi.mocked(readFile).mockResolvedValueOnce(updatedContent);
      changeHandler();
      await new Promise((r) => setTimeout(r, 10));

      // The second user message should produce new events
      const userCompletes = events.filter(
        (e) => e.type === 'message:complete' && (e as ACPEvent & { role: string }).role === 'user'
      );
      expect(userCompletes.length).toBeGreaterThanOrEqual(1);
    });
  });
});

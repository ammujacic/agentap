import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { FSWatcher } from 'chokidar';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

const mockWatcherInstance = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
} as unknown as FSWatcher;

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcherInstance),
}));

const mockSessionStart = vi.fn();
vi.mock('../session', () => {
  const MockClaudeCodeSession = vi.fn().mockImplementation(function (
    this: { sessionId: string; start: typeof mockSessionStart },
    id?: string
  ) {
    this.sessionId = id ?? 'new-session-id';
    this.start = mockSessionStart;
  });
  return { ClaudeCodeSession: MockClaudeCodeSession };
});

// ── Imports (after mocks) ──────────────────────────────────────────

import { ClaudeCodeAdapter } from '../adapter';
import { ACP_VERSION } from '@agentap-dev/acp';
import { execSync } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import { watch } from 'chokidar';
import { ClaudeCodeSession } from '../session';

// ── Helpers ────────────────────────────────────────────────────────

function makeStat(
  overrides: Partial<{
    isFile: boolean;
    isDirectory: boolean;
    birthtime: Date;
    mtime: Date;
  }> = {}
) {
  return {
    isFile: () => overrides.isFile ?? true,
    isDirectory: () => overrides.isDirectory ?? false,
    birthtime: overrides.birthtime ?? new Date('2025-01-01T00:00:00Z'),
    mtime: overrides.mtime ?? new Date('2025-01-02T00:00:00Z'),
  };
}

/** Build a JSONL file from an array of objects, one JSON per line */
function buildJSONL(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the watcher's .on mock so handler captures are fresh
    (mockWatcherInstance.on as Mock).mockReset().mockReturnThis();
    adapter = new ClaudeCodeAdapter();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Static properties
  // ────────────────────────────────────────────────────────────────

  describe('static properties', () => {
    it('has name "claude-code"', () => {
      expect(adapter.name).toBe('claude-code');
    });

    it('has displayName "Claude Code"', () => {
      expect(adapter.displayName).toBe('Claude Code');
    });

    it('has icon emoji', () => {
      expect(adapter.icon).toBe('🟠');
    });

    it('has integrationMethod "sdk"', () => {
      expect(adapter.integrationMethod).toBe('sdk');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 2. getCapabilities()
  // ────────────────────────────────────────────────────────────────

  describe('getCapabilities()', () => {
    it('returns correct protocolVersion', () => {
      const caps = adapter.getCapabilities();
      expect(caps.protocolVersion).toBe(ACP_VERSION);
    });

    it('returns agent info with name, displayName, icon, and integrationMethod', () => {
      const { agent } = adapter.getCapabilities();
      expect(agent.name).toBe('claude-code');
      expect(agent.displayName).toBe('Claude Code');
      expect(agent.icon).toBe('🟠');
      expect(agent.version).toBeNull();
      expect(agent.integrationMethod).toBe('sdk');
    });

    it('returns correct streaming feature flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.streaming.messages).toBe(true);
      expect(features.streaming.toolArgs).toBe(false);
      expect(features.streaming.thinking).toBe(true);
    });

    it('returns correct approval feature flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.approval.toolCalls).toBe(true);
      expect(features.approval.preview).toBe(true);
    });

    it('returns correct sessionControl feature flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.sessionControl.pause).toBe(false);
      expect(features.sessionControl.resume).toBe(true);
      expect(features.sessionControl.cancel).toBe(true);
    });

    it('returns correct planning, subAgents, and miscellaneous flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.subAgents).toBe(true);
      expect(features.planning.todos).toBe(true);
      expect(features.planning.planMode).toBe(true);
      expect(features.git).toBe(true);
      expect(features.webSearch).toBe(true);
      expect(features.multimodal).toBe(true);
      expect(features.thinking).toBe(true);
      expect(features.customEvents).toEqual([]);
    });

    it('returns correct resource feature flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.resources.tokenUsage).toBe(true);
      expect(features.resources.costTracking).toBe(false);
      expect(features.resources.contextWindow).toBe(false);
    });

    it('returns correct fileOperations and userInteraction flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.fileOperations.diffs).toBe(true);
      expect(features.fileOperations.batchedChanges).toBe(false);
      expect(features.userInteraction.questions).toBe(true);
      expect(features.userInteraction.notifications).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 3. getDataPaths()
  // ────────────────────────────────────────────────────────────────

  describe('getDataPaths()', () => {
    it('returns sessions path under ~/.claude/projects', () => {
      const paths = adapter.getDataPaths();
      expect(paths.sessions).toBe('/mock/home/.claude/projects');
    });

    it('returns config path as ~/.claude/settings.json', () => {
      const paths = adapter.getDataPaths();
      expect(paths.config).toBe('/mock/home/.claude/settings.json');
    });

    it('returns logs path as ~/.claude/logs', () => {
      const paths = adapter.getDataPaths();
      expect(paths.logs).toBe('/mock/home/.claude/logs');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 4. isInstalled()
  // ────────────────────────────────────────────────────────────────

  describe('isInstalled()', () => {
    it('returns true when "which claude" succeeds', async () => {
      (execSync as Mock).mockReturnValue('/usr/local/bin/claude');
      const result = await adapter.isInstalled();
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which claude', { stdio: 'ignore' });
    });

    it('returns false when "which claude" throws', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('not found');
      });
      const result = await adapter.isInstalled();
      expect(result).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 5. getVersion()
  // ────────────────────────────────────────────────────────────────

  describe('getVersion()', () => {
    it('returns trimmed version string on success', async () => {
      (execSync as Mock).mockReturnValue('  1.2.3\n');
      const version = await adapter.getVersion();
      expect(version).toBe('1.2.3');
      expect(execSync).toHaveBeenCalledWith('claude --version', {
        encoding: 'utf-8',
      });
    });

    it('returns null on failure', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('command not found');
      });
      const version = await adapter.getVersion();
      expect(version).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 6. discoverSessions()
  // ────────────────────────────────────────────────────────────────

  describe('discoverSessions()', () => {
    it('returns empty array when projects dir does not exist', async () => {
      (readdir as Mock).mockRejectedValue(new Error('ENOENT'));
      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('returns empty array when no .jsonl files found', async () => {
      (readdir as Mock)
        .mockResolvedValueOnce(['-Users-me-project']) // projectHashes
        .mockResolvedValueOnce(['subdir', 'notes.txt']); // entries (no .jsonl)
      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('parses session from .jsonl file with cwd from user message', async () => {
      const sessionId = 'abc-123';
      const fileContent = buildJSONL([
        { type: 'queue-operation', data: {} },
        {
          type: 'user',
          cwd: '/home/dev/myproject',
          message: {
            content: [{ type: 'text', text: 'Hello, build my app' }],
          },
        },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Sure, I will build it.' }],
          },
        },
      ]);

      (readdir as Mock)
        .mockResolvedValueOnce(['-Users-me-project'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`, 'other-dir']);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(sessionId);
      expect(sessions[0].agent).toBe('claude-code');
      expect(sessions[0].projectPath).toBe('/home/dev/myproject');
      expect(sessions[0].projectName).toBe('myproject');
      expect(sessions[0].sessionName).toBe('Hello, build my app');
      expect(sessions[0].lastMessage).toBe('Sure, I will build it.');
    });

    it('falls back to deriving cwd from hash directory name', async () => {
      const sessionId = 'def-456';
      // No cwd field in any line
      const fileContent = buildJSONL([
        { type: 'queue-operation', data: {} },
        {
          type: 'user',
          message: {
            content: [{ type: 'text', text: 'Fix the bug' }],
          },
        },
      ]);

      (readdir as Mock)
        .mockResolvedValueOnce(['-Users-me-project'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);

      // First stat call: the .jsonl file itself
      (stat as Mock)
        .mockResolvedValueOnce(makeStat()) // file stat
        .mockResolvedValueOnce(makeStat({ isDirectory: true })); // candidate path stat

      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].projectPath).toBe('/Users/me/project');
    });

    it('extracts session name from first user message, stripping system tags', async () => {
      const sessionId = 'ghi-789';
      const fileContent = buildJSONL([
        {
          type: 'user',
          cwd: '/tmp/proj',
          message: {
            content: [
              {
                type: 'text',
                text: '<system-reminder>Be careful</system-reminder>Fix the login page',
              },
            ],
          },
        },
      ]);

      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBe('Fix the login page');
    });

    it('truncates session name to 100 chars + ellipsis', async () => {
      const sessionId = 'trunc-001';
      const longText = 'A'.repeat(150);
      const fileContent = buildJSONL([
        {
          type: 'user',
          cwd: '/tmp/proj',
          message: { content: [{ type: 'text', text: longText }] },
        },
      ]);

      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBe('A'.repeat(100) + '...');
    });

    it('extracts last assistant message from tail of file', async () => {
      const sessionId = 'tail-001';
      const lines: unknown[] = [
        {
          type: 'user',
          cwd: '/tmp/proj',
          message: { content: [{ type: 'text', text: 'Hello' }] },
        },
      ];
      // Add many filler lines
      for (let i = 0; i < 40; i++) {
        lines.push({ type: 'queue-operation', data: {} });
      }
      // The last assistant message in the tail
      lines.push({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Here is the final answer.' }],
        },
      });

      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(buildJSONL(lines));

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].lastMessage).toBe('Here is the final answer.');
    });

    it('truncates last assistant message to 200 chars + ellipsis', async () => {
      const sessionId = 'tailtrunc-001';
      const longMessage = 'B'.repeat(250);
      const fileContent = buildJSONL([
        {
          type: 'user',
          cwd: '/tmp/proj',
          message: { content: [{ type: 'text', text: 'hi' }] },
        },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: longMessage }] },
        },
      ]);

      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].lastMessage).toBe('B'.repeat(200) + '...');
    });

    it('skips non-.jsonl files', async () => {
      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce(['abc.jsonl', 'readme.md', 'data.json']);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(
        buildJSONL([
          {
            type: 'user',
            cwd: '/tmp',
            message: { content: [{ type: 'text', text: 'hi' }] },
          },
        ])
      );

      const sessions = await adapter.discoverSessions();
      // Only the .jsonl file should produce a session
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('abc');
    });

    it('skips files that cannot be read (ENOENT on stat)', async () => {
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';

      (readdir as Mock).mockResolvedValueOnce(['hash1']).mockResolvedValueOnce(['gone.jsonl']);
      (stat as Mock).mockRejectedValue(enoent);

      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('skips files that cannot be read (ENOENT on readFile)', async () => {
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';

      (readdir as Mock).mockResolvedValueOnce(['hash1']).mockResolvedValueOnce(['gone.jsonl']);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockRejectedValue(enoent);

      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('re-throws non-ENOENT errors from stat (caught by outer try)', async () => {
      const permError = new Error('EACCES') as NodeJS.ErrnoException;
      permError.code = 'EACCES';

      (readdir as Mock).mockResolvedValueOnce(['hash1']).mockResolvedValueOnce(['bad.jsonl']);
      (stat as Mock).mockRejectedValue(permError);

      // The throw at line 127 is caught by the outer try/catch at line 276,
      // so the session is skipped rather than crashing.
      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('re-throws non-ENOENT errors from readFile (caught by outer try)', async () => {
      const permError = new Error('EACCES') as NodeJS.ErrnoException;
      permError.code = 'EACCES';

      (readdir as Mock).mockResolvedValueOnce(['hash1']).mockResolvedValueOnce(['bad.jsonl']);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockRejectedValue(permError);

      // The throw at line 138 is caught by the outer try/catch at line 276,
      // so the session is skipped rather than crashing.
      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('skips malformed JSON lines without crashing', async () => {
      const sessionId = 'bad-json';
      const content =
        'NOT VALID JSON\n' +
        JSON.stringify({
          type: 'user',
          cwd: '/tmp/ok',
          message: { content: [{ type: 'text', text: 'valid line' }] },
        }) +
        '\n';

      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(content);

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].projectPath).toBe('/tmp/ok');
      expect(sessions[0].sessionName).toBe('valid line');
    });

    it('sorts sessions by lastActivity descending', async () => {
      const older = makeStat({
        mtime: new Date('2025-01-01T00:00:00Z'),
        birthtime: new Date('2024-12-01T00:00:00Z'),
      });
      const newer = makeStat({
        mtime: new Date('2025-06-01T00:00:00Z'),
        birthtime: new Date('2025-05-01T00:00:00Z'),
      });

      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce(['old.jsonl', 'new.jsonl']);

      // stat is called for old.jsonl then new.jsonl
      (stat as Mock).mockResolvedValueOnce(older).mockResolvedValueOnce(newer);

      const fileContent = buildJSONL([
        {
          type: 'user',
          cwd: '/tmp',
          message: { content: [{ type: 'text', text: 'hi' }] },
        },
      ]);
      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(2);
      // Newer should come first
      expect(sessions[0].id).toBe('new');
      expect(sessions[1].id).toBe('old');
    });

    it('sets projectPath to "Unknown" when cwd cannot be determined', async () => {
      const sessionId = 'no-cwd';
      // No cwd field, and the hash-based fallback will fail
      const fileContent = buildJSONL([
        { type: 'queue-operation', data: {} },
        {
          type: 'user',
          message: { content: [{ type: 'text', text: 'hello' }] },
        },
      ]);

      (readdir as Mock)
        .mockResolvedValueOnce(['somehash'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);
      (stat as Mock)
        .mockResolvedValueOnce(makeStat()) // file stat
        .mockRejectedValueOnce(new Error('ENOENT')); // candidate dir does not exist
      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].projectPath).toBe('Unknown');
      expect(sessions[0].projectName).toBe('Unknown');
    });

    it('skips user messages containing only system tags for sessionName', async () => {
      const sessionId = 'tags-only';
      const fileContent = buildJSONL([
        {
          type: 'user',
          cwd: '/tmp/proj',
          message: {
            content: [{ type: 'text', text: '<system-reminder>Only tags here</system-reminder>' }],
          },
        },
        {
          type: 'user',
          message: {
            content: [{ type: 'text', text: 'Actual user question' }],
          },
        },
      ]);

      (readdir as Mock)
        .mockResolvedValueOnce(['hash1'])
        .mockResolvedValueOnce([`${sessionId}.jsonl`]);
      (stat as Mock).mockResolvedValue(makeStat());
      (readFile as Mock).mockResolvedValue(fileContent);

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBe('Actual user question');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 7. watchSessions()
  // ────────────────────────────────────────────────────────────────

  describe('watchSessions()', () => {
    it('creates chokidar watcher on projects dir with depth:2', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      expect(watch).toHaveBeenCalledWith('/mock/home/.claude/projects', {
        ignoreInitial: true,
        persistent: true,
        depth: 2,
      });
    });

    it('calls callback with session_created on "add" for .jsonl files', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      // Capture the 'add' handler
      const addHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'add'
      )?.[1];
      expect(addHandler).toBeDefined();

      addHandler('/mock/home/.claude/projects/hash1/session-abc.jsonl');

      expect(callback).toHaveBeenCalledWith({
        type: 'session_created',
        sessionId: 'session-abc',
        agent: 'claude-code',
      });
    });

    it('calls callback with session_removed on "unlink" for .jsonl files', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const unlinkHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'unlink'
      )?.[1];
      expect(unlinkHandler).toBeDefined();

      unlinkHandler('/mock/home/.claude/projects/hash1/session-abc.jsonl');

      expect(callback).toHaveBeenCalledWith({
        type: 'session_removed',
        sessionId: 'session-abc',
        agent: 'claude-code',
      });
    });

    it('calls callback with session_updated on "change" for .jsonl files', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const changeHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'change'
      )?.[1];
      expect(changeHandler).toBeDefined();

      changeHandler('/mock/home/.claude/projects/hash1/session-abc.jsonl');

      expect(callback).toHaveBeenCalledWith({
        type: 'session_updated',
        sessionId: 'session-abc',
        agent: 'claude-code',
      });
    });

    it('ignores non-.jsonl files on add', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const addHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'add'
      )?.[1];

      addHandler('/mock/home/.claude/projects/hash1/somedir');
      addHandler('/mock/home/.claude/projects/hash1/notes.txt');

      expect(callback).not.toHaveBeenCalled();
    });

    it('ignores non-.jsonl files on unlink', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const unlinkHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'unlink'
      )?.[1];

      unlinkHandler('/mock/home/.claude/projects/hash1/readme.md');

      expect(callback).not.toHaveBeenCalled();
    });

    it('ignores non-.jsonl files on change', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const changeHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'change'
      )?.[1];

      changeHandler('/mock/home/.claude/projects/hash1/config.json');

      expect(callback).not.toHaveBeenCalled();
    });

    it('returns cleanup function that closes the watcher', () => {
      const callback = vi.fn();
      const cleanup = adapter.watchSessions(callback);

      expect(typeof cleanup).toBe('function');
      cleanup();

      expect(mockWatcherInstance.close).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 8. attachToSession()
  // ────────────────────────────────────────────────────────────────

  describe('attachToSession()', () => {
    it('finds session file and creates ClaudeCodeSession', async () => {
      (readdir as Mock).mockResolvedValue(['hash1', 'hash2']);
      // First project dir: stat throws (not found here)
      // Second project dir: stat resolves (found)
      (stat as Mock).mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(makeStat());

      const session = await adapter.attachToSession('my-session');

      expect(ClaudeCodeSession).toHaveBeenCalledWith(
        'my-session',
        '/mock/home/.claude/projects/hash2',
        expect.objectContaining({ protocolVersion: ACP_VERSION })
      );
      expect(session.sessionId).toBe('my-session');
    });

    it('throws when session not found in any project dir', async () => {
      (readdir as Mock).mockResolvedValue(['hash1', 'hash2']);
      (stat as Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(adapter.attachToSession('missing-session')).rejects.toThrow(
        'Session missing-session not found'
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 9. startSession()
  // ────────────────────────────────────────────────────────────────

  describe('startSession()', () => {
    it('creates ClaudeCodeSession and calls start()', async () => {
      const session = await adapter.startSession({
        projectPath: '/home/dev/myproject',
        prompt: 'Build a todo app',
        model: 'claude-opus-4-6',
      });

      expect(ClaudeCodeSession).toHaveBeenCalledWith(
        undefined,
        undefined,
        expect.objectContaining({ protocolVersion: ACP_VERSION })
      );
      expect(mockSessionStart).toHaveBeenCalledWith(
        '/home/dev/myproject',
        'Build a todo app',
        'claude-opus-4-6'
      );
      expect(session).toBeDefined();
    });

    it('creates session without model when not specified', async () => {
      await adapter.startSession({
        projectPath: '/tmp/proj',
        prompt: 'Hello',
      });

      expect(mockSessionStart).toHaveBeenCalledWith('/tmp/proj', 'Hello', undefined);
    });
  });
});

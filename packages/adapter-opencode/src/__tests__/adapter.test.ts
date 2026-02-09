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
  const MockOpenCodeSession = vi.fn().mockImplementation(function (
    this: { sessionId: string; start: typeof mockSessionStart },
    id?: string
  ) {
    this.sessionId = id ?? 'new-session-id';
    this.start = mockSessionStart;
  });
  return { OpenCodeSession: MockOpenCodeSession };
});

vi.mock('../server-discovery', () => ({
  discoverServer: vi.fn().mockResolvedValue(null),
}));

// ── Imports (after mocks) ──────────────────────────────────────────

import { OpenCodeAdapter } from '../adapter';
import { ACP_VERSION } from '@agentap-dev/acp';
import { execSync } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { watch } from 'chokidar';
import { OpenCodeSession } from '../session';
import { discoverServer } from '../server-discovery';

// ── Tests ──────────────────────────────────────────────────────────

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockWatcherInstance.on as Mock).mockReset().mockReturnThis();
    adapter = new OpenCodeAdapter();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Static properties
  // ────────────────────────────────────────────────────────────────

  describe('static properties', () => {
    it('has name "opencode"', () => {
      expect(adapter.name).toBe('opencode');
    });

    it('has displayName "OpenCode"', () => {
      expect(adapter.displayName).toBe('OpenCode');
    });

    it('has icon', () => {
      expect(adapter.icon).toBeTruthy();
    });

    it('has integrationMethod "file-watch"', () => {
      expect(adapter.integrationMethod).toBe('file-watch');
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
      expect(agent.name).toBe('opencode');
      expect(agent.displayName).toBe('OpenCode');
      expect(agent.version).toBeNull();
      expect(agent.integrationMethod).toBe('file-watch');
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
      expect(features.approval.preview).toBe(false);
    });

    it('returns correct sessionControl feature flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.sessionControl.pause).toBe(false);
      expect(features.sessionControl.resume).toBe(false);
      expect(features.sessionControl.cancel).toBe(true);
    });

    it('returns correct planning, subAgents, and miscellaneous flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.subAgents).toBe(false);
      expect(features.planning.todos).toBe(false);
      expect(features.planning.planMode).toBe(false);
      expect(features.git).toBe(false);
      expect(features.webSearch).toBe(false);
      expect(features.multimodal).toBe(true);
      expect(features.thinking).toBe(true);
      expect(features.customEvents).toEqual([]);
    });

    it('returns correct resource feature flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.resources.tokenUsage).toBe(true);
      expect(features.resources.costTracking).toBe(true);
      expect(features.resources.contextWindow).toBe(false);
    });

    it('returns correct fileOperations and userInteraction flags', () => {
      const { features } = adapter.getCapabilities();
      expect(features.fileOperations.diffs).toBe(true);
      expect(features.fileOperations.batchedChanges).toBe(false);
      expect(features.userInteraction.questions).toBe(false);
      expect(features.userInteraction.notifications).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 3. getDataPaths()
  // ────────────────────────────────────────────────────────────────

  describe('getDataPaths()', () => {
    it('returns sessions path under ~/.local/share/opencode/storage/session', () => {
      const paths = adapter.getDataPaths();
      expect(paths.sessions).toBe('/mock/home/.local/share/opencode/storage/session');
    });

    it('returns config path as ~/.local/share/opencode', () => {
      const paths = adapter.getDataPaths();
      expect(paths.config).toBe('/mock/home/.local/share/opencode');
    });

    it('returns logs path as ~/.local/share/opencode/log', () => {
      const paths = adapter.getDataPaths();
      expect(paths.logs).toBe('/mock/home/.local/share/opencode/log');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 4. isInstalled()
  // ────────────────────────────────────────────────────────────────

  describe('isInstalled()', () => {
    it('returns true when "which opencode" succeeds', async () => {
      (execSync as Mock).mockReturnValue('/usr/local/bin/opencode');
      const result = await adapter.isInstalled();
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which opencode', {
        stdio: 'ignore',
      });
    });

    it('returns false when "which opencode" throws', async () => {
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
      (execSync as Mock).mockReturnValue('  0.2.1\n');
      const version = await adapter.getVersion();
      expect(version).toBe('0.2.1');
      expect(execSync).toHaveBeenCalledWith('opencode version', {
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

    it('returns serverInfo version when server is discovered', async () => {
      // First, discover a server by attaching to a session
      const sessionFile = {
        id: 'sess-1',
        slug: 'sess-1',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Test',
        time: { created: Date.now(), updated: Date.now() },
      };
      (readdir as Mock).mockResolvedValue(['proj-1']);
      (readFile as Mock).mockResolvedValue(JSON.stringify(sessionFile));
      vi.mocked(discoverServer).mockResolvedValue({
        url: 'http://127.0.0.1:4096',
        version: '0.3.0',
      });

      await adapter.attachToSession('sess-1');

      // Now getVersion should return the server version
      const version = await adapter.getVersion();
      expect(version).toBe('0.3.0');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 6. discoverSessions()
  // ────────────────────────────────────────────────────────────────

  describe('discoverSessions()', () => {
    it('returns empty array when storage dir does not exist', async () => {
      (readdir as Mock).mockRejectedValue(new Error('ENOENT'));
      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('returns empty array when no .json files found', async () => {
      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1']) // projectIDs
        .mockResolvedValueOnce(['subdir', 'notes.txt']); // entries (no .json)
      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('parses session from .json file with directory field', async () => {
      const sessionFile = {
        id: 'sess-abc',
        slug: 'sess-abc',
        version: '1',
        projectID: 'proj-1',
        directory: '/home/dev/myproject',
        title: 'My Session',
        time: {
          created: Date.now() - 10000,
          updated: Date.now(),
        },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1']) // projectIDs
        .mockResolvedValueOnce(['sess-abc.json']) // session files
        .mockRejectedValueOnce(new Error('ENOENT')); // messageDir readdir fails

      (readFile as Mock).mockResolvedValue(JSON.stringify(sessionFile));

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('sess-abc');
      expect(sessions[0].agent).toBe('opencode');
      expect(sessions[0].projectPath).toBe('/home/dev/myproject');
      expect(sessions[0].projectName).toBe('myproject');
    });

    it('skips archived sessions', async () => {
      const sessionFile = {
        id: 'sess-archived',
        slug: 'sess-archived',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Archived',
        time: {
          created: Date.now() - 10000,
          updated: Date.now(),
          archived: Date.now(),
        },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-archived.json']);
      (readFile as Mock).mockResolvedValue(JSON.stringify(sessionFile));

      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('skips non-.json files', async () => {
      const sessionFile = {
        id: 'sess-1',
        slug: 'sess-1',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Test',
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-1.json', 'readme.md', 'data.txt'])
        .mockRejectedValueOnce(new Error('ENOENT')); // no messages

      (readFile as Mock).mockResolvedValue(JSON.stringify(sessionFile));

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('sess-1');
    });

    it('skips files that cannot be read', async () => {
      (readdir as Mock).mockResolvedValueOnce(['proj-1']).mockResolvedValueOnce(['bad.json']);
      (readFile as Mock).mockRejectedValue(new Error('EACCES'));

      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('skips unreadable project directories', async () => {
      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1', 'proj-2'])
        .mockRejectedValueOnce(new Error('EACCES')) // proj-1 fails
        .mockResolvedValueOnce([]); // proj-2 empty

      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('sorts sessions by lastActivity descending', async () => {
      const older = {
        id: 'sess-old',
        slug: 'old',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Old',
        time: {
          created: 1000,
          updated: 2000,
        },
      };
      const newer = {
        id: 'sess-new',
        slug: 'new',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'New',
        time: {
          created: 3000,
          updated: 5000,
        },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1']) // projectIDs
        .mockResolvedValueOnce(['sess-old.json', 'sess-new.json']) // files
        .mockRejectedValueOnce(new Error('ENOENT')) // messages for old
        .mockRejectedValueOnce(new Error('ENOENT')); // messages for new

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(older))
        .mockResolvedValueOnce(JSON.stringify(newer));

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('sess-new');
      expect(sessions[1].id).toBe('sess-old');
    });

    it('extracts sessionName from first user message text part', async () => {
      const sessionFile = {
        id: 'sess-name',
        slug: 'sess-name',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'sess-name', // same as slug, so will use user message
        time: { created: Date.now(), updated: Date.now() },
      };

      const userMsg = {
        id: 'msg-1',
        sessionID: 'sess-name',
        role: 'user',
        time: { created: Date.now() },
      };

      const textPart = {
        id: 'part-1',
        sessionID: 'sess-name',
        messageID: 'msg-1',
        type: 'text',
        text: 'Fix the login bug',
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1']) // projectIDs
        .mockResolvedValueOnce(['sess-name.json']) // session files
        .mockResolvedValueOnce(['msg-1.json']) // message files
        .mockResolvedValueOnce(['part-1.json']); // part files for first msg

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(userMsg))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionName).toBe('Fix the login bug');
    });

    it('truncates sessionName to 100 chars + ellipsis', async () => {
      const sessionFile = {
        id: 'sess-trunc',
        slug: 'sess-trunc',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'sess-trunc',
        time: { created: Date.now(), updated: Date.now() },
      };

      const userMsg = {
        id: 'msg-1',
        sessionID: 'sess-trunc',
        role: 'user',
        time: { created: Date.now() },
      };

      const longText = 'A'.repeat(150);
      const textPart = {
        id: 'part-1',
        sessionID: 'sess-trunc',
        messageID: 'msg-1',
        type: 'text',
        text: longText,
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-trunc.json'])
        .mockResolvedValueOnce(['msg-1.json'])
        .mockResolvedValueOnce(['part-1.json']);

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(userMsg))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBe('A'.repeat(100) + '...');
    });

    it('extracts lastMessage from last assistant message text part', async () => {
      const sessionFile = {
        id: 'sess-last',
        slug: 'sess-last',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Test Title',
        time: { created: Date.now(), updated: Date.now() },
      };

      const userMsg = {
        id: 'msg-u',
        sessionID: 'sess-last',
        role: 'user',
        time: { created: Date.now() },
      };
      const assistantMsg = {
        id: 'msg-a',
        sessionID: 'sess-last',
        role: 'assistant',
        time: { created: Date.now() },
      };

      const userTextPart = {
        id: 'part-u1',
        sessionID: 'sess-last',
        messageID: 'msg-u',
        type: 'text',
        text: 'User prompt',
      };
      const assistantTextPart = {
        id: 'part-a1',
        sessionID: 'sess-last',
        messageID: 'msg-a',
        type: 'text',
        text: 'Here is the assistant reply',
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1']) // projectIDs
        .mockResolvedValueOnce(['sess-last.json']) // session files
        .mockResolvedValueOnce(['msg-u.json', 'msg-a.json']) // message files
        .mockResolvedValueOnce(['part-u1.json']) // parts for user msg
        .mockResolvedValueOnce(['part-a1.json']); // parts for assistant msg

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(userMsg)) // first msg read (for sessionName)
        .mockResolvedValueOnce(JSON.stringify(userTextPart)) // first text part
        .mockResolvedValueOnce(JSON.stringify(assistantMsg)) // last msg scan (assistant)
        .mockResolvedValueOnce(JSON.stringify(assistantTextPart)); // assistant text part

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].lastMessage).toBe('Here is the assistant reply');
    });

    it('truncates lastMessage to 200 chars + ellipsis', async () => {
      const sessionFile = {
        id: 'sess-longmsg',
        slug: 'sess-longmsg',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Different Title',
        time: { created: Date.now(), updated: Date.now() },
      };

      const assistantMsg = {
        id: 'msg-a',
        sessionID: 'sess-longmsg',
        role: 'assistant',
        time: { created: Date.now() },
      };

      const longText = 'B'.repeat(250);
      const textPart = {
        id: 'part-a1',
        sessionID: 'sess-longmsg',
        messageID: 'msg-a',
        type: 'text',
        text: longText,
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-longmsg.json'])
        .mockResolvedValueOnce(['msg-a.json']) // only assistant msg
        .mockResolvedValueOnce(['part-a1.json']); // parts for assistant

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(assistantMsg)) // first msg (assistant, not user)
        .mockResolvedValueOnce(JSON.stringify(assistantMsg)) // last msg scan
        .mockResolvedValueOnce(JSON.stringify(textPart)); // text part

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].lastMessage).toBe('B'.repeat(200) + '...');
    });

    it('uses title as sessionName when title differs from slug', async () => {
      const sessionFile = {
        id: 'sess-title',
        slug: 'sess-title',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'My Custom Title',
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-title.json'])
        .mockRejectedValueOnce(new Error('ENOENT')); // no messages

      (readFile as Mock).mockResolvedValueOnce(JSON.stringify(sessionFile));

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBe('My Custom Title');
    });

    it('returns null sessionName when title equals slug and no user message', async () => {
      const sessionFile = {
        id: 'sess-nul',
        slug: 'same-slug',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'same-slug',
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-nul.json'])
        .mockRejectedValueOnce(new Error('ENOENT')); // no messages

      (readFile as Mock).mockResolvedValueOnce(JSON.stringify(sessionFile));

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBeNull();
    });

    it('handles empty message directory', async () => {
      const sessionFile = {
        id: 'sess-empty',
        slug: 'sess-empty',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'sess-empty', // same as slug -> sessionName should be null
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-empty.json'])
        .mockResolvedValueOnce([]); // empty message dir

      (readFile as Mock).mockResolvedValueOnce(JSON.stringify(sessionFile));

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].lastMessage).toBeNull();
      expect(sessions[0].sessionName).toBeNull();
    });

    it('handles malformed session JSON without crashing', async () => {
      (readdir as Mock).mockResolvedValueOnce(['proj-1']).mockResolvedValueOnce(['bad.json']);
      (readFile as Mock).mockResolvedValue('NOT VALID JSON');

      const sessions = await adapter.discoverSessions();
      expect(sessions).toEqual([]);
    });

    it('skips part files with empty text', async () => {
      const sessionFile = {
        id: 'sess-ep',
        slug: 'sess-ep',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'sess-ep',
        time: { created: Date.now(), updated: Date.now() },
      };

      const userMsg = {
        id: 'msg-u',
        sessionID: 'sess-ep',
        role: 'user',
        time: { created: Date.now() },
      };

      const emptyTextPart = {
        id: 'part-1',
        sessionID: 'sess-ep',
        messageID: 'msg-u',
        type: 'text',
        text: '   ', // whitespace only
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-ep.json'])
        .mockResolvedValueOnce(['msg-u.json'])
        .mockResolvedValueOnce(['part-1.json']); // parts for user msg

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(userMsg))
        .mockResolvedValueOnce(JSON.stringify(emptyTextPart));

      const sessions = await adapter.discoverSessions();
      // sessionName should be null because the only text part was empty
      expect(sessions[0].sessionName).toBeNull();
    });

    it('skips non-text parts when looking for text', async () => {
      const sessionFile = {
        id: 'sess-nt',
        slug: 'sess-nt',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'sess-nt',
        time: { created: Date.now(), updated: Date.now() },
      };

      const userMsg = {
        id: 'msg-u',
        sessionID: 'sess-nt',
        role: 'user',
        time: { created: Date.now() },
      };

      const reasoningPart = {
        id: 'part-1',
        sessionID: 'sess-nt',
        messageID: 'msg-u',
        type: 'reasoning',
        text: 'some reasoning',
      };

      const textPart = {
        id: 'part-2',
        sessionID: 'sess-nt',
        messageID: 'msg-u',
        type: 'text',
        text: 'Actual user text',
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-nt.json'])
        .mockResolvedValueOnce(['msg-u.json'])
        .mockResolvedValueOnce(['part-1.json', 'part-2.json']);

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(userMsg))
        .mockResolvedValueOnce(JSON.stringify(reasoningPart))
        .mockResolvedValueOnce(JSON.stringify(textPart));

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBe('Actual user text');
    });

    it('handles part directory that does not exist', async () => {
      const sessionFile = {
        id: 'sess-nopd',
        slug: 'sess-nopd',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'sess-nopd',
        time: { created: Date.now(), updated: Date.now() },
      };

      const userMsg = {
        id: 'msg-u',
        sessionID: 'sess-nopd',
        role: 'user',
        time: { created: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-nopd.json'])
        .mockResolvedValueOnce(['msg-u.json'])
        .mockRejectedValueOnce(new Error('ENOENT')); // part dir doesn't exist

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(userMsg));

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].sessionName).toBeNull();
    });

    it('handles unreadable first message file gracefully', async () => {
      const sessionFile = {
        id: 'sess-badmsg',
        slug: 'sess-badmsg',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Different',
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-badmsg.json'])
        .mockResolvedValueOnce(['msg-1.json']);

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockRejectedValueOnce(new Error('EACCES')); // can't read first msg

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionName).toBe('Different');
    });

    it('handles unreadable last assistant message file gracefully', async () => {
      const sessionFile = {
        id: 'sess-badlast',
        slug: 'sess-badlast',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Title',
        time: { created: Date.now(), updated: Date.now() },
      };

      const userMsg = {
        id: 'msg-u',
        sessionID: 'sess-badlast',
        role: 'user',
        time: { created: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-badlast.json'])
        .mockResolvedValueOnce(['msg-u.json', 'msg-a.json'])
        .mockRejectedValueOnce(new Error('ENOENT')); // no parts for user

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(sessionFile))
        .mockResolvedValueOnce(JSON.stringify(userMsg)) // first msg (user)
        .mockRejectedValueOnce(new Error('EACCES')); // can't read last msg

      const sessions = await adapter.discoverSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].lastMessage).toBeNull();
    });

    it('sets projectName to "Unknown" when directory has no trailing slash component', async () => {
      const sessionFile = {
        id: 'sess-root',
        slug: 'sess-root',
        version: '1',
        projectID: 'proj-1',
        directory: '',
        title: 'Root',
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock)
        .mockResolvedValueOnce(['proj-1'])
        .mockResolvedValueOnce(['sess-root.json'])
        .mockRejectedValueOnce(new Error('ENOENT'));

      (readFile as Mock).mockResolvedValueOnce(JSON.stringify(sessionFile));

      const sessions = await adapter.discoverSessions();
      expect(sessions[0].projectName).toBe('Unknown');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 7. watchSessions()
  // ────────────────────────────────────────────────────────────────

  describe('watchSessions()', () => {
    it('creates chokidar watcher on session dir with depth:2', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      expect(watch).toHaveBeenCalledWith('/mock/home/.local/share/opencode/storage/session', {
        ignoreInitial: true,
        persistent: true,
        depth: 2,
      });
    });

    it('calls callback with session_created on "add" for .json files', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const addHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'add'
      )?.[1];
      expect(addHandler).toBeDefined();

      addHandler('/mock/home/.local/share/opencode/storage/session/proj-1/session-abc.json');

      expect(callback).toHaveBeenCalledWith({
        type: 'session_created',
        sessionId: 'session-abc',
        agent: 'opencode',
      });
    });

    it('calls callback with session_removed on "unlink" for .json files', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const unlinkHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'unlink'
      )?.[1];
      expect(unlinkHandler).toBeDefined();

      unlinkHandler('/mock/home/.local/share/opencode/storage/session/proj-1/session-abc.json');

      expect(callback).toHaveBeenCalledWith({
        type: 'session_removed',
        sessionId: 'session-abc',
        agent: 'opencode',
      });
    });

    it('calls callback with session_updated on "change" for .json files', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const changeHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'change'
      )?.[1];
      expect(changeHandler).toBeDefined();

      changeHandler('/mock/home/.local/share/opencode/storage/session/proj-1/session-abc.json');

      expect(callback).toHaveBeenCalledWith({
        type: 'session_updated',
        sessionId: 'session-abc',
        agent: 'opencode',
      });
    });

    it('ignores non-.json files on add', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const addHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'add'
      )?.[1];

      addHandler('/some/path/somedir');
      addHandler('/some/path/notes.txt');

      expect(callback).not.toHaveBeenCalled();
    });

    it('ignores non-.json files on unlink', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const unlinkHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'unlink'
      )?.[1];

      unlinkHandler('/some/path/readme.md');

      expect(callback).not.toHaveBeenCalled();
    });

    it('ignores non-.json files on change', () => {
      const callback = vi.fn();
      adapter.watchSessions(callback);

      const changeHandler = (mockWatcherInstance.on as Mock).mock.calls.find(
        (call) => call[0] === 'change'
      )?.[1];

      changeHandler('/some/path/config.toml');

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
    it('finds session file and creates OpenCodeSession', async () => {
      const sessionFile = {
        id: 'my-session',
        slug: 'my-session',
        version: '1',
        projectID: 'proj-1',
        directory: '/my/project',
        title: 'Test',
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock).mockResolvedValue(['proj-1', 'proj-2']);
      (readFile as Mock)
        .mockRejectedValueOnce(new Error('ENOENT')) // proj-1 doesn't have it
        .mockResolvedValueOnce(JSON.stringify(sessionFile)); // proj-2 has it

      vi.mocked(discoverServer).mockResolvedValue(null);

      const session = await adapter.attachToSession('my-session');

      expect(OpenCodeSession).toHaveBeenCalledWith(
        'my-session',
        '/mock/home/.local/share/opencode',
        expect.objectContaining({ protocolVersion: ACP_VERSION }),
        null,
        '/my/project'
      );
      expect(session.sessionId).toBe('my-session');
    });

    it('throws when session not found in any project dir', async () => {
      (readdir as Mock).mockResolvedValue(['proj-1']);
      (readFile as Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(adapter.attachToSession('missing-session')).rejects.toThrow(
        'Session missing-session not found'
      );
    });

    it('throws when storage dir does not exist', async () => {
      (readdir as Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(adapter.attachToSession('any-id')).rejects.toThrow('Session any-id not found');
    });

    it('passes discovered server info to OpenCodeSession', async () => {
      const sessionFile = {
        id: 'srv-session',
        slug: 'srv-session',
        version: '1',
        projectID: 'proj-1',
        directory: '/project',
        title: 'Test',
        time: { created: Date.now(), updated: Date.now() },
      };

      (readdir as Mock).mockResolvedValue(['proj-1']);
      (readFile as Mock).mockResolvedValue(JSON.stringify(sessionFile));
      vi.mocked(discoverServer).mockResolvedValue({
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      });

      await adapter.attachToSession('srv-session');

      expect(OpenCodeSession).toHaveBeenCalledWith(
        'srv-session',
        '/mock/home/.local/share/opencode',
        expect.any(Object),
        { url: 'http://127.0.0.1:4096', version: '0.2.0' },
        '/project'
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 9. startSession()
  // ────────────────────────────────────────────────────────────────

  describe('startSession()', () => {
    it('creates OpenCodeSession and calls start()', async () => {
      vi.mocked(discoverServer).mockResolvedValue(null);

      const session = await adapter.startSession({
        projectPath: '/home/dev/myproject',
        prompt: 'Build a todo app',
      });

      expect(OpenCodeSession).toHaveBeenCalledWith(
        undefined,
        '/mock/home/.local/share/opencode',
        expect.objectContaining({ protocolVersion: ACP_VERSION }),
        null
      );
      expect(mockSessionStart).toHaveBeenCalledWith('/home/dev/myproject', 'Build a todo app');
      expect(session).toBeDefined();
    });

    it('passes server info when discovered', async () => {
      vi.mocked(discoverServer).mockResolvedValue({
        url: 'http://127.0.0.1:4096',
        version: '0.2.0',
      });

      await adapter.startSession({
        projectPath: '/project',
        prompt: 'Hello',
      });

      expect(OpenCodeSession).toHaveBeenCalledWith(
        undefined,
        '/mock/home/.local/share/opencode',
        expect.any(Object),
        { url: 'http://127.0.0.1:4096', version: '0.2.0' }
      );
    });
  });
});

/**
 * Claude Code adapter for Agentap — implements ACP
 */

import { watch, type FSWatcher } from 'chokidar';
import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import {
  BaseAdapter,
  type AgentDataPaths,
  type DiscoveredSession,
  type SessionDiscoveryEvent,
  type StartSessionOptions,
} from '@agentap-dev/adapter-base';
import type { ACPSession, ACPCapabilities } from '@agentap-dev/acp';
import { ACP_VERSION } from '@agentap-dev/acp';
import { ClaudeCodeSession } from './session';

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly name = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly icon = '🟠';
  readonly integrationMethod = 'sdk' as const;

  private claudeDir = join(homedir(), '.claude');
  private watcher: FSWatcher | null = null;

  override getCapabilities(): ACPCapabilities {
    return {
      protocolVersion: ACP_VERSION,
      agent: {
        name: this.name,
        displayName: this.displayName,
        icon: this.icon,
        version: null,
        integrationMethod: this.integrationMethod,
      },
      features: {
        streaming: {
          messages: true,
          toolArgs: false,
          thinking: true,
        },
        approval: { toolCalls: true, preview: true },
        sessionControl: {
          pause: false,
          resume: true,
          cancel: true,
        },
        subAgents: true,
        planning: { todos: true, planMode: true },
        resources: {
          tokenUsage: true,
          costTracking: false,
          contextWindow: false,
        },
        fileOperations: { diffs: true, batchedChanges: false },
        git: true,
        webSearch: true,
        multimodal: true,
        userInteraction: {
          questions: true,
          notifications: false,
        },
        thinking: true,
        customEvents: [],
      },
    };
  }

  getDataPaths(): AgentDataPaths {
    return {
      sessions: join(this.claudeDir, 'projects'),
      config: join(this.claudeDir, 'settings.json'),
      logs: join(this.claudeDir, 'logs'),
    };
  }

  async isInstalled(): Promise<boolean> {
    try {
      execSync('which claude', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const output = execSync('claude --version', {
        encoding: 'utf-8',
      });
      return output.trim();
    } catch {
      return null;
    }
  }

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const sessions: DiscoveredSession[] = [];
    const projectsDir = join(this.claudeDir, 'projects');

    try {
      const projectHashes = await readdir(projectsDir);

      for (const hash of projectHashes) {
        const projectDir = join(projectsDir, hash);

        try {
          const entries = await readdir(projectDir);

          // Sessions are stored as [sessionId].jsonl files directly in the project dir
          for (const entry of entries) {
            if (!entry.endsWith('.jsonl')) continue;

            const sessionId = entry.replace('.jsonl', '');
            const filePath = join(projectDir, entry);

            try {
              let fileStat;
              try {
                fileStat = await stat(filePath);
              } catch (err: unknown) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
                throw err;
              }

              if (!fileStat.isFile()) continue;

              // Read file to find cwd and last assistant message
              let content: string;
              try {
                content = await readFile(filePath, 'utf-8');
              } catch (err: unknown) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
                throw err;
              }
              let cwd: string | undefined;
              let lastMessage: string | null = null;

              const lines = content.split('\n');

              // Read lines for cwd (on user-type messages).
              // Scan up to 50 lines — the first user message
              // may be preceded by queue-operation and metadata.
              for (const line of lines.slice(0, 50)) {
                if (!line.trim()) continue;
                try {
                  const data = JSON.parse(line);
                  if (data.cwd) {
                    cwd = data.cwd;
                    break;
                  }
                } catch {
                  // skip malformed lines
                }
              }

              // Fallback: derive project path from hash directory name.
              // Claude Code encodes paths as /foo/bar → -foo-bar.
              // We try the naive conversion and keep it if the dir exists.
              if (!cwd) {
                try {
                  const candidate = hash.startsWith('-')
                    ? '/' + hash.slice(1).replace(/-/g, '/')
                    : hash.replace(/-/g, '/');

                  // Reject path traversal attempts
                  if (candidate.includes('..') || candidate.startsWith('//')) {
                    throw new Error('Invalid path');
                  }

                  const candidateStat = await stat(candidate);
                  if (candidateStat.isDirectory()) {
                    cwd = candidate;
                  }
                } catch {
                  // candidate path doesn't exist or is invalid — keep cwd undefined
                }
              }

              // Read first ~50 lines for first user message (session name)
              // Skip messages that are only system/IDE tags
              const tagNames =
                'system-reminder|ide_opened_file|ide_selection|ide_context|gitStatus|command-name|claudeMd';
              const pairedTagRe = new RegExp(
                `<(?:${tagNames}|antml:[^>]*)>[\\s\\S]*?<\\/(?:${tagNames}|antml:[^>]*)>`,
                'g'
              );
              const orphanTagRe = new RegExp(`<(?:${tagNames}|antml:[^>]*)>[\\s\\S]*`, 'g');
              let sessionName: string | null = null;
              for (const line of lines.slice(0, 50)) {
                if (!line.trim()) continue;
                try {
                  const data = JSON.parse(line);
                  if (data.type === 'user' && data.message?.content) {
                    // Collect ALL text blocks (user text may be in a later block after system tags)
                    const textBlocks = Array.isArray(data.message.content)
                      ? data.message.content
                          .filter(
                            (c: { type: string; text?: string }) =>
                              c.type === 'text' && c.text?.trim()
                          )
                          .map((c: { text: string }) => c.text)
                      : [];
                    const fullText = textBlocks.join('\n');
                    if (fullText.trim()) {
                      // Strip system/IDE tags (paired + orphaned) to get actual user text
                      const cleaned = fullText
                        .replace(pairedTagRe, '')
                        .replace(orphanTagRe, '')
                        .trim();
                      if (!cleaned) continue; // only system tags, try next message
                      sessionName = cleaned.length > 100 ? cleaned.slice(0, 100) + '...' : cleaned;
                      break;
                    }
                  }
                } catch {
                  // skip malformed lines
                }
              }

              // Read last few lines for last assistant message
              const tailLines = lines.slice(-30);
              for (let i = tailLines.length - 1; i >= 0; i--) {
                const line = tailLines[i].trim();
                if (!line) continue;
                try {
                  const data = JSON.parse(line);
                  if (data.type === 'assistant' && data.message?.content) {
                    // Extract text from content array
                    const textBlock = Array.isArray(data.message.content)
                      ? data.message.content.find((c: { type: string }) => c.type === 'text')
                      : null;
                    if (textBlock?.text?.trim()) {
                      // Take first ~200 chars as summary
                      const text = textBlock.text.trim();
                      lastMessage = text.length > 200 ? text.slice(0, 200) + '...' : text;
                      break;
                    }
                  }
                } catch {
                  // skip malformed lines
                }
              }

              sessions.push({
                id: sessionId,
                agent: 'claude-code',
                projectPath: cwd || 'Unknown',
                projectName: cwd ? basename(cwd) : 'Unknown',
                createdAt: fileStat.birthtime,
                lastActivity: fileStat.mtime,
                lastMessage,
                sessionName,
              });
            } catch {
              // Skip files we can't read
            }
          }
        } catch {
          // Skip if can't read project dir
        }
      }
    } catch {
      // No projects dir yet
    }

    sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    return sessions;
  }

  watchSessions(callback: (event: SessionDiscoveryEvent) => void): () => void {
    const projectsDir = join(this.claudeDir, 'projects');

    // chokidar v4+ dropped glob support, so watch the projects
    // directory recursively and filter for .jsonl files manually.
    this.watcher = watch(projectsDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 2,
    });

    const isSessionFile = (path: string): boolean => path.endsWith('.jsonl');

    this.watcher.on('add', (path) => {
      console.log(`[adapter:watch] ADD ${path}`);
      if (!isSessionFile(path)) return;
      const sessionId = basename(path, '.jsonl');
      console.log(`[adapter:watch] -> session_created ${sessionId}`);
      callback({
        type: 'session_created',
        sessionId,
        agent: 'claude-code',
      });
    });

    this.watcher.on('unlink', (path) => {
      console.log(`[adapter:watch] UNLINK ${path}`);
      if (!isSessionFile(path)) return;
      const sessionId = basename(path, '.jsonl');
      console.log(`[adapter:watch] -> session_removed ${sessionId}`);
      callback({
        type: 'session_removed',
        sessionId,
        agent: 'claude-code',
      });
    });

    this.watcher.on('change', (path) => {
      console.log(`[adapter:watch] CHANGE ${path}`);
      if (!isSessionFile(path)) return;
      const sessionId = basename(path, '.jsonl');
      console.log(`[adapter:watch] -> session_updated ${sessionId}`);
      callback({
        type: 'session_updated',
        sessionId,
        agent: 'claude-code',
      });
    });

    return () => {
      this.watcher?.close();
      this.watcher = null;
    };
  }

  async attachToSession(sessionId: string): Promise<ACPSession> {
    const projectsDir = join(this.claudeDir, 'projects');
    const projectHashes = await readdir(projectsDir);

    for (const hash of projectHashes) {
      const sessionFile = join(projectsDir, hash, `${sessionId}.jsonl`);

      try {
        await stat(sessionFile);
        // Pass the project dir (containing the .jsonl file) as sessionDir
        return new ClaudeCodeSession(sessionId, join(projectsDir, hash), this.getCapabilities());
      } catch {
        // Not in this project
      }
    }

    throw new Error(`Session ${sessionId} not found`);
  }

  async startSession(options: StartSessionOptions): Promise<ACPSession> {
    const session = new ClaudeCodeSession(undefined, undefined, this.getCapabilities());
    await session.start(options.projectPath, options.prompt, options.model);
    return session;
  }
}

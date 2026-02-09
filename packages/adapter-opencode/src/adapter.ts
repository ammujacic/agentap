/**
 * OpenCode adapter for Agentap — implements ACP
 *
 * Primary mode: file-based (watches ~/.local/share/opencode/storage/).
 * Optional HTTP upgrade when `opencode serve` is running.
 */

import { watch, type FSWatcher } from 'chokidar';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
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
import { OpenCodeSession } from './session';
import { discoverServer } from './server-discovery';
import type {
  OpenCodeSessionFile,
  OpenCodeMessageFile,
  OpenCodePartFile,
  ServerInfo,
} from './types';

function getDataDir(): string {
  // OpenCode uses ~/.local/share/opencode/ on both macOS and Linux
  // (it does NOT use ~/Library/Application Support/ on macOS)
  return join(homedir(), '.local', 'share', 'opencode');
}

export class OpenCodeAdapter extends BaseAdapter {
  readonly name = 'opencode';
  readonly displayName = 'OpenCode';
  readonly icon = '⚡';
  readonly integrationMethod = 'file-watch' as const;

  private dataDir = getDataDir();
  private watcher: FSWatcher | null = null;
  private serverInfo: ServerInfo | null = null;

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
        approval: { toolCalls: true, preview: false },
        sessionControl: {
          pause: false,
          resume: false,
          cancel: true,
        },
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
        userInteraction: {
          questions: false,
          notifications: false,
        },
        thinking: true,
        customEvents: [],
      },
    };
  }

  getDataPaths(): AgentDataPaths {
    return {
      sessions: join(this.dataDir, 'storage', 'session'),
      config: this.dataDir,
      logs: join(this.dataDir, 'log'),
    };
  }

  async isInstalled(): Promise<boolean> {
    try {
      execSync('which opencode', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    if (this.serverInfo) return this.serverInfo.version;
    try {
      const output = execSync('opencode version', {
        encoding: 'utf-8',
      });
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Discover sessions by reading JSON files from OpenCode's storage directory.
   * Falls back gracefully if the directory doesn't exist.
   */
  async discoverSessions(): Promise<DiscoveredSession[]> {
    const sessions: DiscoveredSession[] = [];
    const sessionDir = join(this.dataDir, 'storage', 'session');

    try {
      const projectIDs = await readdir(sessionDir);

      for (const projectID of projectIDs) {
        const projectDir = join(sessionDir, projectID);

        try {
          const entries = await readdir(projectDir);

          for (const entry of entries) {
            if (!entry.endsWith('.json')) continue;

            const filePath = join(projectDir, entry);

            try {
              const content = await readFile(filePath, 'utf-8');
              const session = JSON.parse(content) as OpenCodeSessionFile;

              // Skip archived sessions
              if (session.time.archived) continue;

              // Get the last message and session name by reading message/part files
              const { lastMessage, sessionName } = await this.getSessionPreview(session.id);

              sessions.push({
                id: session.id,
                agent: 'opencode',
                projectPath: session.directory,
                projectName: session.directory.split('/').pop() || 'Unknown',
                createdAt: new Date(session.time.created),
                lastActivity: new Date(session.time.updated),
                lastMessage,
                sessionName: sessionName || (session.title !== session.slug ? session.title : null),
              });
            } catch {
              // Skip files we can't read
            }
          }
        } catch {
          // Skip unreadable project dirs
        }
      }
    } catch {
      // No storage dir yet
    }

    sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    return sessions;
  }

  watchSessions(callback: (event: SessionDiscoveryEvent) => void): () => void {
    const sessionDir = join(this.dataDir, 'storage', 'session');

    this.watcher = watch(sessionDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 2,
    });

    const isSessionFile = (path: string): boolean => path.endsWith('.json');

    const extractSessionId = (path: string): string => path.split('/').pop()!.replace('.json', '');

    this.watcher.on('add', (path) => {
      if (!isSessionFile(path)) return;
      const sessionId = extractSessionId(path);
      callback({
        type: 'session_created',
        sessionId,
        agent: 'opencode',
      });
    });

    this.watcher.on('unlink', (path) => {
      if (!isSessionFile(path)) return;
      const sessionId = extractSessionId(path);
      callback({
        type: 'session_removed',
        sessionId,
        agent: 'opencode',
      });
    });

    this.watcher.on('change', (path) => {
      if (!isSessionFile(path)) return;
      const sessionId = extractSessionId(path);
      callback({
        type: 'session_updated',
        sessionId,
        agent: 'opencode',
      });
    });

    return () => {
      this.watcher?.close();
      this.watcher = null;
    };
  }

  async attachToSession(sessionId: string): Promise<ACPSession> {
    // Try to find the session in storage to get its directory
    const sessionDir = join(this.dataDir, 'storage', 'session');
    let sessionFile: OpenCodeSessionFile | null = null;

    try {
      const projectIDs = await readdir(sessionDir);
      for (const projectID of projectIDs) {
        const filePath = join(sessionDir, projectID, `${sessionId}.json`);
        try {
          const content = await readFile(filePath, 'utf-8');
          sessionFile = JSON.parse(content) as OpenCodeSessionFile;
          break;
        } catch {
          // Not in this project
        }
      }
    } catch {
      // No storage dir
    }

    if (!sessionFile) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Try to discover the HTTP server for enhanced capabilities
    if (!this.serverInfo) {
      this.serverInfo = await discoverServer();
    }

    return new OpenCodeSession(
      sessionId,
      this.dataDir,
      this.getCapabilities(),
      this.serverInfo,
      sessionFile.directory
    );
  }

  async startSession(options: StartSessionOptions): Promise<ACPSession> {
    // Try to discover server for HTTP-based session start
    if (!this.serverInfo) {
      this.serverInfo = await discoverServer();
    }

    const session = new OpenCodeSession(
      undefined,
      this.dataDir,
      this.getCapabilities(),
      this.serverInfo
    );

    await session.start(options.projectPath, options.prompt);
    return session;
  }

  /**
   * Read message/part files to get the first user message (session name)
   * and last assistant message text (preview).
   */
  private async getSessionPreview(sessionId: string): Promise<{
    lastMessage: string | null;
    sessionName: string | null;
  }> {
    let lastMessage: string | null = null;
    let sessionName: string | null = null;

    const messageDir = join(this.dataDir, 'storage', 'message', sessionId);

    try {
      const messageFiles = await readdir(messageDir);
      if (messageFiles.length === 0) return { lastMessage, sessionName };

      // Sort by filename (IDs are chronologically ordered)
      messageFiles.sort();

      // First message → session name (should be a user message)
      const firstMsgPath = join(messageDir, messageFiles[0]);
      try {
        const firstMsg = JSON.parse(await readFile(firstMsgPath, 'utf-8')) as OpenCodeMessageFile;

        if (firstMsg.role === 'user') {
          // Read the text part for this message
          const text = await this.getFirstTextPart(firstMsg.id);
          if (text) {
            sessionName = text.length > 100 ? text.slice(0, 100) + '...' : text;
          }
        }
      } catch {
        // Skip
      }

      // Last assistant message → preview
      for (let i = messageFiles.length - 1; i >= 0; i--) {
        const msgPath = join(messageDir, messageFiles[i]);
        try {
          const msg = JSON.parse(await readFile(msgPath, 'utf-8')) as OpenCodeMessageFile;

          if (msg.role === 'assistant') {
            const text = await this.getFirstTextPart(msg.id);
            if (text) {
              lastMessage = text.length > 200 ? text.slice(0, 200) + '...' : text;
              break;
            }
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // No messages yet
    }

    return { lastMessage, sessionName };
  }

  /**
   * Read the first text part for a given message.
   */
  private async getFirstTextPart(messageId: string): Promise<string | null> {
    const partDir = join(this.dataDir, 'storage', 'part', messageId);

    try {
      const partFiles = await readdir(partDir);
      partFiles.sort();

      for (const partFile of partFiles) {
        const partPath = join(partDir, partFile);
        const part = JSON.parse(await readFile(partPath, 'utf-8')) as OpenCodePartFile;

        if (part.type === 'text' && part.text.trim()) {
          return part.text.trim();
        }
      }
    } catch {
      // No parts
    }

    return null;
  }
}

/**
 * OpenCode session — implements ACPSession
 *
 * File mode (default): Reads message/part JSON files from storage,
 *   watches for new files to emit real-time ACP events.
 * HTTP mode (when server available): Subscribes to SSE event stream,
 *   enables approval/denial commands via the permission API.
 */

import { EventEmitter } from 'events';
import { watch, type FSWatcher } from 'chokidar';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import type {
  ACPSession,
  ACPEvent,
  ACPCommand,
  ACPCapabilities,
  SessionStatus,
} from '@agentap-dev/acp';
import {
  createEvent,
  resetSequence,
  assessRisk,
  describeToolCall,
  categorizeTool,
} from '@agentap-dev/acp';
import type {
  OpenCodeMessageFile,
  OpenCodeAssistantMessage,
  OpenCodePartFile,
  OpenCodeToolPart,
  OpenCodeStepFinishPart,
  ServerInfo,
} from './types';

export class OpenCodeSession implements ACPSession {
  sessionId: string;
  readonly capabilities: ACPCapabilities;

  private emitter = new EventEmitter();
  private watchers: FSWatcher[] = [];
  private process: ChildProcess | null = null;
  private dataDir: string;
  private serverInfo: ServerInfo | null;
  private projectDirectory: string = '';
  private status: SessionStatus = 'idle';
  private history: ACPEvent[] = [];
  private sseAbortController: AbortController | null = null;

  /**
   * Track seen message/part IDs to avoid duplicate events during
   * file-watch mode (files may be written multiple times).
   */
  private seenMessages = new Set<string>();
  private seenParts = new Map<string, { type: string; status?: string }>();

  constructor(
    sessionId: string | undefined,
    dataDir: string,
    capabilities: ACPCapabilities,
    serverInfo?: ServerInfo | null,
    projectDirectory?: string
  ) {
    this.sessionId = sessionId || this.generateId();
    this.dataDir = dataDir;
    this.capabilities = capabilities;
    this.serverInfo = serverInfo ?? null;
    this.projectDirectory = projectDirectory ?? '';

    if (sessionId) {
      // Attached session — load history and start watching
      this.loadHistory().then(() => {
        this.startWatching();
        this.connectSSE();
      });
    }
  }

  // ── ACPSession interface ──────────────────────────────────

  onEvent(callback: (event: ACPEvent) => void): () => void {
    this.emitter.on('acp_event', callback);
    return () => this.emitter.off('acp_event', callback);
  }

  async execute(command: ACPCommand): Promise<void> {
    switch (command.command) {
      case 'send_message': {
        if (this.serverInfo) {
          await this.httpPost(`session/${this.sessionId}/message`, {
            parts: [{ type: 'text', text: command.message }],
          });
        } else if (this.process && this.process.stdin) {
          this.process.stdin.write(command.message + '\n');
        } else {
          throw new Error('Cannot send message: no server connection and no active process');
        }
        break;
      }

      case 'approve_tool_call': {
        if (!this.serverInfo) {
          throw new Error(
            'Cannot approve tool calls without OpenCode HTTP server (run with --port)'
          );
        }
        await this.httpPost(`permission/${command.requestId}/reply`, { reply: 'once' });

        this.emit(
          createEvent(this.sessionId, {
            type: 'approval:resolved' as const,
            requestId: command.requestId,
            toolCallId: command.toolCallId,
            approved: true,
            resolvedBy: 'user',
          })
        );
        break;
      }

      case 'deny_tool_call': {
        if (!this.serverInfo) {
          throw new Error('Cannot deny tool calls without OpenCode HTTP server (run with --port)');
        }
        await this.httpPost(`permission/${command.requestId}/reply`, {
          reply: 'reject',
          message: command.reason,
        });

        this.emit(
          createEvent(this.sessionId, {
            type: 'approval:resolved' as const,
            requestId: command.requestId,
            toolCallId: command.toolCallId,
            approved: false,
            resolvedBy: 'user',
            reason: command.reason,
          })
        );
        break;
      }

      case 'cancel': {
        if (this.serverInfo) {
          await this.httpPost(`session/${this.sessionId}/abort`, {});
        } else if (this.process) {
          this.process.kill('SIGINT');
        }
        break;
      }

      case 'terminate': {
        if (this.serverInfo) {
          try {
            await this.httpPost(`session/${this.sessionId}/abort`, {});
          } catch {
            // Best effort
          }
        }
        if (this.process) {
          this.process.kill('SIGTERM');
        }
        await this.detach();
        break;
      }

      default:
        break;
    }
  }

  async getHistory(): Promise<ACPEvent[]> {
    return [...this.history];
  }

  async detach(): Promise<void> {
    const watchers = this.watchers;
    this.watchers = [];
    for (const w of watchers) {
      try {
        await w.close();
      } catch (err) {
        console.error('Error closing watcher:', err);
      }
    }

    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  // ── Start a new session via CLI ──────────────────────────

  async start(projectPath: string, prompt: string): Promise<void> {
    this.projectDirectory = projectPath;
    resetSequence(this.sessionId);
    this.updateStatus('starting');

    if (this.serverInfo) {
      // HTTP mode: create session + send prompt
      try {
        const createResp = await this.httpPost('session/', {});
        const created = createResp as { id?: string };
        if (created.id) {
          this.sessionId = created.id;
        }

        await this.httpPost(`session/${this.sessionId}/message`, {
          parts: [{ type: 'text', text: prompt }],
        });

        this.updateStatus('running');
        this.emit(
          createEvent(this.sessionId, {
            type: 'session:started' as const,
            agent: 'opencode',
            projectPath,
            projectName: projectPath.split('/').pop() || 'Unknown',
            workingDirectory: projectPath,
          })
        );

        // Start watching storage + SSE
        this.startWatching();
        this.connectSSE();
        return;
      } catch {
        // Fall back to CLI
      }
    }

    // CLI mode: spawn opencode process
    this.process = spawn('opencode', ['run', prompt, '--format', 'json'], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.updateStatus('running');
    this.emit(
      createEvent(this.sessionId, {
        type: 'session:started' as const,
        agent: 'opencode',
        projectPath,
        projectName: projectPath.split('/').pop() || 'Unknown',
        workingDirectory: projectPath,
      })
    );

    let buffer = '';
    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) this.handleProcessOutput(line);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('[opencode] stderr:', data.toString());
    });

    this.process.on('close', (code) => {
      this.process = null;
      if (code === 0) {
        this.updateStatus('completed');
        this.emit(
          createEvent(this.sessionId, {
            type: 'session:completed' as const,
            summary: {
              filesChanged: [],
              tokenUsage: { inputTokens: 0, outputTokens: 0 },
              duration: 0,
              toolCallsCount: 0,
              messagesCount: 0,
              errorCount: 0,
            },
          })
        );
      } else {
        this.updateStatus('error');
        this.emit(
          createEvent(this.sessionId, {
            type: 'session:error' as const,
            error: {
              code: 'PROCESS_ERROR',
              message: `Process exited with code ${code}`,
              recoverable: false,
            },
          })
        );
      }
    });

    this.process.on('error', (error) => {
      this.emit(
        createEvent(this.sessionId, {
          type: 'session:error' as const,
          error: {
            code: 'SPAWN_ERROR',
            message: error.message,
            recoverable: false,
          },
        })
      );
    });
  }

  // ── File-based history loading ────────────────────────────

  /**
   * Read all existing messages+parts for this session and emit ACP events.
   */
  private async loadHistory(): Promise<void> {
    const messageDir = join(this.dataDir, 'storage', 'message', this.sessionId);

    let messageFiles: string[];
    try {
      messageFiles = await readdir(messageDir);
    } catch {
      return; // No messages yet
    }

    messageFiles.sort(); // IDs are chronologically ordered

    for (const msgFile of messageFiles) {
      if (!msgFile.endsWith('.json')) continue;

      try {
        const msgPath = join(messageDir, msgFile);
        const msg = JSON.parse(await readFile(msgPath, 'utf-8')) as OpenCodeMessageFile;

        // Load parts for this message
        const parts = await this.loadPartsForMessage(msg.id);

        this.processMessageWithParts(msg, parts);
      } catch {
        // Skip unreadable messages
      }
    }
  }

  private async loadPartsForMessage(messageId: string): Promise<OpenCodePartFile[]> {
    const partDir = join(this.dataDir, 'storage', 'part', messageId);
    const parts: OpenCodePartFile[] = [];

    try {
      const partFiles = await readdir(partDir);
      partFiles.sort();

      for (const partFile of partFiles) {
        if (!partFile.endsWith('.json')) continue;
        try {
          const content = await readFile(join(partDir, partFile), 'utf-8');
          parts.push(JSON.parse(content) as OpenCodePartFile);
        } catch {
          // Skip
        }
      }
    } catch {
      // No parts dir
    }

    return parts;
  }

  // ── File watching for real-time updates ───────────────────

  private startWatching(): void {
    // Watch for new/changed message files
    const messageDir = join(this.dataDir, 'storage', 'message', this.sessionId);
    const messageWatcher = watch(messageDir, {
      ignoreInitial: true,
      persistent: true,
    });

    messageWatcher.on('add', (path) => this.onMessageFileChange(path));
    messageWatcher.on('change', (path) => this.onMessageFileChange(path));
    this.watchers.push(messageWatcher);

    // Watch for new/changed part files — we watch the parent part dir
    // and filter for parts belonging to this session's messages.
    const partDir = join(this.dataDir, 'storage', 'part');
    const partWatcher = watch(partDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 2,
    });

    partWatcher.on('add', (path) => this.onPartFileChange(path));
    partWatcher.on('change', (path) => this.onPartFileChange(path));
    this.watchers.push(partWatcher);
  }

  private async onMessageFileChange(path: string): Promise<void> {
    if (!path.endsWith('.json')) return;

    try {
      const msg = JSON.parse(await readFile(path, 'utf-8')) as OpenCodeMessageFile;

      if (msg.sessionID !== this.sessionId) return;

      // For new messages, load their parts and process
      if (!this.seenMessages.has(msg.id)) {
        const parts = await this.loadPartsForMessage(msg.id);
        this.processMessageWithParts(msg, parts);
      } else {
        // Updated message — re-check for completion
        this.handleMessageUpdate(msg);
      }
    } catch {
      // Skip
    }
  }

  private async onPartFileChange(path: string): Promise<void> {
    if (!path.endsWith('.json')) return;

    try {
      const part = JSON.parse(await readFile(path, 'utf-8')) as OpenCodePartFile;

      if (part.sessionID !== this.sessionId) return;

      this.handlePartEvent(part);
    } catch {
      // Skip
    }
  }

  // ── SSE connection (HTTP mode) ────────────────────────────

  private async connectSSE(): Promise<void> {
    if (!this.serverInfo) return;

    this.sseAbortController = new AbortController();

    try {
      const resp = await fetch(`${this.serverInfo.url}/event`, {
        headers: {
          Accept: 'text/event-stream',
          'x-opencode-directory': this.projectDirectory || '/',
        },
        signal: this.sseAbortController.signal,
      });

      if (!resp.ok || !resp.body) return;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (jsonStr) {
              try {
                const event = JSON.parse(jsonStr) as {
                  type: string;
                  properties: Record<string, unknown>;
                };
                this.handleSSEEvent(event);
              } catch {
                // Skip parse errors
              }
            }
          }
        }
      }
    } catch (err) {
      // AbortError is expected on detach
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      console.error('[opencode:sse] Connection lost:', err);
    }
  }

  private handleSSEEvent(event: { type: string; properties: Record<string, unknown> }): void {
    const props = event.properties;

    switch (event.type) {
      case 'permission.asked': {
        const sessionID = props.sessionID as string;
        if (sessionID !== this.sessionId) return;

        const requestId = props.id as string;
        const permission = props.permission as string;
        const patterns = (props.patterns as string[]) || [];
        const metadata = (props.metadata as Record<string, unknown>) || {};
        const tool = props.tool as { messageID: string; callID: string } | undefined;

        const toolCallId = tool?.callID || requestId;

        this.updateStatus('waiting_for_approval');
        this.emit(
          createEvent(this.sessionId, {
            type: 'approval:requested' as const,
            requestId,
            toolCallId,
            toolName: permission,
            toolInput: metadata,
            description: `Permission: ${permission} for ${patterns.join(', ')}`,
            riskLevel: assessRisk(permission, metadata),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            preview: {
              type: 'description' as const,
              text: `${permission}: ${patterns.join(', ')}`,
            },
          })
        );
        break;
      }

      case 'permission.replied': {
        const sessionID = props.sessionID as string;
        if (sessionID !== this.sessionId) return;

        const reply = props.reply as string;
        this.updateStatus(reply === 'reject' ? 'error' : 'running');
        break;
      }

      // SSE can also deliver part updates more granularly
      case 'message.part.updated': {
        const part = props.part as OpenCodePartFile | undefined;
        if (!part || part.sessionID !== this.sessionId) return;
        this.handlePartEvent(part);
        break;
      }

      case 'message.updated': {
        const info = props.info as OpenCodeMessageFile | undefined;
        if (!info || info.sessionID !== this.sessionId) return;
        this.handleMessageUpdate(info);
        break;
      }
    }
  }

  // ── Event processing ─────────────────────────────────────

  /**
   * Process a complete message with all its parts.
   * Used during initial history loading and for new messages.
   */
  private processMessageWithParts(msg: OpenCodeMessageFile, parts: OpenCodePartFile[]): void {
    this.seenMessages.add(msg.id);

    if (msg.role === 'user') {
      // Collect text from text parts
      const textParts = parts
        .filter((p): p is OpenCodePartFile & { type: 'text' } => p.type === 'text')
        .map((p) => p.text)
        .filter((t) => t.trim());

      const userText = textParts.join('\n');

      if (userText) {
        this.emit(
          createEvent(this.sessionId, {
            type: 'message:start' as const,
            messageId: msg.id,
            role: 'user' as const,
          })
        );
        this.emit(
          createEvent(this.sessionId, {
            type: 'message:complete' as const,
            messageId: msg.id,
            role: 'user' as const,
            content: [{ type: 'text' as const, text: userText }],
          })
        );
      }
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as OpenCodeAssistantMessage;

      // Set project directory from first assistant message
      if (!this.projectDirectory && assistantMsg.path) {
        this.projectDirectory = assistantMsg.path.root;
      }

      // Emit environment info on first assistant message
      this.emit(
        createEvent(this.sessionId, {
          type: 'environment:info' as const,
          context: {
            agent: {
              name: 'opencode',
              version: '',
              displayName: 'OpenCode',
            },
            model: {
              id: assistantMsg.modelID,
              provider: assistantMsg.providerID,
            },
            project: {
              path: assistantMsg.path?.root || this.projectDirectory,
              name:
                (assistantMsg.path?.root || this.projectDirectory).split('/').pop() || 'Unknown',
            },
            runtime: {
              os: process.platform,
              arch: process.arch,
            },
          },
        })
      );

      // Emit message:start
      this.emit(
        createEvent(this.sessionId, {
          type: 'message:start' as const,
          messageId: msg.id,
          role: 'assistant' as const,
        })
      );

      // Process each part
      for (const part of parts) {
        this.handlePartEvent(part);
      }

      // Emit message:complete if the message is finished
      if (assistantMsg.finish) {
        const textContent = parts
          .filter((p): p is OpenCodePartFile & { type: 'text' } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');

        this.emit(
          createEvent(this.sessionId, {
            type: 'message:complete' as const,
            messageId: msg.id,
            role: 'assistant' as const,
            content: textContent ? [{ type: 'text' as const, text: textContent }] : [],
            model: `${assistantMsg.providerID}/${assistantMsg.modelID}`,
            stopReason: assistantMsg.finish,
          })
        );
      }

      // Emit error if present
      if (assistantMsg.error) {
        this.emit(
          createEvent(this.sessionId, {
            type: 'session:error' as const,
            error: {
              code: assistantMsg.error.name || 'UNKNOWN',
              message: assistantMsg.error.message || 'Unknown error',
              recoverable: true,
            },
          })
        );
      }
    }
  }

  /**
   * Handle a message file update (e.g. assistant message gets completed).
   */
  private handleMessageUpdate(msg: OpenCodeMessageFile): void {
    if (msg.role !== 'assistant') return;

    const assistantMsg = msg as OpenCodeAssistantMessage;

    // Check if newly completed
    if (assistantMsg.finish && assistantMsg.time.completed) {
      this.emit(
        createEvent(this.sessionId, {
          type: 'message:complete' as const,
          messageId: msg.id,
          role: 'assistant' as const,
          content: [],
          model: `${assistantMsg.providerID}/${assistantMsg.modelID}`,
          stopReason: assistantMsg.finish,
        })
      );
    }
  }

  /**
   * Handle a single part event. Tracks seen state to avoid duplicates.
   */
  private handlePartEvent(part: OpenCodePartFile): void {
    const prev = this.seenParts.get(part.id);

    switch (part.type) {
      case 'text': {
        if (!prev) {
          this.emit(
            createEvent(this.sessionId, {
              type: 'message:delta' as const,
              messageId: part.messageID,
              role: 'assistant' as const,
              delta: part.text,
            })
          );
        }
        this.seenParts.set(part.id, { type: 'text' });
        break;
      }

      case 'reasoning': {
        if (!prev) {
          this.emit(
            createEvent(this.sessionId, {
              type: 'thinking:start' as const,
              messageId: part.messageID,
            })
          );
          if (part.text) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'thinking:delta' as const,
                messageId: part.messageID,
                delta: part.text,
              })
            );
          }
          if (part.time.end) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'thinking:complete' as const,
                messageId: part.messageID,
                content: part.text,
                redacted: false,
              })
            );
          }
        }
        this.seenParts.set(part.id, { type: 'reasoning' });
        break;
      }

      case 'tool': {
        this.handleToolPart(part, prev?.status);
        this.seenParts.set(part.id, {
          type: 'tool',
          status: part.state.status,
        });
        break;
      }

      case 'step-finish': {
        if (!prev) {
          this.handleStepFinish(part);
        }
        this.seenParts.set(part.id, { type: 'step-finish' });
        break;
      }

      default:
        // step-start and other types — no ACP equivalent
        this.seenParts.set(part.id, { type: part.type });
        break;
    }
  }

  /**
   * Map tool part state transitions to ACP tool events.
   */
  private handleToolPart(part: OpenCodeToolPart, prevStatus?: string): void {
    const { state } = part;

    if (state.status === 'pending' && prevStatus !== 'pending') {
      this.emit(
        createEvent(this.sessionId, {
          type: 'tool:start' as const,
          toolCallId: part.callID,
          name: part.tool,
          category: categorizeTool(part.tool),
          description: describeToolCall(part.tool, state.input),
        })
      );
    }

    if (state.status === 'running' && prevStatus !== 'running') {
      this.emit(
        createEvent(this.sessionId, {
          type: 'tool:executing' as const,
          toolCallId: part.callID,
          name: part.tool,
          input: state.input,
          riskLevel: assessRisk(part.tool, state.input),
          requiresApproval: false,
        })
      );
    }

    if (state.status === 'completed' && prevStatus !== 'completed') {
      this.emit(
        createEvent(this.sessionId, {
          type: 'tool:result' as const,
          toolCallId: part.callID,
          name: part.tool,
          output: state.output,
          duration: state.time.end - state.time.start,
        })
      );
    }

    if (state.status === 'error' && prevStatus !== 'error') {
      this.emit(
        createEvent(this.sessionId, {
          type: 'tool:error' as const,
          toolCallId: part.callID,
          name: part.tool,
          error: {
            code: 'TOOL_ERROR',
            message: state.error,
            recoverable: true,
          },
        })
      );
    }
  }

  /**
   * Extract token usage and cost from a step-finish part.
   */
  private handleStepFinish(part: OpenCodeStepFinishPart): void {
    this.emit(
      createEvent(this.sessionId, {
        type: 'resource:token_usage' as const,
        delta: {
          inputTokens: part.tokens.input,
          outputTokens: part.tokens.output,
          cacheReadTokens: part.tokens.cache.read,
          cacheWriteTokens: part.tokens.cache.write,
        },
        cumulative: {
          inputTokens: part.tokens.input,
          outputTokens: part.tokens.output,
          cacheReadTokens: part.tokens.cache.read,
          cacheWriteTokens: part.tokens.cache.write,
        },
      })
    );

    if (part.cost > 0) {
      this.emit(
        createEvent(this.sessionId, {
          type: 'resource:cost' as const,
          delta: {
            total: part.cost,
            input: 0,
            output: 0,
            currency: 'USD',
          },
          cumulative: {
            total: part.cost,
            input: 0,
            output: 0,
            currency: 'USD',
          },
        })
      );
    }
  }

  // ── Process output handling (CLI mode) ────────────────────

  private handleProcessOutput(line: string): void {
    try {
      const data = JSON.parse(line);
      // OpenCode `--format json` outputs structured events
      // Process them similarly to how we handle storage files
      if (data.type && data.sessionID) {
        // This is a bus event — handle like SSE
        this.handleSSEEvent({
          type: data.type,
          properties: data,
        });
      }
    } catch {
      // Non-JSON output — ignore
    }
  }

  // ── HTTP helper ──────────────────────────────────────────

  private async httpPost(path: string, body: unknown): Promise<unknown> {
    if (!this.serverInfo) {
      throw new Error('No OpenCode server connection');
    }

    const resp = await fetch(`${this.serverInfo.url}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-directory': this.projectDirectory || '/',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenCode API error ${resp.status}: ${text}`);
    }

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return resp.json();
    }
    return resp.text();
  }

  // ── Helpers ──────────────────────────────────────────────

  private emit(event: ACPEvent): void {
    this.history.push(event);
    this.emitter.emit('acp_event', event);
  }

  private updateStatus(to: SessionStatus): void {
    const from = this.status;
    this.status = to;

    this.emit(
      createEvent(this.sessionId, {
        type: 'session:status_changed' as const,
        from,
        to,
      })
    );
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}

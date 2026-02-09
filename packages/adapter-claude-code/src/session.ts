/**
 * Claude Code session — implements ACPSession with unified event stream
 */

import { EventEmitter } from 'events';
import { watch, type FSWatcher } from 'chokidar';
import { readFile } from 'fs/promises';
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

export class ClaudeCodeSession implements ACPSession {
  sessionId: string;
  readonly capabilities: ACPCapabilities;

  private emitter = new EventEmitter();
  private watcher: FSWatcher | null = null;
  private process: ChildProcess | null = null;
  private conversationPath: string = '';
  private lastReadPosition = 0;
  private projectPath: string = '';
  private status: SessionStatus = 'idle';
  private suppressFileEvents = false;
  private emittedEnvInfo = false;
  private claudeVersion: string = '';
  private history: ACPEvent[] = [];
  private pendingApprovals: Map<string, { resolve: (approved: boolean) => void }> = new Map();
  /** Resolves once the initial file read is complete */
  private initialReadDone: Promise<void>;
  private resolveInitialRead!: () => void;

  constructor(sessionId?: string, sessionDir?: string, capabilities?: ACPCapabilities) {
    this.sessionId = sessionId || this.generateId();
    this.capabilities = capabilities || ({} as ACPCapabilities);
    this.initialReadDone = new Promise<void>((resolve) => (this.resolveInitialRead = resolve));

    if (sessionDir) {
      this.conversationPath = join(sessionDir, `${this.sessionId}.jsonl`);
      this.startWatching();
    } else {
      this.resolveInitialRead();
    }
  }

  /**
   * Start a new Claude Code session
   */
  async start(projectPath: string, prompt: string, model?: string): Promise<void> {
    this.projectPath = projectPath;
    resetSequence(this.sessionId);

    this.updateStatus('starting');

    const args = ['--print', '--verbose', '--output-format', 'stream-json'];
    if (model) {
      args.push('--model', model);
    }
    args.push(prompt);

    this.process = spawn('claude', args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.updateStatus('running');

    this.emit(
      createEvent(this.sessionId, {
        type: 'session:started' as const,
        agent: 'claude-code',
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
        if (line.trim()) {
          this.handleStreamEvent(line);
        }
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('Claude stderr:', data.toString());
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

  // ── ACPSession interface ────────────────────────────────

  onEvent(callback: (event: ACPEvent) => void): () => void {
    this.emitter.on('acp_event', callback);
    return () => this.emitter.off('acp_event', callback);
  }

  async execute(command: ACPCommand): Promise<void> {
    switch (command.command) {
      case 'send_message':
        if (this.process && this.process.stdin) {
          try {
            this.process.stdin.write(command.message + '\n');
          } catch (error) {
            console.error('Failed to write to stdin:', error);
          }
        } else {
          await this.resumeWithMessage(command.message);
        }
        break;

      case 'approve_tool_call': {
        const pending = this.pendingApprovals.get(command.toolCallId);
        if (pending) {
          pending.resolve(true);
          this.pendingApprovals.delete(command.toolCallId);
        }
        break;
      }

      case 'deny_tool_call': {
        const pending = this.pendingApprovals.get(command.toolCallId);
        if (pending) {
          pending.resolve(false);
          this.pendingApprovals.delete(command.toolCallId);
        }
        break;
      }

      case 'cancel':
        if (this.process) {
          this.process.kill('SIGINT');
        }
        break;

      case 'terminate':
        if (this.process) {
          this.process.kill('SIGTERM');
        }
        if (this.watcher) {
          await this.watcher.close();
          this.watcher = null;
        }
        break;

      case 'resume':
        if (command.prompt) {
          await this.start(this.projectPath, command.prompt);
        }
        break;

      default:
        break;
    }
  }

  /**
   * Resume an existing session with a new message.
   * Uses `claude --resume <id>` to continue the conversation.
   */
  private async resumeWithMessage(message: string): Promise<void> {
    // Ensure projectPath is populated from the JSONL file
    await this.initialReadDone;

    // Emit the user message immediately so mobile sees it right away
    const userMessageId = this.generateId();
    this.emit(
      createEvent(this.sessionId, {
        type: 'message:start' as const,
        messageId: userMessageId,
        role: 'user' as const,
      })
    );
    this.emit(
      createEvent(this.sessionId, {
        type: 'message:complete' as const,
        messageId: userMessageId,
        role: 'user' as const,
        content: [{ type: 'text' as const, text: message }],
      })
    );

    // Suppress file watcher events while the resumed process is running
    // to avoid duplicate ACP events (stdout + file watcher).
    this.suppressFileEvents = true;

    const args = [
      '--resume',
      this.sessionId,
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      message,
    ];

    this.process = spawn('claude', args, {
      cwd: this.projectPath || undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.updateStatus('running');

    let buffer = '';

    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.handleStreamEvent(line);
        }
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('Claude resume stderr:', data.toString());
    });

    this.process.on('close', () => {
      this.process = null;
      this.suppressFileEvents = false;
      // Sync file position so the watcher doesn't re-emit events
      // that were already processed via stdout.
      this.syncFilePosition();
      this.updateStatus('idle');
    });

    this.process.on('error', (error) => {
      this.process = null;
      this.suppressFileEvents = false;
      console.error('Claude resume error:', error);

      this.emit(
        createEvent(this.sessionId, {
          type: 'session:error' as const,
          error: {
            code: 'RESUME_ERROR',
            message: error.message,
            recoverable: true,
          },
        })
      );
    });
  }

  async getHistory(): Promise<ACPEvent[]> {
    await this.initialReadDone;
    return [...this.history];
  }

  refresh(): void {
    this.readNewMessages();
  }

  async detach(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  // ── Internal ────────────────────────────────────────────

  private static readonly MAX_HISTORY = 5000;

  private emit(event: ACPEvent): void {
    if (this.history.length >= ClaudeCodeSession.MAX_HISTORY) {
      this.history = this.history.slice(-Math.floor(ClaudeCodeSession.MAX_HISTORY / 2));
    }
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

  /**
   * Handle streaming JSON event from Claude CLI
   */
  private handleStreamEvent(line: string): void {
    try {
      const event = JSON.parse(line);

      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') {
            this.sessionId = event.session_id || this.sessionId;
            this.emittedEnvInfo = true;

            this.emit(
              createEvent(this.sessionId, {
                type: 'environment:info' as const,
                context: {
                  agent: {
                    name: 'claude-code',
                    version: event.claude_version || '',
                    displayName: 'Claude Code',
                  },
                  model: {
                    id: event.model || '',
                    provider: 'anthropic',
                  },
                  project: {
                    path: this.projectPath,
                    name: this.projectPath.split('/').pop() || 'Unknown',
                  },
                  runtime: {
                    os: process.platform,
                    arch: process.arch,
                    nodeVersion: process.version,
                  },
                },
              })
            );
          }
          break;

        case 'assistant': {
          const content = event.message?.content?.[0]?.text || '';
          const messageId = event.message?.id || this.generateId();

          this.emit(
            createEvent(this.sessionId, {
              type: 'message:start' as const,
              messageId,
              role: 'assistant' as const,
            })
          );

          if (content) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'message:delta' as const,
                messageId,
                role: 'assistant' as const,
                delta: content,
              })
            );
          }

          // Check for thinking content
          const thinkingBlock = event.message?.content?.find(
            (b: { type: string }) => b.type === 'thinking'
          );
          if (thinkingBlock) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'thinking:start' as const,
                messageId,
              })
            );
            if (thinkingBlock.thinking) {
              this.emit(
                createEvent(this.sessionId, {
                  type: 'thinking:delta' as const,
                  messageId,
                  delta: thinkingBlock.thinking,
                })
              );
            }
            this.emit(
              createEvent(this.sessionId, {
                type: 'thinking:complete' as const,
                messageId,
                content: thinkingBlock.thinking || '',
                redacted: !!thinkingBlock.redacted,
              })
            );
          }

          if (event.stop_reason !== null) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'message:complete' as const,
                messageId,
                role: 'assistant' as const,
                content: (event.message?.content || [])
                  .filter((c: { type: string }) => c.type === 'text' || c.type === 'tool_use')
                  .map(
                    (c: {
                      type: string;
                      text?: string;
                      id?: string;
                      name?: string;
                      input?: unknown;
                    }) => {
                      if (c.type === 'text') return { type: 'text', text: c.text || '' };
                      return {
                        type: 'tool_use',
                        toolCallId: c.id || '',
                        name: c.name || '',
                        input: c.input,
                      };
                    }
                  ),
                model: event.model,
                stopReason: event.stop_reason,
              })
            );

            // Extract usage stats if available
            if (event.message?.usage) {
              const usage = event.message.usage;
              this.emit(
                createEvent(this.sessionId, {
                  type: 'resource:token_usage' as const,
                  messageId,
                  delta: {
                    inputTokens: usage.input_tokens || 0,
                    outputTokens: usage.output_tokens || 0,
                    cacheReadTokens: usage.cache_read_input_tokens,
                    cacheWriteTokens: usage.cache_creation_input_tokens,
                  },
                  cumulative: {
                    inputTokens: usage.input_tokens || 0,
                    outputTokens: usage.output_tokens || 0,
                    cacheReadTokens: usage.cache_read_input_tokens,
                    cacheWriteTokens: usage.cache_creation_input_tokens,
                  },
                })
              );
            }
          }
          break;
        }

        case 'user': {
          const userContent = event.message?.content?.[0]?.text || '';
          const userMessageId = this.generateId();

          this.emit(
            createEvent(this.sessionId, {
              type: 'message:start' as const,
              messageId: userMessageId,
              role: 'user' as const,
            })
          );
          this.emit(
            createEvent(this.sessionId, {
              type: 'message:complete' as const,
              messageId: userMessageId,
              role: 'user' as const,
              content: [{ type: 'text' as const, text: userContent }],
            })
          );
          break;
        }

        case 'tool_use': {
          const toolCallId = event.tool_use_id || this.generateId();
          const toolName = event.name;
          const toolInput = event.input || {};

          this.emit(
            createEvent(this.sessionId, {
              type: 'tool:start' as const,
              toolCallId,
              name: toolName,
              category: categorizeTool(toolName),
              description: describeToolCall(toolName, toolInput),
            })
          );

          this.emit(
            createEvent(this.sessionId, {
              type: 'tool:executing' as const,
              toolCallId,
              name: toolName,
              input: toolInput,
              riskLevel: assessRisk(toolName, toolInput),
              requiresApproval: false,
            })
          );
          break;
        }

        case 'tool_result': {
          const resultToolCallId = event.tool_use_id;
          const isError = !!event.is_error;
          const output =
            typeof event.content === 'string' ? event.content : JSON.stringify(event.content);

          if (isError) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'tool:error' as const,
                toolCallId: resultToolCallId,
                name: '',
                error: {
                  code: 'TOOL_ERROR',
                  message: output,
                  recoverable: true,
                },
              })
            );
          } else {
            this.emit(
              createEvent(this.sessionId, {
                type: 'tool:result' as const,
                toolCallId: resultToolCallId,
                name: '',
                output,
                duration: 0,
              })
            );
          }
          break;
        }
      }
    } catch {
      // Ignore parse errors for non-JSON lines
    }
  }

  /**
   * Handle a JSONL conversation file line (attached session mode).
   *
   * Claude Code conversation files use a different format from stream-json:
   *  - tool_use blocks are inside assistant message.content[]
   *  - tool_result blocks are inside user message.content[]
   *  - stop_reason and model live inside event.message
   *  - Extra types like queue-operation, file-history-snapshot exist
   */
  private handleJSONLEvent(line: string): void {
    try {
      const event = JSON.parse(line);

      switch (event.type) {
        case 'user': {
          const contentBlocks = event.message?.content;
          if (!Array.isArray(contentBlocks)) break;

          // Populate projectPath and version from cwd if not yet set
          if (event.cwd && !this.projectPath) {
            this.projectPath = event.cwd;
          }
          if (event.version && !this.claudeVersion) {
            this.claudeVersion = event.version;
          }

          // Collect user text from all text blocks
          const textParts: string[] = [];
          for (const block of contentBlocks) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            }
          }

          const userText = textParts.join('\n');
          const userMessageId = event.uuid || this.generateId();

          if (userText) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'message:start' as const,
                messageId: userMessageId,
                role: 'user' as const,
              })
            );
            this.emit(
              createEvent(this.sessionId, {
                type: 'message:complete' as const,
                messageId: userMessageId,
                role: 'user' as const,
                content: [{ type: 'text' as const, text: userText }],
              })
            );
          }

          // Extract tool_result blocks embedded in user messages
          for (const block of contentBlocks) {
            if (block.type === 'tool_result') {
              const output =
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
              const isError = !!block.is_error;

              if (isError) {
                this.emit(
                  createEvent(this.sessionId, {
                    type: 'tool:error' as const,
                    toolCallId: block.tool_use_id,
                    name: '',
                    error: {
                      code: 'TOOL_ERROR',
                      message: output,
                      recoverable: true,
                    },
                  })
                );
              } else {
                this.emit(
                  createEvent(this.sessionId, {
                    type: 'tool:result' as const,
                    toolCallId: block.tool_use_id,
                    name: '',
                    output,
                    duration: 0,
                  })
                );
              }
            }
          }

          // Agent is now processing — signal "thinking" to mobile
          this.updateStatus('thinking');
          break;
        }

        case 'assistant': {
          // Response arrived — transition out of "thinking"
          this.updateStatus('running');

          const contentBlocks = event.message?.content;
          if (!Array.isArray(contentBlocks)) break;

          const messageId = event.uuid || event.message?.id || this.generateId();

          // Collect all text content
          const textParts: string[] = [];
          for (const block of contentBlocks) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            }
          }
          const fullText = textParts.join('\n');

          // Emit message:start
          this.emit(
            createEvent(this.sessionId, {
              type: 'message:start' as const,
              messageId,
              role: 'assistant' as const,
            })
          );

          // Emit message:delta (JSONL gives full text at once)
          if (fullText) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'message:delta' as const,
                messageId,
                role: 'assistant' as const,
                delta: fullText,
              })
            );
          }

          // Handle thinking blocks
          const thinkingBlock = contentBlocks.find((b: { type: string }) => b.type === 'thinking');
          if (thinkingBlock) {
            this.emit(
              createEvent(this.sessionId, {
                type: 'thinking:start' as const,
                messageId,
              })
            );
            if (thinkingBlock.thinking) {
              this.emit(
                createEvent(this.sessionId, {
                  type: 'thinking:delta' as const,
                  messageId,
                  delta: thinkingBlock.thinking,
                })
              );
            }
            this.emit(
              createEvent(this.sessionId, {
                type: 'thinking:complete' as const,
                messageId,
                content: thinkingBlock.thinking || '',
                redacted: !!thinkingBlock.redacted,
              })
            );
          }

          // Build content array for message:complete
          // Filter out thinking/signature blocks — they're emitted as separate thinking:* events
          const messageContent = contentBlocks
            .filter((c: { type: string }) => c.type === 'text' || c.type === 'tool_use')
            .map(
              (c: { type: string; text?: string; id?: string; name?: string; input?: unknown }) => {
                if (c.type === 'text') return { type: 'text', text: c.text || '' };
                return {
                  type: 'tool_use',
                  toolCallId: c.id || '',
                  name: c.name || '',
                  input: c.input,
                };
              }
            );

          // stop_reason and model live inside event.message for JSONL
          const stopReason = event.message?.stop_reason ?? 'end_turn';
          const model = event.message?.model;

          // Emit environment:info once we see a model (JSONL has no system init event)
          if (model && !this.emittedEnvInfo) {
            this.emittedEnvInfo = true;
            this.emit(
              createEvent(this.sessionId, {
                type: 'environment:info' as const,
                context: {
                  agent: {
                    name: 'claude-code',
                    version: this.claudeVersion,
                    displayName: 'Claude Code',
                  },
                  model: {
                    id: model,
                    provider: 'anthropic',
                  },
                  project: {
                    path: this.projectPath,
                    name: this.projectPath.split('/').pop() || 'Unknown',
                  },
                  runtime: {
                    os: process.platform,
                    arch: process.arch,
                    nodeVersion: process.version,
                  },
                },
              })
            );
          }

          this.emit(
            createEvent(this.sessionId, {
              type: 'message:complete' as const,
              messageId,
              role: 'assistant' as const,
              content: messageContent,
              model,
              stopReason,
            })
          );

          // Extract tool_use blocks → emit tool events
          for (const block of contentBlocks) {
            if (block.type === 'tool_use') {
              const toolCallId = block.id || this.generateId();
              const toolName = block.name || '';
              const toolInput = block.input || {};

              this.emit(
                createEvent(this.sessionId, {
                  type: 'tool:start' as const,
                  toolCallId,
                  name: toolName,
                  category: categorizeTool(toolName),
                  description: describeToolCall(toolName, toolInput),
                })
              );

              this.emit(
                createEvent(this.sessionId, {
                  type: 'tool:executing' as const,
                  toolCallId,
                  name: toolName,
                  input: toolInput,
                  riskLevel: assessRisk(toolName, toolInput),
                  requiresApproval: false,
                })
              );
            }
          }

          // Extract usage stats
          if (event.message?.usage) {
            const usage = event.message.usage;
            this.emit(
              createEvent(this.sessionId, {
                type: 'resource:token_usage' as const,
                messageId,
                delta: {
                  inputTokens: usage.input_tokens || 0,
                  outputTokens: usage.output_tokens || 0,
                  cacheReadTokens: usage.cache_read_input_tokens,
                  cacheWriteTokens: usage.cache_creation_input_tokens,
                },
                cumulative: {
                  inputTokens: usage.input_tokens || 0,
                  outputTokens: usage.output_tokens || 0,
                  cacheReadTokens: usage.cache_read_input_tokens,
                  cacheWriteTokens: usage.cache_creation_input_tokens,
                },
              })
            );
          }
          break;
        }

        // Skip metadata types that have no ACP equivalent
        default:
          break;
      }
    } catch {
      // Ignore parse errors for non-JSON lines
    }
  }

  /**
   * Start watching conversation file for updates (attached sessions)
   */
  private startWatching(): void {
    if (!this.conversationPath) return;

    console.log(`[session:watch] watching ${this.conversationPath}`);

    this.watcher = watch(this.conversationPath, {
      persistent: true,
    });

    this.watcher.on('change', () => {
      console.log(`[session:watch] CHANGE detected for ${this.sessionId}`);
      this.readNewMessages().catch((err) => {
        console.error(`[session:watch] readNewMessages error for ${this.sessionId}:`, err);
      });
    });

    this.readNewMessages().then(() => this.resolveInitialRead());
  }

  private async syncFilePosition(): Promise<void> {
    try {
      const content = await readFile(this.conversationPath, 'utf-8');
      const allLines = content.split('\n');
      this.lastReadPosition =
        allLines[allLines.length - 1] === '' ? allLines.length - 1 : allLines.length;
    } catch {
      // File might not exist yet
    }
  }

  private async readNewMessages(): Promise<void> {
    if (this.suppressFileEvents) return;
    try {
      const content = await readFile(this.conversationPath, 'utf-8');
      const allLines = content.split('\n');
      const newLines = allLines.slice(this.lastReadPosition);

      const nonEmptyLines = newLines.filter((l) => l.trim());
      if (nonEmptyLines.length > 0) {
        console.log(
          `[session:read] ${this.sessionId}: ${nonEmptyLines.length} new lines from pos ${this.lastReadPosition}`
        );
      }

      for (const line of newLines) {
        if (line.trim()) {
          this.handleJSONLEvent(line);
        }
      }

      // Don't count the trailing empty string from split('\n') on
      // newline-terminated files, otherwise the next slice() will
      // skip the first real new line.
      this.lastReadPosition =
        allLines[allLines.length - 1] === '' ? allLines.length - 1 : allLines.length;
    } catch {
      // File might not exist yet
    }
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}

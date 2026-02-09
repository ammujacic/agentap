/**
 * WebSocket + HTTP server for mobile/web client connections — ACP protocol
 *
 * Serves both:
 *   - WebSocket connections (mobile/web clients, same protocol as before)
 *   - HTTP routes via Hono (hook approval API)
 */

import { createServer, type Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Hono } from 'hono';
import type { ACPEvent, ACPCommand, ACPCapabilities } from '@agentap-dev/acp';
import { HookApprovalManager, type HookInput } from './hook-approvals';

export interface WebSocketServerOptions {
  port: number;
  onAuth: (token: string) => Promise<{ valid: boolean; userId?: string }>;
  approvals?: {
    mobileThreshold?: 'low' | 'medium' | 'high' | 'critical';
    requireClient?: boolean;
  };
}

interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
  subscribedSessions: Set<string>;
  replayingHistory?: Set<string>;
}

// ── Wire protocol types (client ↔ daemon) ─────────────────

/** Session info as broadcast to clients */
interface DaemonSessionInfo {
  [key: string]: unknown;
  id: string;
  agent: string;
  machineId: string;
  projectPath: string;
  projectName: string;
  status: string;
  lastMessage: string | null;
  lastActivity: Date;
  createdAt: Date;
  sessionName: string | null;
  model: string | null;
  agentMode: string | null;
}

type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'ping' }
  | { type: 'subscribe'; sessionIds?: string[] }
  | { type: 'unsubscribe'; sessionIds: string[] }
  | {
      type: 'command';
      sessionId: string;
      command: ACPCommand;
    }
  | {
      type: 'start_session';
      agent: string;
      projectPath: string;
      prompt: string;
    }
  | { type: 'terminate_session'; sessionId: string };

type ServerMessage =
  | {
      type: 'auth_success';
      machineName: string;
      machineId: string;
      capabilities: ACPCapabilities[];
    }
  | { type: 'auth_error'; message: string }
  | {
      type: 'sessions_list';
      sessions: DaemonSessionInfo[];
    }
  | { type: 'acp_event'; event: ACPEvent }
  | { type: 'error'; message: string; code: string }
  | { type: 'pong' }
  | { type: 'link_success'; userId: string }
  | { type: 'history_complete'; sessionId: string };

export class AgentapWebSocketServer {
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private clients: Map<WebSocket, AuthenticatedClient> = new Map();
  private options: WebSocketServerOptions;
  private app: Hono;

  /** Hook approval manager — handles PreToolUse approvals */
  public hookApprovals: HookApprovalManager;

  // Event handlers set by the daemon
  public onCommand?: (sessionId: string, command: ACPCommand) => Promise<void>;
  public onStartSession?: (
    agent: string,
    projectPath: string,
    prompt: string
  ) => Promise<DaemonSessionInfo>;
  public onTerminateSession?: (sessionId: string) => Promise<void>;
  public getSessions?: () => Promise<DaemonSessionInfo[]>;
  public getCapabilities?: () => ACPCapabilities[];
  public getSessionHistory?: (sessionId: string) => Promise<ACPEvent[]>;
  public onClientAuthenticated?: () => void;

  constructor(options: WebSocketServerOptions) {
    this.options = options;

    // Create HookApprovalManager
    this.hookApprovals = new HookApprovalManager({
      broadcast: (event) => this.broadcastACPEvent(event),
      getClientCount: () => this.getClientCount(),
      ...options.approvals,
    });

    // Set up Hono for HTTP routes
    this.app = new Hono();
    this.setupHttpRoutes();

    // Create HTTP server that delegates to Hono
    this.httpServer = createServer((req, res) => {
      // Convert Node req/res to fetch Request/Response for Hono
      const url = new URL(req.url ?? '/', `http://localhost:${options.port}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) {
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
      }

      // Collect body for POST requests (limit to 1MB)
      const MAX_BODY_SIZE = 1_048_576;
      const chunks: Buffer[] = [];
      let totalSize = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          aborted = true;
          res.writeHead(413);
          res.end('Request body too large');
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (aborted) return;
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

        const request = new Request(url.toString(), {
          method: req.method,
          headers,
          ...(body && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
        });

        try {
          const response = await this.app.fetch(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          const responseBody = await response.text();
          res.end(responseBody);
        } catch {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      });
    });

    // WebSocket server in noServer mode — upgrades handled by httpServer
    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws) => {
      this.handleConnection(ws);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });

    // Start listening
    this.httpServer.listen(options.port);
  }

  // ── HTTP routes (Hono) ────────────────────────────────

  private setupHttpRoutes(): void {
    // Health check
    this.app.get('/api/hooks/health', (c) => {
      return c.json({ ok: true, pending: this.hookApprovals.pendingCount });
    });

    // Hook approval endpoint (long-poll)
    this.app.post('/api/hooks/approve', async (c) => {
      let input: HookInput;
      try {
        input = await c.req.json<HookInput>();
      } catch {
        return c.json(
          {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'ask',
            },
          },
          400
        );
      }

      // Validate required fields
      if (!input.session_id || !input.tool_name || !input.tool_use_id) {
        return c.json(
          {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'ask',
            },
          },
          400
        );
      }

      // Request approval — this blocks until resolved or timed out
      const decision = await this.hookApprovals.requestApproval(input);

      return c.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          ...(decision === 'allow' && {
            permissionDecisionReason: 'Approved via Agentap mobile',
          }),
          ...(decision === 'deny' && {
            permissionDecisionReason: 'Denied via Agentap mobile',
          }),
        },
      });
    });

    // Catch-all for unknown routes
    this.app.all('*', (c) => {
      return c.json({ error: 'Not found' }, 404);
    });
  }

  // ── WebSocket handling ────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    const authTimeout = setTimeout(() => {
      if (!this.clients.has(ws)) {
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000);

    ws.on('message', async (data) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        await this.handleMessage(ws, message, authTimeout);
      } catch (error) {
        console.error('Error handling message:', error);
        this.send(ws, {
          type: 'error',
          message: 'Invalid message format',
          code: 'INVALID_MESSAGE',
        });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      this.clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket client error:', error);
      this.clients.delete(ws);
    });
  }

  private async handleMessage(
    ws: WebSocket,
    message: ClientMessage,
    authTimeout: NodeJS.Timeout
  ): Promise<void> {
    const client = this.clients.get(ws);

    // Handle auth message (must be first)
    if (message.type === 'auth') {
      const result = await this.options.onAuth(message.token);

      if (result.valid && result.userId) {
        clearTimeout(authTimeout);

        this.clients.set(ws, {
          ws,
          userId: result.userId,
          subscribedSessions: new Set(),
        });

        this.send(ws, {
          type: 'auth_success',
          machineName: process.env.HOSTNAME || 'Local Machine',
          machineId: process.env.MACHINE_ID || 'unknown',
          capabilities: this.getCapabilities?.() ?? [],
        });

        // Send current sessions
        if (this.getSessions) {
          const sessions = await this.getSessions();
          this.send(ws, { type: 'sessions_list', sessions });
        }

        // Notify daemon so it can send an immediate heartbeat
        this.onClientAuthenticated?.();
      } else {
        this.send(ws, {
          type: 'auth_error',
          message: 'Invalid token',
        });
        ws.close(4002, 'Authentication failed');
      }
      return;
    }

    // All other messages require authentication
    if (!client) {
      this.send(ws, {
        type: 'error',
        message: 'Not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    switch (message.type) {
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;

      case 'subscribe':
        if (message.sessionIds) {
          for (const id of message.sessionIds) {
            client.subscribedSessions.add(id);
          }
          // Replay stored history for newly subscribed sessions
          if (this.getSessionHistory) {
            for (const id of message.sessionIds) {
              // Skip if already replaying for this client+session
              if (client.replayingHistory?.has(id)) continue;
              if (!client.replayingHistory) client.replayingHistory = new Set();
              client.replayingHistory.add(id);

              this.getSessionHistory(id)
                .then((events) => {
                  for (const event of events) {
                    if (ws.readyState !== WebSocket.OPEN) return;
                    this.send(ws, {
                      type: 'acp_event',
                      event,
                    });
                  }
                  if (ws.readyState !== WebSocket.OPEN) return;
                  this.send(ws, {
                    type: 'history_complete',
                    sessionId: id,
                  });
                })
                .catch((err) => {
                  console.error(`Failed to replay history for ${id}:`, err);
                  if (ws.readyState === WebSocket.OPEN) {
                    this.send(ws, {
                      type: 'history_complete',
                      sessionId: id,
                    });
                  }
                })
                .finally(() => {
                  client.replayingHistory?.delete(id);
                });
            }
          }
        }
        break;

      case 'unsubscribe':
        message.sessionIds.forEach((id) => client.subscribedSessions.delete(id));
        break;

      case 'command':
        // Try hook approval manager first, then fall through to ACP session
        if (
          message.command.command === 'approve_tool_call' ||
          message.command.command === 'deny_tool_call'
        ) {
          const handled = this.hookApprovals.handleCommand(
            message.command as Parameters<HookApprovalManager['handleCommand']>[0]
          );
          if (handled) break;
        }

        if (this.onCommand) {
          await this.onCommand(message.sessionId, message.command);
        }
        break;

      case 'start_session':
        if (this.onStartSession) {
          await this.onStartSession(message.agent, message.projectPath, message.prompt);
          // Broadcast updated sessions list
          if (this.getSessions) {
            const sessions = await this.getSessions();
            this.broadcastSessionsList(sessions);
          }
        }
        break;

      case 'terminate_session':
        if (this.onTerminateSession) {
          await this.onTerminateSession(message.sessionId);
        }
        break;
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast an ACP event to all subscribed clients
   */
  broadcastACPEvent(event: ACPEvent): void {
    const clientCount = this.clients.size;
    console.log(
      `[ws:broadcast] acp_event type=${event.type} session=${event.sessionId} clients=${clientCount}`
    );
    for (const client of this.clients.values()) {
      if (client.subscribedSessions.size === 0 || client.subscribedSessions.has(event.sessionId)) {
        this.send(client.ws, { type: 'acp_event', event });
      }
    }
  }

  /**
   * Broadcast sessions list update
   */
  broadcastSessionsList(sessions: DaemonSessionInfo[]): void {
    const clientCount = this.clients.size;
    console.log(`[ws:broadcast] sessions_list count=${sessions.length} clients=${clientCount}`);
    for (const client of this.clients.values()) {
      this.send(client.ws, {
        type: 'sessions_list',
        sessions,
      });
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close the server
   */
  close(): Promise<void> {
    this.hookApprovals.cleanup();

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => {
          resolve();
        });
      });
    });
  }
}

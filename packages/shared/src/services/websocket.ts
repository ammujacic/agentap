/**
 * WebSocket client for connecting to Agentap daemon — ACP protocol
 */

import type { ACPEvent, ACPCapabilities } from '@agentap-dev/acp';
import type { ClientMessage, ServerMessage } from '../types/protocol';
import type { AgentSession } from '../types/agent';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WebSocketClientOptions {
  url: string;
  token: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onSessionsUpdate?: (sessions: AgentSession[]) => void;
  onACPEvent?: (event: ACPEvent) => void;
  onCapabilities?: (capabilities: ACPCapabilities[]) => void;
  onHistoryComplete?: (sessionId: string) => void;
  onError?: (error: string) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: WebSocketClientOptions;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
  }

  /**
   * Connect to the daemon WebSocket
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        this.send({ type: 'auth', token: this.options.token });
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        this.cleanup();
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.setStatus('error');
        this.options.onError?.('WebSocket connection error');
      };
    } catch (error) {
      this.setStatus('error');
      this.options.onError?.(`Failed to connect: ${error}`);
    }
  }

  /**
   * Disconnect from the daemon
   */
  disconnect(): void {
    this.cleanup();
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  /**
   * Send a raw protocol message
   */
  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Subscribe to specific sessions
   */
  subscribe(sessionIds?: string[]): void {
    this.send({ type: 'subscribe', sessionIds });
  }

  /**
   * Unsubscribe from sessions
   */
  unsubscribe(sessionIds: string[]): void {
    this.send({ type: 'unsubscribe', sessionIds });
  }

  /**
   * Send a message to an agent session via ACP command
   */
  sendMessage(sessionId: string, message: string): void {
    this.send({
      type: 'command',
      sessionId,
      command: { command: 'send_message', message },
    });
  }

  /**
   * Approve a tool call via ACP command
   */
  approveToolCall(sessionId: string, requestId: string, toolCallId: string): void {
    this.send({
      type: 'command',
      sessionId,
      command: {
        command: 'approve_tool_call',
        requestId,
        toolCallId,
      },
    });
  }

  /**
   * Deny a tool call via ACP command
   */
  denyToolCall(sessionId: string, requestId: string, toolCallId: string, reason?: string): void {
    this.send({
      type: 'command',
      sessionId,
      command: {
        command: 'deny_tool_call',
        requestId,
        toolCallId,
        reason,
      },
    });
  }

  /**
   * Start a new agent session
   */
  startSession(agent: string, projectPath: string, prompt: string): void {
    this.send({
      type: 'start_session',
      agent,
      projectPath,
      prompt,
    });
  }

  /**
   * Terminate a session
   */
  terminateSession(sessionId: string): void {
    this.send({ type: 'terminate_session', sessionId });
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  private handleMessage(data: string): void {
    try {
      const message: ServerMessage = JSON.parse(data);

      switch (message.type) {
        case 'auth_success':
          this.setStatus('connected');
          this.reconnectAttempts = 0;
          this.startPing();
          this.options.onCapabilities?.(message.capabilities);
          break;

        case 'auth_error':
          this.setStatus('error');
          this.options.onError?.(message.message);
          this.disconnect();
          break;

        case 'sessions_list':
          this.options.onSessionsUpdate?.(message.sessions);
          break;

        case 'acp_event':
          this.options.onACPEvent?.(message.event);
          break;

        case 'history_complete':
          this.options.onHistoryComplete?.(message.sessionId);
          break;

        case 'error':
          this.options.onError?.(message.message);
          break;

        case 'pong':
          break;
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange?.(status);
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.options.onError?.('Max reconnection attempts reached');
      return;
    }

    const base = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    const delay = base + Math.random() * Math.min(base, 5000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

/**
 * Create WebSocket client
 */
export function createWebSocketClient(
  tunnelUrl: string,
  token: string,
  handlers: Partial<WebSocketClientOptions> = {}
): WebSocketClient {
  const wsUrl = tunnelUrl.replace(/^http/, 'ws') + '/ws';

  return new WebSocketClient({
    url: wsUrl,
    token,
    ...handlers,
  });
}

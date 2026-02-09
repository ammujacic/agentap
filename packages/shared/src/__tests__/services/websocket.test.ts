import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebSocketClient,
  createWebSocketClient,
  type WebSocketClientOptions,
} from '../../services/websocket';

// ---------------------------------------------------------------------------
// MockWebSocket – simulates the browser/Bun WebSocket API
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;

  url: string;
  readyState = MockWebSocket.OPEN;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  sent: string[] = [];

  constructor(url: string) {
    MockWebSocket.instances.push(this);
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Helpers for tests --------------------------------------------------

  /** All MockWebSocket instances created during the test */
  static instances: MockWebSocket[] = [];

  /** Simulate the server opening the connection */
  simulateOpen(): void {
    this.onopen?.();
  }

  /** Simulate receiving a server message */
  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Simulate the connection closing */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Simulate a connection error */
  simulateError(): void {
    this.onerror?.({} as Event);
  }

  /** Return all sent messages as parsed objects */
  get sentMessages(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function createOptions(overrides: Partial<WebSocketClientOptions> = {}): WebSocketClientOptions {
  return {
    url: 'ws://localhost:9876/ws',
    token: 'test-token-123',
    onStatusChange: vi.fn(),
    onSessionsUpdate: vi.fn(),
    onACPEvent: vi.fn(),
    onCapabilities: vi.fn(),
    onHistoryComplete: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

/** Convenience: create client, connect, and open the mock WS */
function connectClient(opts?: Partial<WebSocketClientOptions>) {
  const options = createOptions(opts);
  const client = new WebSocketClient(options);
  client.connect();
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.simulateOpen();
  return { client, ws, options };
}

/** Convenience: create client, connect, open, and authenticate */
function authenticatedClient(opts?: Partial<WebSocketClientOptions>) {
  const { client, ws, options } = connectClient(opts);
  ws.simulateMessage({
    type: 'auth_success',
    machineName: 'test-machine',
    machineId: 'machine-1',
    capabilities: [{ agent: 'claude-code', supportedCommands: [] }],
  });
  return { client, ws, options };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ======================================================================
  // connect()
  // ======================================================================

  describe('connect()', () => {
    it('creates a WebSocket with the correct URL', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('ws://localhost:9876/ws');
    });

    it('sets status to "connecting"', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      expect(options.onStatusChange).toHaveBeenCalledWith('connecting');
      expect(client.getStatus()).toBe('connecting');
    });

    it('sends auth message on open', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      expect(ws.sentMessages).toEqual([{ type: 'auth', token: 'test-token-123' }]);
    });

    it('calls onStatusChange callback', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      expect(options.onStatusChange).toHaveBeenCalledTimes(1);
      expect(options.onStatusChange).toHaveBeenCalledWith('connecting');
    });

    it('does not create a new WebSocket if already OPEN', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      // The mock starts with readyState = OPEN by default, but the actual
      // connect path sets handlers and then the WS may still be OPEN.
      // Simulate the WS being fully open:
      const ws = MockWebSocket.instances[0];
      ws.readyState = MockWebSocket.OPEN;

      // Try connecting again
      client.connect();

      // Should still only have 1 instance
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('sets status to "error" on WebSocket error', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateError();

      expect(client.getStatus()).toBe('error');
      expect(options.onStatusChange).toHaveBeenCalledWith('error');
    });

    it('calls onError on WebSocket error', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateError();

      expect(options.onError).toHaveBeenCalledWith('WebSocket connection error');
    });
  });

  // ======================================================================
  // disconnect()
  // ======================================================================

  describe('disconnect()', () => {
    it('closes the WebSocket', () => {
      const { ws } = connectClient();
      const closeSpy = vi.spyOn(ws, 'close');

      // Need to get client reference
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();
      const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws2.simulateOpen();

      client.disconnect();

      expect(ws2.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('sets status to "disconnected"', () => {
      const { client, options } = connectClient();
      client.disconnect();

      expect(client.getStatus()).toBe('disconnected');
    });

    it('cleans up ping interval', () => {
      const { client, ws } = authenticatedClient();

      // Ping interval is now active. Advance 30s to verify it fires.
      vi.advanceTimersByTime(30000);
      const pingSentBefore = ws.sentMessages.filter((m: any) => m.type === 'ping').length;
      expect(pingSentBefore).toBe(1);

      client.disconnect();

      // Clear the sent messages list from before disconnect
      ws.sent.length = 0;

      // Advance another 30s; no more pings should arrive
      vi.advanceTimersByTime(30000);
      expect(ws.sent).toHaveLength(0);
    });

    it('cleans up reconnect timeout', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      // Trigger a close to schedule a reconnect
      ws.simulateClose();

      // Now disconnect to cancel the scheduled reconnect
      client.disconnect();

      // Advance past the reconnect delay; should NOT create a new WS
      const instanceCountBefore = MockWebSocket.instances.length;
      vi.advanceTimersByTime(60000);
      // The only new instance should not have been created by reconnect
      // (disconnect itself might have been the last action)
      expect(MockWebSocket.instances.length).toBe(instanceCountBefore);
    });
  });

  // ======================================================================
  // send()
  // ======================================================================

  describe('send()', () => {
    it('sends JSON stringified message when WebSocket is open', () => {
      const { client, ws } = connectClient();

      client.send({ type: 'ping' });

      // First message is auth, second is our ping
      expect(ws.sentMessages).toContainEqual({ type: 'ping' });
    });

    it('does nothing when WebSocket is not open', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);

      // Never connected, ws is null
      client.send({ type: 'ping' });

      // No instances created, nothing sent
      expect(MockWebSocket.instances).toHaveLength(0);
    });
  });

  // ======================================================================
  // subscribe() / unsubscribe()
  // ======================================================================

  describe('subscribe()', () => {
    it('sends subscribe message without sessionIds', () => {
      const { client, ws } = connectClient();

      client.subscribe();

      expect(ws.sentMessages).toContainEqual({
        type: 'subscribe',
        sessionIds: undefined,
      });
    });

    it('sends subscribe message with sessionIds', () => {
      const { client, ws } = connectClient();

      client.subscribe(['session-1', 'session-2']);

      expect(ws.sentMessages).toContainEqual({
        type: 'subscribe',
        sessionIds: ['session-1', 'session-2'],
      });
    });
  });

  describe('unsubscribe()', () => {
    it('sends unsubscribe message with sessionIds', () => {
      const { client, ws } = connectClient();

      client.unsubscribe(['session-1']);

      expect(ws.sentMessages).toContainEqual({
        type: 'unsubscribe',
        sessionIds: ['session-1'],
      });
    });
  });

  // ======================================================================
  // sendMessage()
  // ======================================================================

  describe('sendMessage()', () => {
    it('sends command message with send_message ACP command', () => {
      const { client, ws } = connectClient();

      client.sendMessage('session-1', 'Hello agent');

      expect(ws.sentMessages).toContainEqual({
        type: 'command',
        sessionId: 'session-1',
        command: { command: 'send_message', message: 'Hello agent' },
      });
    });
  });

  // ======================================================================
  // approveToolCall()
  // ======================================================================

  describe('approveToolCall()', () => {
    it('sends command with approve_tool_call', () => {
      const { client, ws } = connectClient();

      client.approveToolCall('session-1', 'req-1', 'tool-1');

      expect(ws.sentMessages).toContainEqual({
        type: 'command',
        sessionId: 'session-1',
        command: {
          command: 'approve_tool_call',
          requestId: 'req-1',
          toolCallId: 'tool-1',
        },
      });
    });
  });

  // ======================================================================
  // denyToolCall()
  // ======================================================================

  describe('denyToolCall()', () => {
    it('sends command with deny_tool_call and reason', () => {
      const { client, ws } = connectClient();

      client.denyToolCall('session-1', 'req-1', 'tool-1', 'Too risky');

      expect(ws.sentMessages).toContainEqual({
        type: 'command',
        sessionId: 'session-1',
        command: {
          command: 'deny_tool_call',
          requestId: 'req-1',
          toolCallId: 'tool-1',
          reason: 'Too risky',
        },
      });
    });

    it('sends command with deny_tool_call without reason', () => {
      const { client, ws } = connectClient();

      client.denyToolCall('session-1', 'req-1', 'tool-1');

      expect(ws.sentMessages).toContainEqual({
        type: 'command',
        sessionId: 'session-1',
        command: {
          command: 'deny_tool_call',
          requestId: 'req-1',
          toolCallId: 'tool-1',
          reason: undefined,
        },
      });
    });
  });

  // ======================================================================
  // startSession()
  // ======================================================================

  describe('startSession()', () => {
    it('sends start_session message', () => {
      const { client, ws } = connectClient();

      client.startSession('claude-code', '/projects/app', 'Fix the bug');

      expect(ws.sentMessages).toContainEqual({
        type: 'start_session',
        agent: 'claude-code',
        projectPath: '/projects/app',
        prompt: 'Fix the bug',
      });
    });
  });

  // ======================================================================
  // terminateSession()
  // ======================================================================

  describe('terminateSession()', () => {
    it('sends terminate_session message', () => {
      const { client, ws } = connectClient();

      client.terminateSession('session-1');

      expect(ws.sentMessages).toContainEqual({
        type: 'terminate_session',
        sessionId: 'session-1',
      });
    });
  });

  // ======================================================================
  // handleMessage() (via simulated onmessage)
  // ======================================================================

  describe('handleMessage()', () => {
    it('auth_success: sets status to "connected" and calls onCapabilities', () => {
      const { client, options } = connectClient();
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      const capabilities = [{ agent: 'claude-code', supportedCommands: [] }];
      ws.simulateMessage({
        type: 'auth_success',
        machineName: 'test-machine',
        machineId: 'machine-1',
        capabilities,
      });

      expect(client.getStatus()).toBe('connected');
      expect(options.onStatusChange).toHaveBeenCalledWith('connected');
      expect(options.onCapabilities).toHaveBeenCalledWith(capabilities);
    });

    it('auth_success: resets reconnect attempts', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);

      // First connect and close to increment reconnect attempts
      client.connect();
      const ws1 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws1.simulateOpen();
      ws1.simulateClose(); // triggers scheduleReconnect, attempts = 1

      // Advance timer to trigger reconnect
      vi.advanceTimersByTime(1000);
      const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws2.simulateOpen();

      // Now authenticate successfully - should reset attempts
      ws2.simulateMessage({
        type: 'auth_success',
        machineName: 'test-machine',
        machineId: 'machine-1',
        capabilities: [],
      });

      // Close again - if attempts were reset, it should start from 0
      ws2.simulateClose();

      // Advance by initial delay (1000ms) - should reconnect
      vi.advanceTimersByTime(1000);

      // A new connection should have been attempted
      expect(MockWebSocket.instances.length).toBeGreaterThan(2);
    });

    it('auth_success: starts ping interval', () => {
      const { ws } = authenticatedClient();

      // Clear the auth message from sent
      ws.sent.length = 0;

      // Advance 30 seconds
      vi.advanceTimersByTime(30000);

      expect(ws.sentMessages).toContainEqual({ type: 'ping' });
    });

    it('auth_error: sets status to "error", calls onError, and disconnects', () => {
      const { client, ws, options } = connectClient();

      ws.simulateMessage({
        type: 'auth_error',
        message: 'Invalid token',
      });

      expect(options.onError).toHaveBeenCalledWith('Invalid token');
      // After auth_error, disconnect() is called which sets status to 'disconnected'
      // but setStatus('error') is called first
      expect(options.onStatusChange).toHaveBeenCalledWith('error');
      expect(client.getStatus()).toBe('disconnected');
    });

    it('sessions_list: calls onSessionsUpdate', () => {
      const { ws, options } = connectClient();
      const sessions = [
        {
          id: 'session-1',
          agent: 'claude-code',
          machineId: 'machine-1',
          projectPath: '/app',
          projectName: 'app',
          status: 'running',
          lastMessage: null,
          lastActivity: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          sessionName: null,
          model: null,
          agentMode: null,
        },
      ];

      ws.simulateMessage({ type: 'sessions_list', sessions });

      expect(options.onSessionsUpdate).toHaveBeenCalledWith(sessions);
    });

    it('acp_event: calls onACPEvent', () => {
      const { ws, options } = connectClient();
      const event = {
        type: 'session.started',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
      };

      ws.simulateMessage({ type: 'acp_event', event });

      expect(options.onACPEvent).toHaveBeenCalledWith(event);
    });

    it('history_complete: calls onHistoryComplete', () => {
      const { ws, options } = connectClient();

      ws.simulateMessage({
        type: 'history_complete',
        sessionId: 'session-42',
      });

      expect(options.onHistoryComplete).toHaveBeenCalledWith('session-42');
    });

    it('error: calls onError', () => {
      const { ws, options } = connectClient();

      ws.simulateMessage({
        type: 'error',
        message: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      });

      expect(options.onError).toHaveBeenCalledWith('Something went wrong');
    });

    it('pong: does not crash or trigger any callback', () => {
      const { ws, options } = connectClient();

      // Reset mocks to track only calls after this point
      vi.mocked(options.onError!).mockClear();
      vi.mocked(options.onSessionsUpdate!).mockClear();
      vi.mocked(options.onACPEvent!).mockClear();
      vi.mocked(options.onCapabilities!).mockClear();
      vi.mocked(options.onHistoryComplete!).mockClear();

      ws.simulateMessage({ type: 'pong' });

      expect(options.onError).not.toHaveBeenCalled();
      expect(options.onSessionsUpdate).not.toHaveBeenCalled();
      expect(options.onACPEvent).not.toHaveBeenCalled();
      expect(options.onCapabilities).not.toHaveBeenCalled();
      expect(options.onHistoryComplete).not.toHaveBeenCalled();
    });

    it('invalid JSON: logs error, no crash', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.simulateOpen();

      // Directly invoke onmessage with invalid JSON
      ws.onmessage?.({ data: 'not valid json{{{' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to parse WebSocket message:',
        expect.any(SyntaxError)
      );

      // Should not crash - client should still be operational
      expect(client.getStatus()).toBe('connecting');
    });
  });

  // ======================================================================
  // Ping mechanism
  // ======================================================================

  describe('ping mechanism', () => {
    it('sends ping every 30 seconds after auth_success', () => {
      const { ws } = authenticatedClient();

      // Clear sent messages to track only pings
      ws.sent.length = 0;

      vi.advanceTimersByTime(30000);
      expect(ws.sentMessages).toHaveLength(1);
      expect(ws.sentMessages[0]).toEqual({ type: 'ping' });

      vi.advanceTimersByTime(30000);
      expect(ws.sentMessages).toHaveLength(2);
      expect(ws.sentMessages[1]).toEqual({ type: 'ping' });

      vi.advanceTimersByTime(30000);
      expect(ws.sentMessages).toHaveLength(3);
    });

    it('cleanup stops ping interval', () => {
      const { client, ws } = authenticatedClient();

      // Clear sent messages
      ws.sent.length = 0;

      client.disconnect();

      vi.advanceTimersByTime(90000);
      expect(ws.sent).toHaveLength(0);
    });
  });

  // ======================================================================
  // Reconnection
  // ======================================================================

  describe('reconnection', () => {
    it('schedules reconnect on close with exponential backoff', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      const ws1 = MockWebSocket.instances[0];
      ws1.simulateOpen();
      ws1.simulateClose();

      // First reconnect after 1000ms (1000 * 2^0)
      expect(MockWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(999);
      expect(MockWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('first delay is 1000ms, second 2000ms, third 4000ms', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      // Close #1 -> delay = 1000ms
      const ws1 = MockWebSocket.instances[0];
      ws1.simulateOpen();
      ws1.simulateClose();

      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(2);

      // Close #2 -> delay = 2000ms
      const ws2 = MockWebSocket.instances[1];
      ws2.simulateOpen();
      ws2.simulateClose();

      vi.advanceTimersByTime(1999);
      expect(MockWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(3);

      // Close #3 -> delay = 4000ms
      const ws3 = MockWebSocket.instances[2];
      ws3.simulateOpen();
      ws3.simulateClose();

      vi.advanceTimersByTime(3999);
      expect(MockWebSocket.instances).toHaveLength(3);
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(4);
    });

    it('stops after maxReconnectAttempts (5)', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      // Exhaust all 5 reconnect attempts
      for (let i = 0; i < 5; i++) {
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        ws.simulateOpen();
        ws.simulateClose();

        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        vi.advanceTimersByTime(delay);
      }

      // Now the 6th close should not reconnect
      const wsLast = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      wsLast.simulateOpen();
      wsLast.simulateClose();

      const instanceCount = MockWebSocket.instances.length;
      vi.advanceTimersByTime(60000);
      expect(MockWebSocket.instances).toHaveLength(instanceCount);
    });

    it('calls onError when max attempts reached', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      // Exhaust all 5 reconnect attempts
      for (let i = 0; i < 5; i++) {
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        ws.simulateOpen();
        ws.simulateClose();

        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        vi.advanceTimersByTime(delay);
      }

      // 6th close - max reached
      vi.mocked(options.onError!).mockClear();
      const wsLast = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      wsLast.simulateOpen();
      wsLast.simulateClose();

      expect(options.onError).toHaveBeenCalledWith('Max reconnection attempts reached');
    });

    it('resets reconnect counter on successful auth', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();

      // Simulate 3 failed reconnect cycles (attempts goes 0->1->2->3)
      for (let i = 0; i < 3; i++) {
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        ws.simulateOpen();
        ws.simulateClose();
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        vi.advanceTimersByTime(delay);
      }

      // Now authenticate successfully - resets attempts to 0
      const wsAuth = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      wsAuth.simulateOpen();
      wsAuth.simulateMessage({
        type: 'auth_success',
        machineName: 'test-machine',
        machineId: 'machine-1',
        capabilities: [],
      });

      // Close again - attempts should be reset to 0
      wsAuth.simulateClose();

      // Should reconnect after 1000ms (2^0 * 1000, not 2^3 * 1000)
      vi.advanceTimersByTime(1000);
      const wsAfterReset = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(wsAfterReset).not.toBe(wsAuth);

      // Now exhaust the remaining 4 attempts (attempts is now 1 after the
      // first post-reset close). We need 4 more close+reconnect cycles
      // to reach attempts=5.
      for (let i = 1; i < 5; i++) {
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        ws.simulateOpen();
        ws.simulateClose();
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        vi.advanceTimersByTime(delay);
      }

      // Now attempts=5. The next close triggers "Max reconnection attempts reached".
      vi.mocked(options.onError!).mockClear();
      const wsFinal = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      wsFinal.simulateOpen();
      wsFinal.simulateClose();

      expect(options.onError).toHaveBeenCalledWith('Max reconnection attempts reached');
    });
  });

  // ======================================================================
  // getStatus()
  // ======================================================================

  describe('getStatus()', () => {
    it('returns "disconnected" initially', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      expect(client.getStatus()).toBe('disconnected');
    });

    it('returns "connecting" after connect()', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();
      expect(client.getStatus()).toBe('connecting');
    });

    it('returns "connected" after auth_success', () => {
      const { client } = authenticatedClient();
      expect(client.getStatus()).toBe('connected');
    });

    it('returns "error" after WebSocket error', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);
      client.connect();
      const ws = MockWebSocket.instances[0];
      ws.simulateError();
      expect(client.getStatus()).toBe('error');
    });
  });

  // ======================================================================
  // setStatus() deduplication
  // ======================================================================

  describe('setStatus() deduplication', () => {
    it('does not call onStatusChange if status has not changed', () => {
      const options = createOptions();
      const client = new WebSocketClient(options);

      // Status is initially 'disconnected'
      // Calling disconnect again should not fire onStatusChange
      client.disconnect();

      expect(options.onStatusChange).not.toHaveBeenCalled();
    });
  });
});

// ========================================================================
// createWebSocketClient()
// ========================================================================

describe('createWebSocketClient()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('converts http:// to ws://', () => {
    const client = createWebSocketClient('http://localhost:9876', 'token-abc');
    client.connect();

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('ws://localhost:9876/ws');
  });

  it('converts https:// to wss://', () => {
    const client = createWebSocketClient('https://my-tunnel.example.com', 'token-abc');
    client.connect();

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('wss://my-tunnel.example.com/ws');
  });

  it('appends /ws to the URL', () => {
    const client = createWebSocketClient('http://localhost:9876', 'token-abc');
    client.connect();

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain('/ws');
  });

  it('passes token and handlers', () => {
    const onError = vi.fn();
    const onStatusChange = vi.fn();

    const client = createWebSocketClient('http://localhost:9876', 'my-token', {
      onError,
      onStatusChange,
    });
    client.connect();

    expect(onStatusChange).toHaveBeenCalledWith('connecting');

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Verify token is sent in auth message
    expect(ws.sentMessages[0]).toEqual({
      type: 'auth',
      token: 'my-token',
    });
  });
});

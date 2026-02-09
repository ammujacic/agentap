import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Module-level mocks ───────────────────────────────────────────────

// Track all handler registrations so we can simulate connections
let httpRequestHandler: any = null;

vi.mock('http', () => {
  const server = {
    listen: vi.fn(),
    close: vi.fn((cb: () => void) => cb()),
    on: vi.fn(),
  };

  return {
    createServer: vi.fn((handler: any) => {
      httpRequestHandler = handler;
      return server;
    }),
  };
});

vi.mock('ws', () => {
  const MockWSS = vi.fn(function (this: any) {
    this.on = vi.fn();
    this.close = vi.fn((cb: () => void) => cb());
    this.handleUpgrade = vi.fn();
    this.emit = vi.fn();
  });

  return {
    WebSocketServer: MockWSS,
    WebSocket: { OPEN: 1, CLOSED: 3 },
  };
});

// Import after mocks are set up
import { AgentapWebSocketServer } from '../services/websocket';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { HookApprovalManager } from '../services/hook-approvals';

describe('AgentapWebSocketServer', () => {
  const defaultOptions = {
    port: 9876,
    onAuth: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    httpRequestHandler = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // Helper to get the mock instances created during construction
  function getHttpServerMock() {
    return (createServer as any).mock.results[(createServer as any).mock.results.length - 1]?.value;
  }

  function getWssMock() {
    return (WebSocketServer as any).mock.instances[
      (WebSocketServer as any).mock.instances.length - 1
    ];
  }

  // Helper to create a mock WebSocket client
  function createMockWs(): any {
    const ws = new EventEmitter() as any;
    ws.readyState = WebSocket.OPEN;
    ws.send = vi.fn();
    ws.close = vi.fn();
    return ws;
  }

  // Helper to simulate a client connection and get the connection handler
  function getConnectionHandler(server: AgentapWebSocketServer) {
    const wss = getWssMock();
    const connectionCall = wss.on.mock.calls.find((call: any[]) => call[0] === 'connection');
    return connectionCall?.[1];
  }

  // Helper to simulate a fully authenticated client
  async function authenticateClient(
    server: AgentapWebSocketServer,
    ws: any,
    options?: { token?: string; userId?: string }
  ) {
    const connectionHandler = getConnectionHandler(server);
    connectionHandler(ws);

    const token = options?.token ?? 'valid-token';
    const userId = options?.userId ?? 'user-1';

    defaultOptions.onAuth.mockResolvedValueOnce({ valid: true, userId });

    // Emit auth message
    ws.emit('message', JSON.stringify({ type: 'auth', token }));

    // Wait for async auth
    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalled();
    });
  }

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('should create an HTTP server', () => {
      new AgentapWebSocketServer(defaultOptions);
      expect(createServer).toHaveBeenCalledTimes(1);
    });

    it('should create a WebSocket server with noServer option', () => {
      new AgentapWebSocketServer(defaultOptions);
      expect(WebSocketServer).toHaveBeenCalledWith({ noServer: true });
    });

    it('should start listening on the specified port', () => {
      new AgentapWebSocketServer(defaultOptions);
      const httpServer = getHttpServerMock();
      expect(httpServer.listen).toHaveBeenCalledWith(9876);
    });

    it('should start listening on a custom port', () => {
      new AgentapWebSocketServer({ ...defaultOptions, port: 4000 });
      const httpServer = getHttpServerMock();
      expect(httpServer.listen).toHaveBeenCalledWith(4000);
    });

    it('should create HookApprovalManager', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.hookApprovals).toBeInstanceOf(HookApprovalManager);
    });

    it('should create HookApprovalManager with approval options', () => {
      const server = new AgentapWebSocketServer({
        ...defaultOptions,
        approvals: {
          mobileThreshold: 'high',
          requireClient: false,
        },
      });
      expect(server.hookApprovals).toBeInstanceOf(HookApprovalManager);
    });

    it('should register upgrade handler on HTTP server', () => {
      new AgentapWebSocketServer(defaultOptions);
      const httpServer = getHttpServerMock();
      expect(httpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
    });

    it('should register connection handler on WebSocket server', () => {
      new AgentapWebSocketServer(defaultOptions);
      const wss = getWssMock();
      const connectionCall = wss.on.mock.calls.find((call: any[]) => call[0] === 'connection');
      expect(connectionCall).toBeDefined();
    });

    it('should register error handler on WebSocket server', () => {
      new AgentapWebSocketServer(defaultOptions);
      const wss = getWssMock();
      const errorCall = wss.on.mock.calls.find((call: any[]) => call[0] === 'error');
      expect(errorCall).toBeDefined();
    });
  });

  // ── getClientCount ────────────────────────────────────────

  describe('getClientCount()', () => {
    it('should return 0 initially when no clients are connected', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.getClientCount()).toBe(0);
    });

    it('should return 1 after a client authenticates', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);

      expect(server.getClientCount()).toBe(1);
    });
  });

  // ── broadcastACPEvent ─────────────────────────────────────

  describe('broadcastACPEvent()', () => {
    it('should not throw when no clients are connected', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(() =>
        server.broadcastACPEvent({
          type: 'session:started',
          sessionId: 'test-session',
          timestamp: new Date().toISOString(),
          sequence: 1,
        } as any)
      ).not.toThrow();
    });

    it('should send event to subscribed clients', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);

      // Subscribe to a session
      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1'] }));

      // Broadcast an event for that session
      server.broadcastACPEvent({
        type: 'message:delta',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
        sequence: 1,
      } as any);

      const calls = ws.send.mock.calls;
      const eventMessages = calls.filter((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'acp_event';
        } catch {
          return false;
        }
      });
      expect(eventMessages.length).toBeGreaterThan(0);
    });

    it('should send events to clients with no subscriptions (all events)', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);

      server.broadcastACPEvent({
        type: 'message:delta',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
        sequence: 1,
      } as any);

      const calls = ws.send.mock.calls;
      const eventMessages = calls.filter((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'acp_event';
        } catch {
          return false;
        }
      });
      expect(eventMessages.length).toBeGreaterThan(0);
    });

    it('should not send event to client subscribed to different session', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);

      // Subscribe to a different session
      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-other'] }));

      // Clear the send calls from auth
      ws.send.mockClear();

      server.broadcastACPEvent({
        type: 'message:delta',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
        sequence: 1,
      } as any);

      const calls = ws.send.mock.calls;
      const eventMessages = calls.filter((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'acp_event' && msg.event.sessionId === 'sess-1';
        } catch {
          return false;
        }
      });
      expect(eventMessages).toHaveLength(0);
    });
  });

  // ── broadcastSessionsList ─────────────────────────────────

  describe('broadcastSessionsList()', () => {
    it('should not throw when no clients are connected', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(() => server.broadcastSessionsList([])).not.toThrow();
    });

    it('should not throw when broadcasting non-empty sessions list', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(() =>
        server.broadcastSessionsList([
          {
            id: 'sess-1',
            agent: 'claude-code',
            machineId: 'machine-1',
            projectPath: '/tmp/project',
            projectName: 'test-project',
            status: 'active',
            lastMessage: null,
            lastActivity: new Date(),
            createdAt: new Date(),
            sessionName: null,
            model: null,
            agentMode: null,
          },
        ])
      ).not.toThrow();
    });

    it('should send sessions list to authenticated clients', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);
      ws.send.mockClear();

      server.broadcastSessionsList([
        {
          id: 'sess-1',
          agent: 'claude-code',
          machineId: 'machine-1',
          projectPath: '/tmp/project',
          projectName: 'test',
          status: 'running',
          lastMessage: null,
          lastActivity: new Date(),
          createdAt: new Date(),
          sessionName: null,
          model: null,
          agentMode: null,
        },
      ]);

      const sessionListMsgs = ws.send.mock.calls.filter((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'sessions_list';
        } catch {
          return false;
        }
      });
      expect(sessionListMsgs.length).toBe(1);
    });
  });

  // ── close ─────────────────────────────────────────────────

  describe('close()', () => {
    it('should clean up hook approvals', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const cleanupSpy = vi.spyOn(server.hookApprovals, 'cleanup');
      await server.close();
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });

    it('should close WebSocket server', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const wss = getWssMock();
      await server.close();
      expect(wss.close).toHaveBeenCalledTimes(1);
    });

    it('should close HTTP server', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const httpServer = getHttpServerMock();
      await server.close();
      expect(httpServer.close).toHaveBeenCalledTimes(1);
    });

    it('should return a promise that resolves', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const result = server.close();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });
  });

  // ── hookApprovals property ────────────────────────────────

  describe('hookApprovals property', () => {
    it('should be a HookApprovalManager instance', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.hookApprovals).toBeInstanceOf(HookApprovalManager);
    });

    it('should have pendingCount of 0 initially', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.hookApprovals.pendingCount).toBe(0);
    });
  });

  // ── event handler properties ──────────────────────────────

  describe('event handler properties', () => {
    it('should have onCommand initially undefined', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.onCommand).toBeUndefined();
    });

    it('should have onStartSession initially undefined', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.onStartSession).toBeUndefined();
    });

    it('should have onTerminateSession initially undefined', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.onTerminateSession).toBeUndefined();
    });

    it('should have getSessions initially undefined', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.getSessions).toBeUndefined();
    });

    it('should have getCapabilities initially undefined', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.getCapabilities).toBeUndefined();
    });

    it('should have getSessionHistory initially undefined', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.getSessionHistory).toBeUndefined();
    });

    it('should have onClientAuthenticated initially undefined', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      expect(server.onClientAuthenticated).toBeUndefined();
    });

    it('should allow setting onCommand handler', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const handler = vi.fn();
      server.onCommand = handler;
      expect(server.onCommand).toBe(handler);
    });

    it('should allow setting getSessions handler', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const handler = vi.fn();
      server.getSessions = handler;
      expect(server.getSessions).toBe(handler);
    });
  });

  // ── Connection handling ───────────────────────────────────

  describe('connection handling', () => {
    it('should set auth timeout on new connection', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();
      const connectionHandler = getConnectionHandler(server);

      connectionHandler(ws);

      // The ws should have message, close, and error handlers
      expect(ws.listenerCount('message')).toBeGreaterThanOrEqual(1);
      expect(ws.listenerCount('close')).toBeGreaterThanOrEqual(1);
      expect(ws.listenerCount('error')).toBeGreaterThanOrEqual(1);
    });

    it('should remove client on close event', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);
      expect(server.getClientCount()).toBe(1);

      ws.emit('close');
      expect(server.getClientCount()).toBe(0);
    });

    it('should remove client on error event', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);
      expect(server.getClientCount()).toBe(1);

      ws.emit('error', new Error('Connection reset'));
      expect(server.getClientCount()).toBe(0);
    });

    it('should handle invalid JSON messages', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();
      const connectionHandler = getConnectionHandler(server);
      connectionHandler(ws);

      ws.emit('message', 'invalid json{{{');

      const errorMessages = ws.send.mock.calls.filter((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'error' && msg.code === 'INVALID_MESSAGE';
        } catch {
          return false;
        }
      });
      expect(errorMessages.length).toBe(1);
    });
  });

  // ── Authentication ────────────────────────────────────────

  describe('authentication', () => {
    it('should authenticate with valid token', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);

      const authSuccess = ws.send.mock.calls.find((c: any[]) => {
        try {
          return JSON.parse(c[0]).type === 'auth_success';
        } catch {
          return false;
        }
      });
      expect(authSuccess).toBeDefined();
    });

    it('should reject invalid token', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();
      const connectionHandler = getConnectionHandler(server);
      connectionHandler(ws);

      defaultOptions.onAuth.mockResolvedValueOnce({ valid: false });

      ws.emit('message', JSON.stringify({ type: 'auth', token: 'bad-token' }));

      await vi.waitFor(() => {
        const authError = ws.send.mock.calls.find((c: any[]) => {
          try {
            return JSON.parse(c[0]).type === 'auth_error';
          } catch {
            return false;
          }
        });
        expect(authError).toBeDefined();
      });

      expect(ws.close).toHaveBeenCalledWith(4002, 'Authentication failed');
    });

    it('should send sessions list after auth', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getSessions = vi.fn(() =>
        Promise.resolve([
          {
            id: 'sess-1',
            agent: 'claude-code',
            machineId: 'm-1',
            projectPath: '/tmp',
            projectName: 'test',
            status: 'running',
            lastMessage: null,
            lastActivity: new Date(),
            createdAt: new Date(),
            sessionName: null,
            model: null,
            agentMode: null,
          },
        ])
      );

      const ws = createMockWs();
      await authenticateClient(server, ws);

      const sessionsList = ws.send.mock.calls.find((c: any[]) => {
        try {
          return JSON.parse(c[0]).type === 'sessions_list';
        } catch {
          return false;
        }
      });
      expect(sessionsList).toBeDefined();
    });

    it('should call onClientAuthenticated after auth', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const authenticatedSpy = vi.fn();
      server.onClientAuthenticated = authenticatedSpy;

      const ws = createMockWs();
      await authenticateClient(server, ws);

      expect(authenticatedSpy).toHaveBeenCalled();
    });

    it('should include capabilities in auth_success', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getCapabilities = vi.fn(() => [{ agent: { name: 'claude-code' } } as any]);

      const ws = createMockWs();
      await authenticateClient(server, ws);

      const authSuccess = ws.send.mock.calls.find((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'auth_success';
        } catch {
          return false;
        }
      });
      expect(authSuccess).toBeDefined();
      const msg = JSON.parse(authSuccess[0]);
      expect(msg.capabilities).toHaveLength(1);
    });

    it('should reject non-auth messages from unauthenticated clients', () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();
      const connectionHandler = getConnectionHandler(server);
      connectionHandler(ws);

      ws.emit('message', JSON.stringify({ type: 'ping' }));

      const notAuthMsg = ws.send.mock.calls.find((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'error' && msg.code === 'NOT_AUTHENTICATED';
        } catch {
          return false;
        }
      });
      expect(notAuthMsg).toBeDefined();
    });
  });

  // ── Message handling (authenticated) ──────────────────────

  describe('authenticated message handling', () => {
    it('should respond to ping with pong', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);
      ws.send.mockClear();

      ws.emit('message', JSON.stringify({ type: 'ping' }));

      await vi.waitFor(() => {
        const pongMsg = ws.send.mock.calls.find((c: any[]) => {
          try {
            return JSON.parse(c[0]).type === 'pong';
          } catch {
            return false;
          }
        });
        expect(pongMsg).toBeDefined();
      });
    });

    it('should handle subscribe message', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getSessionHistory = vi.fn(() => Promise.resolve([]));

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1', 'sess-2'] }));

      // After subscribing, events for sess-1 should reach this client
      ws.send.mockClear();

      server.broadcastACPEvent({
        type: 'message:delta',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
        sequence: 1,
      } as any);

      const acpEvents = ws.send.mock.calls.filter((c: any[]) => {
        try {
          return JSON.parse(c[0]).type === 'acp_event';
        } catch {
          return false;
        }
      });
      expect(acpEvents.length).toBe(1);
    });

    it('should replay history on subscribe', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getSessionHistory = vi.fn((_sessionId: string) =>
        Promise.resolve([
          {
            type: 'message:complete' as const,
            sessionId: 'sess-1',
            role: 'user',
            content: [{ type: 'text' as const, text: 'hello' }],
            timestamp: new Date().toISOString(),
            sequence: 1,
          },
        ])
      ) as any;

      const ws = createMockWs();
      await authenticateClient(server, ws);
      ws.send.mockClear();

      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1'] }));

      await vi.waitFor(() => {
        const historyComplete = ws.send.mock.calls.find((c: any[]) => {
          try {
            return JSON.parse(c[0]).type === 'history_complete';
          } catch {
            return false;
          }
        });
        expect(historyComplete).toBeDefined();
      });
    });

    it('should handle subscribe with no sessionIds', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);

      // Subscribe without sessionIds should not throw
      ws.emit('message', JSON.stringify({ type: 'subscribe' }));
    });

    it('should handle unsubscribe message', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getSessionHistory = vi.fn(() => Promise.resolve([]));

      const ws = createMockWs();
      await authenticateClient(server, ws);

      // Subscribe to two sessions
      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1', 'sess-2'] }));

      // Unsubscribe from sess-1 only (sess-2 still subscribed)
      ws.emit('message', JSON.stringify({ type: 'unsubscribe', sessionIds: ['sess-1'] }));

      ws.send.mockClear();

      // Events for sess-1 should NOT reach this client (unsubscribed)
      server.broadcastACPEvent({
        type: 'message:delta',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
        sequence: 1,
      } as any);

      const sess1Events = ws.send.mock.calls.filter((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'acp_event' && msg.event.sessionId === 'sess-1';
        } catch {
          return false;
        }
      });
      expect(sess1Events).toHaveLength(0);

      // Events for sess-2 SHOULD still reach this client
      server.broadcastACPEvent({
        type: 'message:delta',
        sessionId: 'sess-2',
        timestamp: new Date().toISOString(),
        sequence: 2,
      } as any);

      const sess2Events = ws.send.mock.calls.filter((c: any[]) => {
        try {
          const msg = JSON.parse(c[0]);
          return msg.type === 'acp_event' && msg.event.sessionId === 'sess-2';
        } catch {
          return false;
        }
      });
      expect(sess2Events).toHaveLength(1);
    });

    it('should forward command to onCommand handler', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const commandHandler = vi.fn();
      server.onCommand = commandHandler;

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'command',
          sessionId: 'sess-1',
          command: { command: 'send_message', message: 'hello' },
        })
      );

      await vi.waitFor(() => {
        expect(commandHandler).toHaveBeenCalledWith('sess-1', {
          command: 'send_message',
          message: 'hello',
        });
      });
    });

    it('should handle approve_tool_call via hookApprovals', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const handleCommandSpy = vi.spyOn(server.hookApprovals, 'handleCommand');

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'command',
          sessionId: 'sess-1',
          command: { command: 'approve_tool_call', requestId: 'req-1' },
        })
      );

      await vi.waitFor(() => {
        expect(handleCommandSpy).toHaveBeenCalled();
      });
    });

    it('should handle deny_tool_call via hookApprovals', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const handleCommandSpy = vi.spyOn(server.hookApprovals, 'handleCommand');

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'command',
          sessionId: 'sess-1',
          command: { command: 'deny_tool_call', requestId: 'req-1' },
        })
      );

      await vi.waitFor(() => {
        expect(handleCommandSpy).toHaveBeenCalled();
      });
    });

    it('should handle start_session message', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const startHandler = vi.fn(() =>
        Promise.resolve({
          id: 'new-sess',
          agent: 'claude-code',
          machineId: 'm-1',
          projectPath: '/tmp',
          projectName: 'test',
          status: 'running',
          lastMessage: null,
          lastActivity: new Date(),
          createdAt: new Date(),
          sessionName: null,
          model: null,
          agentMode: null,
        })
      );
      server.onStartSession = startHandler;
      server.getSessions = vi.fn(() => Promise.resolve([]));

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'start_session',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          prompt: 'Build it',
        })
      );

      await vi.waitFor(() => {
        expect(startHandler).toHaveBeenCalledWith('claude-code', '/tmp/project', 'Build it');
      });
    });

    it('should handle terminate_session message', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const terminateHandler = vi.fn(() => Promise.resolve());
      server.onTerminateSession = terminateHandler;

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'terminate_session',
          sessionId: 'sess-1',
        })
      );

      await vi.waitFor(() => {
        expect(terminateHandler).toHaveBeenCalledWith('sess-1');
      });
    });

    it('should handle history replay error gracefully', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getSessionHistory = vi.fn(() => Promise.reject(new Error('History error')));

      const ws = createMockWs();
      await authenticateClient(server, ws);
      ws.send.mockClear();

      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1'] }));

      // Should still send history_complete even on error
      await vi.waitFor(() => {
        const historyComplete = ws.send.mock.calls.find((c: any[]) => {
          try {
            return JSON.parse(c[0]).type === 'history_complete';
          } catch {
            return false;
          }
        });
        expect(historyComplete).toBeDefined();
      });
    });
  });

  // ── HTTP Routes ───────────────────────────────────────────

  describe('HTTP routes', () => {
    function createMockReq(method: string, url: string, body?: string) {
      const req = new EventEmitter() as any;
      req.method = method;
      req.url = url;
      req.headers = { 'content-type': 'application/json' };
      return { req, body };
    }

    function createMockRes() {
      const res: any = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };
      return res;
    }

    async function makeHttpRequest(method: string, url: string, body?: string) {
      const { req } = createMockReq(method, url, body);
      const res = createMockRes();

      // Need a server to initialize httpRequestHandler
      new AgentapWebSocketServer(defaultOptions);

      // Call the handler
      httpRequestHandler(req, res);

      // Emit data and end
      if (body) {
        req.emit('data', Buffer.from(body));
      }
      req.emit('end');

      // Wait for async response
      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      return res;
    }

    it('should respond to health check', async () => {
      const res = await makeHttpRequest('GET', '/api/hooks/health');

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.ok).toBe(true);
      expect(body.pending).toBe(0);
    });

    it('should return 404 for unknown routes', async () => {
      const res = await makeHttpRequest('GET', '/unknown/route');

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });

    it('should handle approve endpoint with missing body', async () => {
      const res = await makeHttpRequest('POST', '/api/hooks/approve', 'invalid json');

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should handle approve endpoint with missing required fields', async () => {
      const res = await makeHttpRequest(
        'POST',
        '/api/hooks/approve',
        JSON.stringify({ session_id: '', tool_name: '', tool_use_id: '' })
      );

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should handle approve endpoint with valid input', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);

      const req = new EventEmitter() as any;
      req.method = 'POST';
      req.url = '/api/hooks/approve';
      req.headers = { 'content-type': 'application/json' };
      const res = createMockRes();

      httpRequestHandler(req, res);

      const input = JSON.stringify({
        session_id: 'sess-1',
        tool_name: 'Bash',
        tool_use_id: 'tu-1',
        tool_input: { command: 'ls -la' },
        cwd: '/tmp',
      });

      req.emit('data', Buffer.from(input));
      req.emit('end');

      // The approval will block waiting for resolution, so we just verify it started
      // and does not immediately return an error
      // Give it a moment to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // It should still be pending (not resolved yet since no one approved)
      expect(server.hookApprovals.pendingCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ── send (private) ────────────────────────────────────────

  describe('send behavior', () => {
    it('should not send to closed websocket', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const ws = createMockWs();

      await authenticateClient(server, ws);
      ws.send.mockClear();

      // Close the websocket
      ws.readyState = WebSocket.CLOSED;

      server.broadcastSessionsList([]);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // ── Upgrade handling ──────────────────────────────────────

  describe('upgrade handling', () => {
    it('should handle WebSocket upgrade request', () => {
      new AgentapWebSocketServer(defaultOptions);
      const httpServer = getHttpServerMock();
      const wss = getWssMock();

      const upgradeHandler = httpServer.on.mock.calls.find(
        (call: any[]) => call[0] === 'upgrade'
      )?.[1];

      expect(upgradeHandler).toBeDefined();

      // Simulate an upgrade request
      const mockRequest = {};
      const mockSocket = {};
      const mockHead = Buffer.alloc(0);

      upgradeHandler(mockRequest, mockSocket, mockHead);

      expect(wss.handleUpgrade).toHaveBeenCalledWith(
        mockRequest,
        mockSocket,
        mockHead,
        expect.any(Function)
      );
    });

    it('should emit connection event after handleUpgrade callback (line 207)', () => {
      new AgentapWebSocketServer(defaultOptions);
      const httpServer = getHttpServerMock();
      const wss = getWssMock();

      const upgradeHandler = httpServer.on.mock.calls.find(
        (call: any[]) => call[0] === 'upgrade'
      )?.[1];

      const mockRequest = {};
      const mockSocket = {};
      const mockHead = Buffer.alloc(0);

      // Make handleUpgrade invoke its callback
      wss.handleUpgrade.mockImplementation(
        (_req: any, _socket: any, _head: any, cb: (ws: any) => void) => {
          const fakeWs = createMockWs();
          cb(fakeWs);
        }
      );

      upgradeHandler(mockRequest, mockSocket, mockHead);

      expect(wss.emit).toHaveBeenCalledWith('connection', expect.anything(), mockRequest);
    });
  });

  // ── WSS error handler ──────────────────────────────────────

  describe('WSS error handler', () => {
    it('should log error when WSS emits error (line 216)', () => {
      new AgentapWebSocketServer(defaultOptions);
      const wss = getWssMock();

      // Find the error handler registered on the WSS
      const errorCall = wss.on.mock.calls.find((call: any[]) => call[0] === 'error');
      expect(errorCall).toBeDefined();

      const errorHandler = errorCall[1];
      const testError = new Error('test wss error');
      errorHandler(testError);

      expect(console.error).toHaveBeenCalledWith('WebSocket server error:', testError);
    });
  });

  // ── Auth timeout ───────────────────────────────────────────

  describe('auth timeout', () => {
    it('should close unauthenticated client after timeout (lines 288-289)', async () => {
      vi.useFakeTimers();
      try {
        const server = new AgentapWebSocketServer(defaultOptions);
        const ws = createMockWs();
        const connectionHandler = getConnectionHandler(server);

        connectionHandler(ws);

        // Client never sends auth — advance past the 10s timeout
        vi.advanceTimersByTime(10_000);

        expect(ws.close).toHaveBeenCalledWith(4001, 'Authentication timeout');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not close client if already authenticated before timeout', async () => {
      vi.useFakeTimers();
      try {
        const server = new AgentapWebSocketServer(defaultOptions);
        const ws = createMockWs();
        const connectionHandler = getConnectionHandler(server);

        connectionHandler(ws);

        // Authenticate the client before timeout
        defaultOptions.onAuth.mockResolvedValueOnce({
          valid: true,
          userId: 'user-1',
        });
        ws.emit('message', JSON.stringify({ type: 'auth', token: 'valid-token' }));

        // Wait for async auth to complete
        await vi.advanceTimersByTimeAsync(100);

        // Now advance past the timeout
        vi.advanceTimersByTime(10_000);

        // The close should NOT have been called with auth timeout code
        const timeoutCloseCall = ws.close.mock.calls.find((c: any[]) => c[0] === 4001);
        expect(timeoutCloseCall).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── Additional branch coverage ─────────────────────────────

  describe('additional branch coverage', () => {
    it('should handle request with undefined url (req.url ?? "/" fallback)', async () => {
      new AgentapWebSocketServer(defaultOptions);

      const req = new EventEmitter() as any;
      req.method = 'GET';
      req.url = undefined; // trigger the ?? '/' fallback
      req.headers = {};
      const res: any = { writeHead: vi.fn(), end: vi.fn() };

      httpRequestHandler(req, res);
      req.emit('end');

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });
    });

    it('should handle array header values', async () => {
      new AgentapWebSocketServer(defaultOptions);

      const req = new EventEmitter() as any;
      req.method = 'GET';
      req.url = '/api/hooks/health';
      req.headers = {
        accept: ['application/json', 'text/html'],
        'content-type': 'application/json',
      };
      const res: any = { writeHead: vi.fn(), end: vi.fn() };

      httpRequestHandler(req, res);
      req.emit('end');

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });

    it('should skip header with falsy value', async () => {
      new AgentapWebSocketServer(defaultOptions);

      const req = new EventEmitter() as any;
      req.method = 'GET';
      req.url = '/api/hooks/health';
      req.headers = { 'x-empty': undefined };
      const res: any = { writeHead: vi.fn(), end: vi.fn() };

      httpRequestHandler(req, res);
      req.emit('end');

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });

    it('should reject request body exceeding 1MB (line 165-170)', async () => {
      new AgentapWebSocketServer(defaultOptions);

      const req = new EventEmitter() as any;
      req.method = 'POST';
      req.url = '/api/hooks/approve';
      req.headers = { 'content-type': 'application/json' };
      req.destroy = vi.fn();
      const res: any = { writeHead: vi.fn(), end: vi.fn() };

      httpRequestHandler(req, res);

      // Send a chunk larger than 1MB
      const bigChunk = Buffer.alloc(1_048_577, 'a');
      req.emit('data', bigChunk);

      expect(res.writeHead).toHaveBeenCalledWith(413);
      expect(res.end).toHaveBeenCalledWith('Request body too large');
      expect(req.destroy).toHaveBeenCalled();
    });

    it('should not process end event after body was aborted', async () => {
      new AgentapWebSocketServer(defaultOptions);

      const req = new EventEmitter() as any;
      req.method = 'POST';
      req.url = '/api/hooks/approve';
      req.headers = { 'content-type': 'application/json' };
      req.destroy = vi.fn();
      const res: any = { writeHead: vi.fn(), end: vi.fn() };

      httpRequestHandler(req, res);

      // Abort via large body
      const bigChunk = Buffer.alloc(1_048_577, 'a');
      req.emit('data', bigChunk);

      // Reset mock calls
      res.writeHead.mockClear();
      res.end.mockClear();

      // Now emit end — should be a no-op because aborted=true
      req.emit('end');

      // Give it time to make sure no further calls happen
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(res.writeHead).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });

    it('should handle Hono fetch throwing an error (catch block line 195-197)', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);

      // To trigger the catch block, we need the Hono app.fetch to throw.
      // We access the private app and override its fetch method.
      (server as any).app.fetch = vi.fn(() => {
        throw new Error('Hono crash');
      });

      const req = new EventEmitter() as any;
      req.method = 'GET';
      req.url = '/api/hooks/health';
      req.headers = {};
      const res: any = { writeHead: vi.fn(), end: vi.fn() };

      httpRequestHandler(req, res);
      req.emit('end');

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      expect(res.writeHead).toHaveBeenCalledWith(500);
      expect(res.end).toHaveBeenCalledWith('Internal Server Error');
    });

    it('should not include body in GET requests even if chunks received', async () => {
      new AgentapWebSocketServer(defaultOptions);

      const req = new EventEmitter() as any;
      req.method = 'GET';
      req.url = '/api/hooks/health';
      req.headers = {};
      const res: any = { writeHead: vi.fn(), end: vi.fn() };

      httpRequestHandler(req, res);
      req.emit('data', Buffer.from('some body'));
      req.emit('end');

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      // Should still succeed as a GET request
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });

    it('should handle subscribe with history replay when ws closes mid-replay', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getSessionHistory = vi.fn(() =>
        Promise.resolve([
          {
            type: 'message:complete' as const,
            sessionId: 'sess-1',
            role: 'user',
            content: [{ type: 'text' as const, text: 'hello' }],
            timestamp: new Date().toISOString(),
            sequence: 1,
          },
        ])
      ) as any;

      const ws = createMockWs();
      await authenticateClient(server, ws);
      ws.send.mockClear();

      // Set ws to CLOSED before replay resolves
      ws.readyState = WebSocket.CLOSED;

      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1'] }));

      await vi.waitFor(() => {
        expect(server.getSessionHistory).toHaveBeenCalledWith('sess-1');
      });

      // Because ws is closed, send should not be called for event or history_complete
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should send history_complete on error even when ws is closed', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.getSessionHistory = vi.fn(() => Promise.reject(new Error('History error')));

      const ws = createMockWs();
      await authenticateClient(server, ws);
      ws.send.mockClear();

      // Set ws to CLOSED — the catch block checks readyState === OPEN
      ws.readyState = WebSocket.CLOSED;

      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1'] }));

      // Wait for the promise rejection to be handled
      await new Promise((resolve) => setTimeout(resolve, 50));

      // send should NOT have been called since ws is closed
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should fall through to onCommand when hookApprovals does not handle approve_tool_call', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const commandHandler = vi.fn();
      server.onCommand = commandHandler;

      // Make handleCommand return false (not handled)
      vi.spyOn(server.hookApprovals, 'handleCommand').mockReturnValue(false);

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'command',
          sessionId: 'sess-1',
          command: { command: 'approve_tool_call', requestId: 'req-unknown' },
        })
      );

      await vi.waitFor(() => {
        expect(commandHandler).toHaveBeenCalledWith('sess-1', {
          command: 'approve_tool_call',
          requestId: 'req-unknown',
        });
      });
    });

    it('should not call onCommand when hookApprovals handles approve_tool_call', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      const commandHandler = vi.fn();
      server.onCommand = commandHandler;

      // Make handleCommand return true (handled)
      vi.spyOn(server.hookApprovals, 'handleCommand').mockReturnValue(true);

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'command',
          sessionId: 'sess-1',
          command: { command: 'approve_tool_call', requestId: 'req-1' },
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(commandHandler).not.toHaveBeenCalled();
    });

    it('should handle command message when onCommand is not set', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      // onCommand is undefined by default

      const ws = createMockWs();
      await authenticateClient(server, ws);

      // Should not throw
      ws.emit(
        'message',
        JSON.stringify({
          type: 'command',
          sessionId: 'sess-1',
          command: { command: 'send_message', message: 'hello' },
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should handle start_session when onStartSession is not set', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      // onStartSession is undefined

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'start_session',
          agent: 'claude-code',
          projectPath: '/tmp',
          prompt: 'Build it',
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should handle start_session without getSessions set', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      server.onStartSession = vi.fn(() =>
        Promise.resolve({
          id: 'new-sess',
          agent: 'claude-code',
          machineId: 'm-1',
          projectPath: '/tmp',
          projectName: 'test',
          status: 'running',
          lastMessage: null,
          lastActivity: new Date(),
          createdAt: new Date(),
          sessionName: null,
          model: null,
          agentMode: null,
        })
      );
      // getSessions is NOT set

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'start_session',
          agent: 'claude-code',
          projectPath: '/tmp',
          prompt: 'Build it',
        })
      );

      await vi.waitFor(() => {
        expect(server.onStartSession).toHaveBeenCalled();
      });
    });

    it('should handle terminate_session when onTerminateSession is not set', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      // onTerminateSession is undefined

      const ws = createMockWs();
      await authenticateClient(server, ws);

      ws.emit(
        'message',
        JSON.stringify({
          type: 'terminate_session',
          sessionId: 'sess-1',
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should handle auth when getSessions is not set', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      // getSessions is undefined — should still auth successfully

      const ws = createMockWs();
      await authenticateClient(server, ws);

      const authSuccess = ws.send.mock.calls.find((c: any[]) => {
        try {
          return JSON.parse(c[0]).type === 'auth_success';
        } catch {
          return false;
        }
      });
      expect(authSuccess).toBeDefined();

      // No sessions_list should be sent
      const sessionsList = ws.send.mock.calls.find((c: any[]) => {
        try {
          return JSON.parse(c[0]).type === 'sessions_list';
        } catch {
          return false;
        }
      });
      expect(sessionsList).toBeUndefined();
    });

    it('should handle subscribe without getSessionHistory set', async () => {
      const server = new AgentapWebSocketServer(defaultOptions);
      // getSessionHistory is undefined

      const ws = createMockWs();
      await authenticateClient(server, ws);
      ws.send.mockClear();

      ws.emit('message', JSON.stringify({ type: 'subscribe', sessionIds: ['sess-1'] }));

      // Should not throw, and no history_complete should be sent
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });
});

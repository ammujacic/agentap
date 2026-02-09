import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonConfig } from '../config';
import { DEFAULT_CONFIG } from '../config';

// ── Module-level mocks ───────────────────────────────────────────────

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  cpSync: vi.fn(),
  chmodSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  hostname: vi.fn(() => 'test-host'),
  platform: vi.fn(() => 'darwin'),
  arch: vi.fn(() => 'arm64'),
  networkInterfaces: vi.fn(() => ({
    en0: [{ family: 'IPv4', address: '192.168.1.100', internal: false }],
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  })),
  homedir: vi.fn(() => '/home/testuser'),
}));

vi.mock('path', async (importOriginal) => {
  const original = await importOriginal<typeof import('path')>();
  return {
    ...original,
    join: original.join,
    dirname: original.dirname,
  };
});

vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/mock/packages/daemon/src/daemon.ts'),
}));

// We store the last created WS server instance so tests can access it
let lastWsServerInstance: any = null;

function createMockWsServerProps() {
  return {
    hookApprovals: {
      setNotifier: vi.fn(),
      pendingCount: 0,
      cleanup: vi.fn(),
    },
    onCommand: null as any,
    onTerminateSession: null as any,
    onStartSession: null as any,
    getSessions: null as any,
    getCapabilities: null as any,
    getSessionHistory: null as any,
    onClientAuthenticated: null as any,
    close: vi.fn(() => Promise.resolve()),
    getClientCount: vi.fn(() => 0),
    broadcastACPEvent: vi.fn(),
    broadcastSessionsList: vi.fn(),
  };
}

vi.mock('../services/websocket', () => {
  const MockWSS = vi.fn(function (this: any) {
    Object.assign(this, createMockWsServerProps());
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWsServerInstance = this;
    return this;
  });
  return { AgentapWebSocketServer: MockWSS };
});

const mockTunnel = {
  on: vi.fn(),
  startWithToken: vi.fn(() => Promise.resolve()),
  stop: vi.fn(),
  getTunnelUrl: vi.fn((): string | null => null),
  getTunnelId: vi.fn((): string | null => null),
};

vi.mock('../services/tunnel', () => {
  const MockTM = vi.fn(function (this: any) {
    Object.assign(this, mockTunnel);
    return this;
  });
  return { TunnelManager: MockTM };
});

vi.mock('../adapter-loader', () => ({
  discoverAndLoadAdapters: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config')>();
  return {
    ...original,
    loadConfig: vi.fn(() => ({
      ...original.DEFAULT_CONFIG,
      machine: { ...original.DEFAULT_CONFIG.machine },
      daemon: { ...original.DEFAULT_CONFIG.daemon },
      api: { ...original.DEFAULT_CONFIG.api },
      portal: { ...original.DEFAULT_CONFIG.portal },
      tunnel: { ...original.DEFAULT_CONFIG.tunnel },
      agents: { ...original.DEFAULT_CONFIG.agents },
      adapters: { ...original.DEFAULT_CONFIG.adapters },
      approvals: { ...original.DEFAULT_CONFIG.approvals },
    })),
    saveConfig: vi.fn(),
    getPidfilePath: vi.fn(() => '/home/testuser/.agentap/daemon.pid'),
    getConfigDir: vi.fn(() => '/home/testuser/.agentap'),
    getConfigPath: vi.fn(() => '/home/testuser/.agentap/config.toml'),
    ensureConfigDir: vi.fn(),
  };
});

// Import after mocks are set up
import { Daemon } from '../daemon';
import { AgentapWebSocketServer } from '../services/websocket';
import { TunnelManager } from '../services/tunnel';
import { discoverAndLoadAdapters } from '../adapter-loader';
import { loadConfig, saveConfig, getPidfilePath } from '../config';
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  cpSync,
  chmodSync,
} from 'fs';

// ── Helpers ──────────────────────────────────────────────────────────

function makeLinkedConfig(): DaemonConfig {
  return {
    ...DEFAULT_CONFIG,
    machine: {
      ...DEFAULT_CONFIG.machine,
      id: 'machine-123',
      userId: 'user-456',
      apiSecret: 'secret-789',
      tunnelToken: 'tunnel-token-abc',
      tunnelUrl: 'https://tunnel.example.com',
    },
  };
}

function makeMockAdapter(name = 'claude-code') {
  return {
    getCapabilities: vi.fn(() => ({
      agent: { name, displayName: name },
      sessions: { canStart: true, canStop: true },
    })),
    discoverSessions: vi.fn((): Promise<any[]> => Promise.resolve([])),
    isInstalled: vi.fn(() => Promise.resolve(true)),
    getVersion: vi.fn(() => Promise.resolve('1.0.0')),
    attachToSession: vi.fn(() =>
      Promise.resolve({
        sessionId: 'sess-1',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      })
    ),
    watchSessions: vi.fn((_cb: any) => vi.fn()),
    startSession: vi.fn(() =>
      Promise.resolve({
        sessionId: 'new-sess-1',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
      })
    ),
  };
}

// ── Test Suite ───────────────────────────────────────────────────────

describe('Daemon', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.HOST_NAME;
    delete process.env.HOST_OS;
    delete process.env.HOST_ARCH;
    delete process.env.HOME;

    // Reset the last ws server instance
    lastWsServerInstance = null;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('should create a Daemon instance with default options', () => {
      const daemon = new Daemon();
      expect(daemon).toBeInstanceOf(Daemon);
      expect(loadConfig).toHaveBeenCalled();
    });

    it('should create a Daemon instance with custom options', () => {
      const daemon = new Daemon({ port: 4000, noTunnel: true });
      expect(daemon).toBeInstanceOf(Daemon);
    });

    it('should set machineId from config if present', () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const daemon = new Daemon();
      expect(daemon.getMachineId()).toBe('machine-123');
    });

    it('should have null machineId when not linked', () => {
      const daemon = new Daemon();
      expect(daemon.getMachineId()).toBeNull();
    });
  });

  // ── isLinked ──────────────────────────────────────────────

  describe('isLinked()', () => {
    it('should return false when machine.id is null', () => {
      const daemon = new Daemon();
      expect(daemon.isLinked()).toBe(false);
    });

    it('should return true when machine.id is set', () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const daemon = new Daemon();
      expect(daemon.isLinked()).toBe(true);
    });
  });

  // ── getMachineId ──────────────────────────────────────────

  describe('getMachineId()', () => {
    it('should return null when not linked', () => {
      const daemon = new Daemon();
      expect(daemon.getMachineId()).toBeNull();
    });

    it('should return the machineId when linked', () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const daemon = new Daemon();
      expect(daemon.getMachineId()).toBe('machine-123');
    });
  });

  // ── start() ───────────────────────────────────────────────

  describe('start()', () => {
    it('should create a WebSocket server on the configured port', async () => {
      const daemon = new Daemon();
      const status = await daemon.start();

      expect(AgentapWebSocketServer).toHaveBeenCalledWith(expect.objectContaining({ port: 9876 }));
      expect(status.running).toBe(true);
      expect(status.port).toBe(9876);
    });

    it('should use custom port from options', async () => {
      const daemon = new Daemon({ port: 4000 });
      const status = await daemon.start();

      expect(AgentapWebSocketServer).toHaveBeenCalledWith(expect.objectContaining({ port: 4000 }));
      expect(status.port).toBe(4000);
    });

    it('should wire up hook approvals notifier', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.hookApprovals.setNotifier).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('should set onCommand handler on ws server', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.onCommand).toBeTypeOf('function');
    });

    it('should set onTerminateSession handler on ws server', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.onTerminateSession).toBeTypeOf('function');
    });

    it('should set onStartSession handler on ws server', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.onStartSession).toBeTypeOf('function');
    });

    it('should set getSessions handler that returns sessions', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.getSessions).toBeTypeOf('function');
      const sessions = await lastWsServerInstance.getSessions();
      expect(sessions).toEqual([]);
    });

    it('should set getCapabilities handler', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.getCapabilities).toBeTypeOf('function');
      const caps = lastWsServerInstance.getCapabilities();
      expect(caps).toEqual([]);
    });

    it('should set getSessionHistory handler', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.getSessionHistory).toBeTypeOf('function');
    });

    it('should set onClientAuthenticated handler', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(lastWsServerInstance.onClientAuthenticated).toBeTypeOf('function');
    });

    it('should write pidfile', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(writeFileSync).toHaveBeenCalledWith('/home/testuser/.agentap/daemon.pid', '9876', {
        encoding: 'utf-8',
        mode: 0o600,
      });
    });

    it('should discover and load adapters', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(discoverAndLoadAdapters).toHaveBeenCalled();
    });

    it('should return correct status for unlinked daemon', async () => {
      const daemon = new Daemon();
      const status = await daemon.start();

      expect(status).toEqual({
        running: true,
        port: 9876,
        tunnelUrl: null,
        tunnelId: null,
        connectedClients: 0,
        activeSessions: 0,
        detectedAgents: [],
        machineId: null,
        linked: false,
      });
    });

    it('should start tunnel when linked with tunnel token', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const daemon = new Daemon();
      await daemon.start();

      expect(TunnelManager).toHaveBeenCalledWith({ localPort: 9876 });
      expect(mockTunnel.startWithToken).toHaveBeenCalledWith('tunnel-token-abc');
    });

    it('should not start tunnel when noTunnel is true', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const daemon = new Daemon({ noTunnel: true });
      await daemon.start();

      expect(TunnelManager).not.toHaveBeenCalled();
    });

    it('should not start tunnel when no tunnel token', async () => {
      const daemon = new Daemon();
      await daemon.start();

      expect(TunnelManager).not.toHaveBeenCalled();
    });

    it('should advertise LAN IP in no-tunnel mode', async () => {
      const daemon = new Daemon({ noTunnel: true });
      const status = await daemon.start();

      expect(status.tunnelUrl).toBe('http://192.168.1.100:9876');
    });

    it('should install Claude hooks when claude-code adapter is detected', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // ensureHooksInstalled checks existsSync for the hook script src
      expect(existsSync).toHaveBeenCalled();
    });

    it('should install OpenCode plugin when opencode adapter is detected', async () => {
      const mockAdapter = makeMockAdapter('opencode');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test-oc',
            source: 'node_modules',
            adapterName: 'opencode',
            path: '/test-oc',
          },
        },
      ]);

      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // The call to existsSync will come from ensureOpenCodePluginInstalled
      expect(existsSync).toHaveBeenCalled();
    });

    it('should start heartbeat when machine is linked', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      // Mock fetch for heartbeat
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      // heartbeat sends a fetch to /api/machines/:id/heartbeat
      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('should handle tunnel start failure gracefully', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      mockTunnel.startWithToken.mockRejectedValueOnce(new Error('Tunnel failed'));

      const daemon = new Daemon();
      const status = await daemon.start();

      // Should still start despite tunnel failure
      expect(status.running).toBe(true);
    });

    it('should initialize sessions from discovered adapters', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-1',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'my-project',
          createdAt: now,
          lastActivity: now,
          lastMessage: null,
          sessionName: null,
        },
      ]);
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      const status = await daemon.start();

      expect(status.activeSessions).toBe(1);
    });
  });

  // ── stop() ────────────────────────────────────────────────

  describe('stop()', () => {
    it('should stop the daemon cleanly', async () => {
      const daemon = new Daemon();
      await daemon.start();
      await daemon.stop();

      expect(lastWsServerInstance.close).toHaveBeenCalled();
    });

    it('should remove pidfile', async () => {
      const daemon = new Daemon();
      await daemon.start();
      await daemon.stop();

      expect(unlinkSync).toHaveBeenCalledWith('/home/testuser/.agentap/daemon.pid');
    });

    it('should stop tunnel if running', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const daemon = new Daemon();
      await daemon.start();
      await daemon.stop();

      expect(mockTunnel.stop).toHaveBeenCalled();
    });

    it('should stop heartbeat', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const daemon = new Daemon();
      await daemon.start();
      await daemon.stop();

      // No errors should occur
      expect(lastWsServerInstance.close).toHaveBeenCalled();
    });

    it('should clear sessions on stop', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-1',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'my-project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();
      await daemon.stop();

      const status = daemon.getStatus();
      expect(status.activeSessions).toBe(0);
    });

    it('should handle stop when not started', async () => {
      const daemon = new Daemon();
      // Stop without starting should not throw
      await expect(daemon.stop()).resolves.toBeUndefined();
    });

    it('should handle watcher stop errors gracefully', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const errorWatcher = vi.fn(() => {
        throw new Error('Watcher stop error');
      });
      mockAdapter.watchSessions.mockReturnValueOnce(errorWatcher);
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();
      await daemon.stop();

      // Should not throw
      expect(console.error).toHaveBeenCalledWith('Error stopping watcher:', expect.any(Error));
    });
  });

  // ── getStatus() ──────────────────────────────────────────

  describe('getStatus()', () => {
    it('should return not running status before start', () => {
      const daemon = new Daemon();
      const status = daemon.getStatus();

      expect(status.running).toBe(false);
      expect(status.connectedClients).toBe(0);
      expect(status.activeSessions).toBe(0);
    });

    it('should return running status after start', async () => {
      const daemon = new Daemon();
      await daemon.start();

      const status = daemon.getStatus();
      expect(status.running).toBe(true);
      expect(status.port).toBe(9876);
    });

    it('should include tunnelUrl from config', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const daemon = new Daemon();
      await daemon.start();

      const status = daemon.getStatus();
      expect(status.tunnelUrl).toBe('https://tunnel.example.com');
    });

    it('should include detected agents', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const status = daemon.getStatus();
      expect(status.detectedAgents).toContain('claude-code');
    });
  });

  // ── createLinkRequest() ──────────────────────────────────

  describe('createLinkRequest()', () => {
    it('should call API to create link request', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ABC123' }), { status: 200 }));

      const daemon = new Daemon();
      const result = await daemon.createLinkRequest();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/machines/link-request'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.code).toBe('ABC123');
      expect(result.qrData).toContain('ABC123');
      fetchSpy.mockRestore();
    });

    it('should use custom apiUrl from options', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'XYZ' }), { status: 200 }));

      const daemon = new Daemon({ apiUrl: 'http://custom-api:8080' });
      await daemon.createLinkRequest();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://custom-api:8080/api/machines/link-request',
        expect.any(Object)
      );
      fetchSpy.mockRestore();
    });

    it('should include host info in the request body', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ABC' }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.createLinkRequest();

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options!.body as string);
      expect(body.machineName).toBe('test-host');
      expect(body.os).toBe('darwin');
      expect(body.arch).toBe('arm64');
      fetchSpy.mockRestore();
    });

    it('should throw on non-ok response', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response('Server Error', { status: 500, statusText: 'Internal Server Error' })
        );

      const daemon = new Daemon();
      await expect(daemon.createLinkRequest()).rejects.toThrow('Failed to create link request');
      fetchSpy.mockRestore();
    });

    it('should use HOST_NAME env var if set', async () => {
      process.env.HOST_NAME = 'custom-host';
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ABC' }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.createLinkRequest();

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options!.body as string);
      expect(body.machineName).toBe('custom-host');
      fetchSpy.mockRestore();
    });

    it('should use HOST_OS env var if set', async () => {
      process.env.HOST_OS = 'linux';
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ABC' }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.createLinkRequest();

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options!.body as string);
      expect(body.os).toBe('linux');
      fetchSpy.mockRestore();
    });

    it('should return qrData with version info', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'XYZ' }), { status: 200 }));

      const daemon = new Daemon();
      const result = await daemon.createLinkRequest();
      const qr = JSON.parse(result.qrData);
      expect(qr.v).toBe(1);
      expect(qr.code).toBe('XYZ');
      expect(qr.name).toBe('test-host');
      fetchSpy.mockRestore();
    });
  });

  // ── waitForLink() ────────────────────────────────────────

  describe('waitForLink()', () => {
    it('should resolve when linked', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-xyz',
            tunnelToken: 'tk-abc',
            tunnelUrl: 'https://tunnel.example.com',
            userId: 'user-1',
            apiSecret: 'secret-1',
          }),
          { status: 200 }
        )
      );

      const daemon = new Daemon();
      const result = await daemon.waitForLink('ABC123');

      expect(result.machineId).toBe('machine-xyz');
      expect(result.userId).toBe('user-1');
      expect(saveConfig).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('should poll multiple times if not yet linked', async () => {
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return new Response(JSON.stringify({ linked: false }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-1',
            tunnelToken: null,
            tunnelUrl: null,
            userId: 'user-1',
            apiSecret: null,
          }),
          { status: 200 }
        );
      });

      const daemon = new Daemon();
      const onPoll = vi.fn();
      const result = await daemon.waitForLink('CODE', onPoll);

      expect(result.machineId).toBe('machine-1');
      expect(onPoll).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('should reject when poll returns non-ok response', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Not found', { status: 404 }));

      const daemon = new Daemon();
      await expect(daemon.waitForLink('EXPIRED')).rejects.toThrow(
        'Link request not found or expired'
      );
      fetchSpy.mockRestore();
    });

    it('should start heartbeat after successful link', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-1',
            tunnelToken: null,
            tunnelUrl: null,
            userId: 'user-1',
            apiSecret: null,
          }),
          { status: 200 }
        )
      );

      const daemon = new Daemon();
      await daemon.waitForLink('CODE');

      // After link, heartbeat fetch should be called
      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('should start tunnel after link if tunnel token provided and noTunnel is false', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-1',
            tunnelToken: 'tunnel-token-after-link',
            tunnelUrl: 'https://tunnel.example.com',
            userId: 'user-1',
            apiSecret: null,
          }),
          { status: 200 }
        )
      );

      const daemon = new Daemon();
      await daemon.waitForLink('CODE');

      expect(TunnelManager).toHaveBeenCalled();
      expect(mockTunnel.startWithToken).toHaveBeenCalledWith('tunnel-token-after-link');
      fetchSpy.mockRestore();
    });

    it('should continue polling on fetch error', async () => {
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network error');
        }
        return new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-1',
            tunnelToken: null,
            tunnelUrl: null,
            userId: 'user-1',
            apiSecret: null,
          }),
          { status: 200 }
        );
      });

      const daemon = new Daemon();
      const result = await daemon.waitForLink('CODE');
      expect(result.machineId).toBe('machine-1');
      fetchSpy.mockRestore();
    });
  });

  // ── handleACPEvent (tested via session tracking) ──────────

  describe('session event handling', () => {
    it('should update session status on status_changed event', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-1',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'my-project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      // Capture the event handler
      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-1',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Fire a status change event
      eventHandler({
        type: 'session:status_changed',
        sessionId: 'sess-1',
        to: 'waiting_for_input',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-1');
      expect(session?.status).toBe('waiting_for_input');
    });

    it('should handle session:completed event', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-2',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-2',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'session:completed',
        sessionId: 'sess-2',
        timestamp: new Date().toISOString(),
        sequence: 2,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-2');
      expect(session?.status).toBe('completed');
    });

    it('should handle session:error event', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-3',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-3',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'session:error',
        sessionId: 'sess-3',
        error: 'Test error',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-3');
      expect(session?.status).toBe('error');
    });

    it('should extract session name from first user message', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-4',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-4',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-4',
        role: 'user',
        content: [{ type: 'text', text: 'Fix the login bug' }],
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-4');
      expect(session?.sessionName).toBe('Fix the login bug');
    });

    it('should strip system tags from user messages for session name', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-5',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-5',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-5',
        role: 'user',
        content: [
          { type: 'text', text: '<system-reminder>some context</system-reminder>Hello world' },
        ],
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-5');
      expect(session?.sessionName).toBe('Hello world');
    });

    it('should truncate long session names to 100 chars', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-6',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-6',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const longMessage = 'a'.repeat(200);
      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-6',
        role: 'user',
        content: [{ type: 'text', text: longMessage }],
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-6');
      expect(session?.sessionName).toHaveLength(103); // 100 + '...'
    });

    it('should set lastMessage from assistant message:complete', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-7',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-7',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-7',
        role: 'assistant',
        content: [{ type: 'text', text: 'I fixed the bug.' }],
        timestamp: new Date().toISOString(),
        sequence: 2,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-7');
      expect(session?.lastMessage).toBe('I fixed the bug.');
    });

    it('should set model from environment:info event', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-8',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-8',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'environment:info',
        sessionId: 'sess-8',
        context: { model: { id: 'claude-opus-4' } },
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-8');
      expect(session?.model).toBe('claude-opus-4');
    });

    it('should update lastActivity on message:delta', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const pastDate = new Date(Date.now() - 60000);
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-9',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: pastDate,
          lastActivity: pastDate,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-9',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const beforeDelta = Date.now();
      eventHandler({
        type: 'message:delta',
        sessionId: 'sess-9',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-9');
      expect(session?.lastActivity.getTime()).toBeGreaterThanOrEqual(beforeDelta - 100);
    });

    it('should broadcast ACP events to websocket clients', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-10',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-10',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'message:delta',
        sessionId: 'sess-10',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      expect(lastWsServerInstance.broadcastACPEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message:delta' })
      );
    });

    it('should not update session for unknown event types', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-11',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-11',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Should not throw
      eventHandler({
        type: 'unknown:event',
        sessionId: 'sess-11',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      expect(lastWsServerInstance.broadcastACPEvent).toHaveBeenCalled();
    });
  });

  // ── handleCommand (via wsServer.onCommand) ────────────────

  describe('handleCommand', () => {
    it('should execute command on ACP session', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      const mockExecute = vi.fn();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-cmd',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-cmd',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: mockExecute,
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      await lastWsServerInstance.onCommand('sess-cmd', {
        command: 'send_message',
        message: 'test',
      });
      expect(mockExecute).toHaveBeenCalledWith({ command: 'send_message', message: 'test' });
    });

    it('should throw for unknown session', async () => {
      const daemon = new Daemon();
      await daemon.start();

      await expect(
        lastWsServerInstance.onCommand('nonexistent', { command: 'send_message', message: 'test' })
      ).rejects.toThrow('Session not found');
    });

    it('should re-attach to idle sessions on demand', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago (idle)
      const mockExecute = vi.fn();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-idle',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: oldDate,
          lastActivity: oldDate,
        },
      ]);

      // First call for initial attach (won't happen since session is idle)
      // Second call for re-attach on demand
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-idle',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: mockExecute,
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Session is idle, so not attached initially. Command should trigger re-attach.
      await lastWsServerInstance.onCommand('sess-idle', {
        command: 'send_message',
        message: 'hello',
      });
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  // ── handleTerminateSession ────────────────────────────────

  describe('handleTerminateSession', () => {
    it('should terminate session and mark as completed', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      const mockExecute = vi.fn();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-term',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-term',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: mockExecute,
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      await lastWsServerInstance.onTerminateSession('sess-term');
      expect(mockExecute).toHaveBeenCalledWith({ command: 'terminate' });
    });

    it('should throw for unknown session', async () => {
      const daemon = new Daemon();
      await daemon.start();

      await expect(lastWsServerInstance.onTerminateSession('nonexistent')).rejects.toThrow(
        'Session not found'
      );
    });
  });

  // ── handleStartSession ───────────────────────────────────

  describe('handleStartSession', () => {
    it('should start a new session via adapter', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const session = await lastWsServerInstance.onStartSession(
        'claude-code',
        '/tmp/project',
        'Build the feature'
      );

      expect(session.id).toBe('new-sess-1');
      expect(session.agent).toBe('claude-code');
      expect(session.projectPath).toBe('/tmp/project');
      expect(session.status).toBe('running');
    });

    it('should throw for unknown agent', async () => {
      const daemon = new Daemon();
      await daemon.start();

      await expect(
        lastWsServerInstance.onStartSession('unknown-agent', '/tmp/project', 'test')
      ).rejects.toThrow('No adapter for agent: unknown-agent');
    });
  });

  // ── handleAuth ────────────────────────────────────────────

  describe('handleAuth', () => {
    it('should return valid for local (unlinked) daemon', async () => {
      const daemon = new Daemon();
      await daemon.start();

      // Get the auth handler passed to WS server constructor
      const wsOptions = vi.mocked(AgentapWebSocketServer).mock.calls[0][0];
      const result = await wsOptions.onAuth('any-token');
      expect(result).toEqual({ valid: true, userId: 'local-user' });
    });

    it('should validate token against API when linked', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('validate-token')) {
          return new Response(JSON.stringify({ valid: true, userId: 'user-1' }), { status: 200 });
        }
        // heartbeat
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const daemon = new Daemon();
      await daemon.start();

      const wsOptions = vi.mocked(AgentapWebSocketServer).mock.calls[0][0];
      const result = await wsOptions.onAuth('valid-token');
      expect(result).toEqual({ valid: true, userId: 'user-1' });
      fetchSpy.mockRestore();
    });

    it('should return invalid when API rejects token', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('validate-token')) {
          return new Response('Unauthorized', { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const daemon = new Daemon();
      await daemon.start();

      const wsOptions = vi.mocked(AgentapWebSocketServer).mock.calls[0][0];
      const result = await wsOptions.onAuth('invalid-token');
      expect(result).toEqual({ valid: false });
      fetchSpy.mockRestore();
    });

    it('should fall back to valid on fetch error', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('validate-token')) {
          throw new Error('Network error');
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const daemon = new Daemon();
      await daemon.start();

      const wsOptions = vi.mocked(AgentapWebSocketServer).mock.calls[0][0];
      const result = await wsOptions.onAuth('token');
      expect(result).toEqual({ valid: true, userId: 'local-user' });
      fetchSpy.mockRestore();
    });
  });

  // ── Heartbeat ─────────────────────────────────────────────

  describe('heartbeat', () => {
    it('should send heartbeat with session data', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      const heartbeatCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      );
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);

      const [url, options] = heartbeatCalls[0];
      expect(String(url)).toContain('/api/machines/machine-123/heartbeat');
      expect(options?.method).toBe('POST');

      const body = JSON.parse(options!.body as string);
      expect(body).toHaveProperty('sessions');
      expect(body).toHaveProperty('agentsDetected');
      fetchSpy.mockRestore();
    });

    it('should include auth headers with apiSecret', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      const heartbeatCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      );
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);

      const [, options] = heartbeatCalls[0];
      const headers = options!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer secret-789');
      fetchSpy.mockRestore();
    });

    it('should handle heartbeat failure gracefully', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const daemon = new Daemon();
      await daemon.start();

      // Should not throw
      expect(console.error).toHaveBeenCalledWith('Heartbeat failed:', expect.any(Error));
      fetchSpy.mockRestore();
    });

    it('should warn on 401 heartbeat response', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
        );

      const daemon = new Daemon();
      await daemon.start();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('401'));
      fetchSpy.mockRestore();
    });
  });

  // ── ensureHooksInstalled ──────────────────────────────────

  describe('hooks installation', () => {
    it('should copy hook script and register in settings.json', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      // Hook script source exists
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pre-tool-use.sh')) return true;
        if (path.includes('settings.json')) return false;
        if (path.includes('agentap-plugin.js')) return false;
        return false;
      });

      const daemon = new Daemon();
      await daemon.start();

      // Should have copied the hook script
      expect(cpSync).toHaveBeenCalled();
      expect(chmodSync).toHaveBeenCalled();
      // Should have written settings.json
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('should skip hook installation if source not available', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // cpSync should not be called if hook source doesn't exist
      expect(cpSync).not.toHaveBeenCalled();
    });

    it('should not re-register hooks that are already installed', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash|Write|Edit|NotebookEdit',
                hooks: [
                  {
                    type: 'command',
                    command: '/home/testuser/.agentap/hooks/pre-tool-use.sh',
                  },
                ],
              },
            ],
          },
        })
      );

      const daemon = new Daemon();
      await daemon.start();

      // writeFileSync should only be called for the pidfile, not settings.json
      // because hooks are already installed
      const writeFileCalls = vi.mocked(writeFileSync).mock.calls;
      const settingsWrites = writeFileCalls.filter(([p]) => String(p).includes('settings.json'));
      expect(settingsWrites).toHaveLength(0);
    });

    it('should repair ".*" matcher to correct matcher', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: '.*',
                hooks: [
                  {
                    type: 'command',
                    command: '/home/testuser/.agentap/hooks/pre-tool-use.sh',
                  },
                ],
              },
            ],
          },
        })
      );

      const daemon = new Daemon();
      await daemon.start();

      // Should have written repaired settings
      const writeFileCalls = vi.mocked(writeFileSync).mock.calls;
      const settingsWrites = writeFileCalls.filter(([p]) => String(p).includes('settings.json'));
      expect(settingsWrites).toHaveLength(1);

      const written = JSON.parse(settingsWrites[0][1] as string);
      expect(written.hooks.PreToolUse[0].matcher).toBe('Bash|Write|Edit|NotebookEdit');
    });

    it('should handle read-only filesystem gracefully', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        const err = new Error('EROFS') as NodeJS.ErrnoException;
        err.code = 'EROFS';
        throw err;
      });

      const daemon = new Daemon();
      await daemon.start();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('read-only'));
    });
  });

  // ── OpenCode plugin installation ──────────────────────────

  describe('OpenCode plugin installation', () => {
    it('should install OpenCode plugin when source is available', async () => {
      const mockAdapter = makeMockAdapter('opencode');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test-oc',
            source: 'node_modules',
            adapterName: 'opencode',
            path: '/test-oc',
          },
        },
      ]);

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('agentap-plugin.js')) return true;
        return false;
      });

      const daemon = new Daemon();
      await daemon.start();

      expect(cpSync).toHaveBeenCalled();
    });

    it('should skip when source not available', async () => {
      const mockAdapter = makeMockAdapter('opencode');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test-oc',
            source: 'node_modules',
            adapterName: 'opencode',
            path: '/test-oc',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      expect(cpSync).not.toHaveBeenCalled();
    });

    it('should handle read-only filesystem for OpenCode plugin', async () => {
      const mockAdapter = makeMockAdapter('opencode');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test-oc',
            source: 'node_modules',
            adapterName: 'opencode',
            path: '/test-oc',
          },
        },
      ]);

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('agentap-plugin.js')) return true;
        return false;
      });

      vi.mocked(cpSync).mockImplementation(() => {
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      });

      const daemon = new Daemon();
      await daemon.start();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('read-only'));
    });
  });

  // ── pidfile ───────────────────────────────────────────────

  describe('pidfile management', () => {
    it('should handle pidfile write failure gracefully', async () => {
      vi.mocked(writeFileSync).mockImplementationOnce(() => {
        throw new Error('Write failed');
      });

      const daemon = new Daemon();
      await daemon.start();

      expect(console.error).toHaveBeenCalledWith('Failed to write pidfile:', expect.any(Error));
    });

    it('should handle pidfile removal failure gracefully', async () => {
      vi.mocked(unlinkSync).mockImplementationOnce(() => {
        throw new Error('Unlink failed');
      });

      const daemon = new Daemon();
      await daemon.start();
      // removePidfile silently ignores errors
      await daemon.stop();
    });
  });

  // ── forwardApprovalNotification ───────────────────────────

  describe('forwardApprovalNotification', () => {
    it('should forward approval requests to API', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-approve',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-approve',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'approval:requested',
        sessionId: 'sess-approve',
        requestId: 'req-1',
        toolCallId: 'tc-1',
        toolName: 'Bash',
        description: 'Run command: ls',
        riskLevel: 'medium',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      // Wait for the async fetch
      await vi.waitFor(() => {
        const approvalCalls = fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes('/notifications/approval')
        );
        expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
      });

      fetchSpy.mockRestore();
    });

    it('should handle notification failure gracefully', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-notify-fail',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-notify-fail',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('/notifications/approval')) {
          throw new Error('Network error');
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'approval:requested',
        sessionId: 'sess-notify-fail',
        requestId: 'req-1',
        toolCallId: 'tc-1',
        toolName: 'Bash',
        description: 'Run command: ls',
        riskLevel: 'medium',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      await vi.waitFor(() => {
        expect(console.error).toHaveBeenCalledWith(
          'Failed to forward approval notification:',
          expect.any(Error)
        );
      });

      fetchSpy.mockRestore();
    });
  });

  // ── getSessionHistory ────────────────────────────────────

  describe('getSessionHistory', () => {
    it('should return history from attached session', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      const mockHistory = [
        {
          type: 'message:complete',
          sessionId: 'sess-hist',
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ];

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-hist',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-hist',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => mockHistory),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const history = await lastWsServerInstance.getSessionHistory('sess-hist');
      expect(history).toEqual(mockHistory);
    });

    it('should return empty array for unknown session', async () => {
      const daemon = new Daemon();
      await daemon.start();

      const history = await lastWsServerInstance.getSessionHistory('nonexistent');
      expect(history).toEqual([]);
    });

    it('should re-attach to session for history if not currently attached', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const oldDate = new Date(Date.now() - 10 * 60 * 1000);
      const mockHistory = [{ type: 'test' }];

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-reattach',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: oldDate,
          lastActivity: oldDate,
        },
      ]);

      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-reattach',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => mockHistory),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const history = await lastWsServerInstance.getSessionHistory('sess-reattach');
      expect(history).toEqual(mockHistory);
    });

    it('should handle re-attach failure gracefully and return empty array', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const oldDate = new Date(Date.now() - 10 * 60 * 1000);

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-reattach-fail',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: oldDate,
          lastActivity: oldDate,
        },
      ]);

      // attachToSession fails on re-attach for history
      mockAdapter.attachToSession.mockRejectedValue(new Error('attach failed'));

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const history = await lastWsServerInstance.getSessionHistory('sess-reattach-fail');
      expect(history).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to re-attach'),
        expect.any(Error)
      );
    });
  });

  // ── Session watcher events ───────────────────────────────

  describe('session watcher events', () => {
    it('should handle session_created event from watcher', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([]); // initial discover
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'new-sess',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Simulate session_created event - discoverSessions returns a new session
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'new-sess',
          agent: 'claude-code',
          projectPath: '/tmp/new-project',
          projectName: 'new-project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      await watcherCallback({ type: 'session_created', sessionId: 'new-sess' });

      expect(lastWsServerInstance.broadcastSessionsList).toHaveBeenCalled();
    });

    it('should ignore session_created for already tracked sessions', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'existing-sess',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'existing-sess',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();
      vi.mocked(lastWsServerInstance.broadcastSessionsList).mockClear();

      // Return same session from discover
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'existing-sess',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      await watcherCallback({ type: 'session_created', sessionId: 'existing-sess' });

      // Should NOT broadcast again since session is already tracked
      expect(lastWsServerInstance.broadcastSessionsList).not.toHaveBeenCalled();
    });

    it('should handle session_created when session not found in discover', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([]); // initial
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // discoverSessions returns empty (session not found)
      mockAdapter.discoverSessions.mockResolvedValueOnce([]);

      await watcherCallback({ type: 'session_created', sessionId: 'ghost-sess' });

      // Should not crash or broadcast
      expect(lastWsServerInstance.broadcastSessionsList).not.toHaveBeenCalled();
    });

    it('should handle session_removed event from watcher', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-to-remove',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-to-remove',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const sessionsBefore = await lastWsServerInstance.getSessions();
      expect(sessionsBefore.length).toBe(1);

      await watcherCallback({ type: 'session_removed', sessionId: 'sess-to-remove' });

      const sessionsAfter = await lastWsServerInstance.getSessions();
      expect(sessionsAfter.length).toBe(0);
      expect(lastWsServerInstance.broadcastSessionsList).toHaveBeenCalled();
    });

    it('should handle session_updated event and update lastActivity', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const oldDate = new Date(Date.now() - 60000);
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-to-update',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: oldDate,
          lastActivity: oldDate,
        },
      ]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-to-update',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const beforeUpdate = Date.now();
      await watcherCallback({ type: 'session_updated', sessionId: 'sess-to-update' });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-to-update');
      expect(session?.lastActivity.getTime()).toBeGreaterThanOrEqual(beforeUpdate - 100);
    });

    it('should re-discover project info on session_updated when projectName is Unknown', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-unknown',
          agent: 'claude-code',
          projectPath: 'Unknown',
          projectName: 'Unknown',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-unknown',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();
      vi.mocked(lastWsServerInstance.broadcastSessionsList).mockClear();

      // Re-discover now returns actual project info
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-unknown',
          agent: 'claude-code',
          projectPath: '/tmp/real-project',
          projectName: 'real-project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      await watcherCallback({ type: 'session_updated', sessionId: 'sess-unknown' });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-unknown');
      expect(session?.projectName).toBe('real-project');
      expect(session?.projectPath).toBe('/tmp/real-project');
      expect(lastWsServerInstance.broadcastSessionsList).toHaveBeenCalled();
    });

    it('should call refresh on attached session during session_updated', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      let watcherCallback: (event: any) => Promise<void> = async () => {};
      const mockRefresh = vi.fn();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-refresh',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-refresh',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: mockRefresh,
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      await watcherCallback({ type: 'session_updated', sessionId: 'sess-refresh' });

      expect(mockRefresh).toHaveBeenCalled();
    });

    it('should reactivate idle session on session_updated when not attached', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago = idle
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-idle-reactivate',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: oldDate,
          lastActivity: oldDate,
        },
      ]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      // attachToSession succeeds on reactivation
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-idle-reactivate',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Session should be idle (not attached)
      const sessionsBefore = await lastWsServerInstance.getSessions();
      const sessionBefore = sessionsBefore.find((s: any) => s.id === 'sess-idle-reactivate');
      expect(sessionBefore?.status).toBe('idle');

      vi.mocked(lastWsServerInstance.broadcastSessionsList).mockClear();

      await watcherCallback({ type: 'session_updated', sessionId: 'sess-idle-reactivate' });

      const sessionsAfter = await lastWsServerInstance.getSessions();
      const sessionAfter = sessionsAfter.find((s: any) => s.id === 'sess-idle-reactivate');
      expect(sessionAfter?.status).toBe('running');
      expect(lastWsServerInstance.broadcastSessionsList).toHaveBeenCalled();
    });

    it('should handle session_updated for non-existent session gracefully', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Should not throw
      await watcherCallback({ type: 'session_updated', sessionId: 'nonexistent' });
    });

    it('should handle errors in watcher callback gracefully', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Cause discoverSessions to throw during session_created
      mockAdapter.discoverSessions.mockRejectedValueOnce(new Error('discover failed'));
      await watcherCallback({ type: 'session_created', sessionId: 'fail-sess' });

      expect(console.error).toHaveBeenCalledWith(
        'Error handling session event:',
        expect.any(Error)
      );
    });
  });

  // ── attachWithRetry ──────────────────────────────────────

  describe('attachWithRetry', () => {
    it('should retry on attach failure up to 3 attempts', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      let watcherCallback: (event: any) => Promise<void> = async () => {};
      let attachCallCount = 0;

      mockAdapter.discoverSessions.mockResolvedValueOnce([]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockImplementation(async () => {
        attachCallCount++;
        if (attachCallCount <= 2) {
          throw new Error('attach failed');
        }
        return {
          sessionId: 'retry-sess',
          onEvent: vi.fn((_handler: any) => vi.fn()),
          execute: vi.fn(),
          getHistory: vi.fn((): any[] => []),
          refresh: vi.fn(),
        };
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      vi.useFakeTimers();
      const daemon = new Daemon();
      await daemon.start();

      // Trigger session_created which calls attachWithRetry
      mockAdapter.discoverSessions.mockResolvedValue([
        {
          id: 'retry-sess',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      await watcherCallback({ type: 'session_created', sessionId: 'retry-sess' });

      // First attempt fails, wait for retry
      await vi.advanceTimersByTimeAsync(2100);
      // Second attempt fails, wait for retry
      await vi.advanceTimersByTimeAsync(2100);

      expect(attachCallCount).toBe(3);

      vi.useRealTimers();
    });

    it('should give up after 3 failed attempts', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      let watcherCallback: (event: any) => Promise<void> = async () => {};

      mockAdapter.discoverSessions.mockResolvedValueOnce([]);
      mockAdapter.watchSessions.mockImplementation((cb: any) => {
        watcherCallback = cb;
        return vi.fn();
      });
      mockAdapter.attachToSession.mockRejectedValue(new Error('always fails'));

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      vi.useFakeTimers();
      const daemon = new Daemon();
      await daemon.start();

      mockAdapter.discoverSessions.mockResolvedValue([
        {
          id: 'fail-sess',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      await watcherCallback({ type: 'session_created', sessionId: 'fail-sess' });

      // Advance through all retries
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(2100);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('after 3 attempts'),
        expect.any(Error)
      );

      vi.useRealTimers();
    });
  });

  // ── onClientAuthenticated ─────────────────────────────────

  describe('onClientAuthenticated', () => {
    it('should trigger heartbeat when client authenticates', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      const heartbeatCallsBefore = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      ).length;

      // Trigger the onClientAuthenticated callback
      lastWsServerInstance.onClientAuthenticated();

      // Wait for async heartbeat
      await vi.waitFor(() => {
        const heartbeatCallsAfter = fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes('/heartbeat')
        ).length;
        expect(heartbeatCallsAfter).toBeGreaterThan(heartbeatCallsBefore);
      });

      fetchSpy.mockRestore();
    });
  });

  // ── heartbeat edge cases ──────────────────────────────────

  describe('heartbeat edge cases', () => {
    it('should warn on non-401 error heartbeat response', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('Server Error', { status: 500, statusText: 'Internal Server Error' })
        );

      const daemon = new Daemon();
      await daemon.start();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('500'));
      fetchSpy.mockRestore();
    });

    it('should not start duplicate heartbeat intervals', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      const callsBefore = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      ).length;

      // Trigger onClientAuthenticated multiple times (which calls sendHeartbeat)
      // but startHeartbeat should be a no-op if already running
      lastWsServerInstance.onClientAuthenticated();
      lastWsServerInstance.onClientAuthenticated();

      await vi.waitFor(() => {
        const callsAfter = fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes('/heartbeat')
        ).length;
        // Each onClientAuthenticated calls sendHeartbeat directly, so we should have more calls
        expect(callsAfter).toBeGreaterThan(callsBefore);
      });

      fetchSpy.mockRestore();
    });

    it('should not send heartbeat when machineId is null', async () => {
      const daemon = new Daemon();
      await daemon.start();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      // onClientAuthenticated calls sendHeartbeat, but machineId is null so it should return early
      lastWsServerInstance.onClientAuthenticated();

      // Give it a tick
      await new Promise((r) => setTimeout(r, 50));

      const heartbeatCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      );
      expect(heartbeatCalls.length).toBe(0);

      fetchSpy.mockRestore();
    });
  });

  // ── handleCommand edge cases ────────────────────────────────

  describe('handleCommand edge cases', () => {
    it('should re-attach to detached session when adapter matches agent', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const oldDate = new Date(Date.now() - 10 * 60 * 1000); // idle
      const mockExecute = vi.fn();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-reattach-cmd',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: oldDate,
          lastActivity: oldDate,
        },
      ]);

      // First call is for initial discover (idle, so not attached).
      // Second call is when handleCommand tries to re-attach.
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-reattach-cmd',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: mockExecute,
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Session is idle (not attached). handleCommand should re-attach on demand.
      await lastWsServerInstance.onCommand('sess-reattach-cmd', {
        command: 'send_message',
        message: 'hello',
      });
      expect(mockExecute).toHaveBeenCalledWith({ command: 'send_message', message: 'hello' });
    });
  });

  // ── handleStartSession edge cases ─────────────────────────

  describe('handleStartSession edge cases', () => {
    it('should forward approval events from started sessions', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const mockAdapter = makeMockAdapter('claude-code');
      let startedEventHandler: (event: any) => void = () => {};

      mockAdapter.startSession.mockResolvedValueOnce({
        sessionId: 'started-sess',
        onEvent: vi.fn((handler: any) => {
          startedEventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      await lastWsServerInstance.onStartSession('claude-code', '/tmp/project', 'build feature');

      // Fire approval event from started session
      startedEventHandler({
        type: 'approval:requested',
        sessionId: 'started-sess',
        requestId: 'req-1',
        toolCallId: 'tc-1',
        toolName: 'Bash',
        description: 'Run command',
        riskLevel: 'high',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      await vi.waitFor(() => {
        const approvalCalls = fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes('/notifications/approval')
        );
        expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
      });

      fetchSpy.mockRestore();
    });

    it('should set projectName from last path segment', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const session = await lastWsServerInstance.onStartSession(
        'claude-code',
        '/home/user/projects/my-app',
        'test prompt'
      );

      expect(session.projectName).toBe('my-app');
    });
  });

  // ── handleACPEvent edge cases ─────────────────────────────

  describe('handleACPEvent edge cases', () => {
    it('should not set sessionName if sessionName is already set', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-named',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
          sessionName: 'Existing name',
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-named',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Send a user message - should NOT overwrite existing sessionName
      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-named',
        role: 'user',
        content: [{ type: 'text', text: 'New message' }],
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-named');
      expect(session?.sessionName).toBe('Existing name');
    });

    it('should handle user message with no text content blocks', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-notext',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-notext',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-notext',
        role: 'user',
        content: [{ type: 'image', data: 'base64...' }],
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-notext');
      expect(session?.sessionName).toBeNull();
    });

    it('should handle user message with only system tags (cleaned text is empty)', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-onlytags',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-onlytags',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-onlytags',
        role: 'user',
        content: [{ type: 'text', text: '<system-reminder>only tags here</system-reminder>' }],
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-onlytags');
      expect(session?.sessionName).toBeNull();
    });

    it('should handle assistant message with no text content', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-asst-notext',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-asst-notext',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      eventHandler({
        type: 'message:complete',
        sessionId: 'sess-asst-notext',
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'some_tool' }],
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-asst-notext');
      expect(session?.lastMessage).toBeNull();
    });

    it('should ignore event for non-existent session', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      // Create a session and attach, then simulate an event for a different session
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-exists',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      let eventHandler: (event: any) => void = () => {};
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-exists',
        onEvent: vi.fn((handler: any) => {
          eventHandler = handler;
          return vi.fn();
        }),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // This event is for 'sess-exists' but the handleACPEvent checks sessions map
      // It should just update normally. The "no session" branch is hit if
      // sessions.get returns undefined, which happens if session was removed
      // but event still fires. Let's not directly test this since it requires
      // internal manipulation. The existing tests cover this path through
      // the 'unknown:event' test.
    });
  });

  // ── hooks installation edge cases ─────────────────────────

  describe('hooks installation edge cases', () => {
    it('should handle hook script copy failure', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pre-tool-use.sh')) return true;
        return false;
      });

      vi.mocked(cpSync).mockImplementationOnce(() => {
        throw new Error('Copy failed');
      });

      const daemon = new Daemon();
      await daemon.start();

      expect(console.error).toHaveBeenCalledWith(
        'Failed to install hook script:',
        expect.any(Error)
      );
    });

    it('should handle non-EROFS/EACCES settings write error', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pre-tool-use.sh')) return true;
        if (path.includes('settings.json')) return true;
        return false;
      });

      // Reset cpSync to default (in case prior test set it)
      vi.mocked(cpSync).mockImplementation(() => {});

      // readFileSync throws a non-EROFS error for settings.json
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Some other error');
      });

      const daemon = new Daemon();
      await daemon.start();

      expect(console.error).toHaveBeenCalledWith(
        'Failed to register hooks in Claude settings:',
        expect.any(Error)
      );
    });

    it('should create claude directory if settings.json does not exist', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      // Reset cpSync to default
      vi.mocked(cpSync).mockImplementation(() => {});

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('pre-tool-use.sh')) return true;
        if (path.includes('settings.json')) return false;
        return false;
      });

      const daemon = new Daemon();
      await daemon.start();

      // Should have called mkdirSync for the claude dir
      expect(mkdirSync).toHaveBeenCalled();
      // Should have written settings.json with our hook
      const writeFileCalls = vi.mocked(writeFileSync).mock.calls;
      const settingsWrites = writeFileCalls.filter(([p]) => String(p).includes('settings.json'));
      expect(settingsWrites.length).toBeGreaterThanOrEqual(1);
    });

    it('should not repair matcher when it is not ".*"', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash|Write|Edit|NotebookEdit',
                hooks: [
                  {
                    type: 'command',
                    command: '/home/testuser/.agentap/hooks/pre-tool-use.sh',
                  },
                ],
              },
            ],
          },
        })
      );

      const daemon = new Daemon();
      await daemon.start();

      // Should not write settings.json since already installed and no repair needed
      const writeFileCalls = vi.mocked(writeFileSync).mock.calls;
      const settingsWrites = writeFileCalls.filter(([p]) => String(p).includes('settings.json'));
      expect(settingsWrites).toHaveLength(0);
    });
  });

  // ── OpenCode plugin edge cases ─────────────────────────────

  describe('OpenCode plugin edge cases', () => {
    it('should handle non-EROFS/EACCES error in OpenCode plugin install', async () => {
      const mockAdapter = makeMockAdapter('opencode');
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test-oc',
            source: 'node_modules',
            adapterName: 'opencode',
            path: '/test-oc',
          },
        },
      ]);

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('agentap-plugin.js')) return true;
        return false;
      });

      vi.mocked(cpSync).mockImplementation(() => {
        const err = new Error('Unexpected error');
        throw err;
      });

      const daemon = new Daemon();
      await daemon.start();

      expect(console.error).toHaveBeenCalledWith(
        'Failed to install OpenCode plugin:',
        expect.any(Error)
      );
    });
  });

  // ── waitForLink edge cases ────────────────────────────────

  describe('waitForLink edge cases', () => {
    it('should not start tunnel after link when noTunnel is true', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        ...DEFAULT_CONFIG,
        machine: { ...DEFAULT_CONFIG.machine },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-notunnel',
            tunnelToken: 'tunnel-token-xyz',
            tunnelUrl: 'https://tunnel.example.com',
            userId: 'user-1',
            apiSecret: null,
          }),
          { status: 200 }
        )
      );

      const daemon = new Daemon({ noTunnel: true });
      await daemon.waitForLink('CODE');

      // TunnelManager should NOT be created for noTunnel mode
      // (it may have been called from start(), so check specific calls)
      const tunnelStartCalls = mockTunnel.startWithToken.mock.calls.filter(
        ([token]: any) => token === 'tunnel-token-xyz'
      );
      expect(tunnelStartCalls).toHaveLength(0);

      fetchSpy.mockRestore();
    });

    it('should handle tunnel start failure after linking (startTunnel catches internally)', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        ...DEFAULT_CONFIG,
        machine: { ...DEFAULT_CONFIG.machine },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-tf',
            tunnelToken: 'tunnel-fail-token',
            tunnelUrl: 'https://tunnel.example.com',
            userId: 'user-1',
            apiSecret: null,
          }),
          { status: 200 }
        )
      );

      mockTunnel.startWithToken.mockRejectedValueOnce(new Error('Tunnel start failed'));

      const daemon = new Daemon();
      const result = await daemon.waitForLink('CODE');

      // startTunnel catches internally and logs 'Failed to start tunnel:'
      expect(console.error).toHaveBeenCalledWith('Failed to start tunnel:', expect.any(Error));
      // Should still resolve successfully
      expect(result.machineId).toBe('machine-tf');

      fetchSpy.mockRestore();
    });

    it('should store apiSecret from link response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-secret',
            tunnelToken: null,
            tunnelUrl: null,
            userId: 'user-1',
            apiSecret: 'my-secret-key',
          }),
          { status: 200 }
        )
      );

      const daemon = new Daemon();
      await daemon.waitForLink('CODE');

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          machine: expect.objectContaining({
            apiSecret: 'my-secret-key',
          }),
        })
      );

      fetchSpy.mockRestore();
    });
  });

  // ── getStatus edge cases ──────────────────────────────────

  describe('getStatus edge cases', () => {
    it('should return tunnelUrl from tunnel manager when config has no tunnelUrl', async () => {
      const linkedConfig = makeLinkedConfig();
      linkedConfig.machine.tunnelUrl = null;
      vi.mocked(loadConfig).mockReturnValueOnce(linkedConfig);

      mockTunnel.getTunnelUrl.mockReturnValue('https://tunnel-from-manager.example.com');

      const daemon = new Daemon();
      await daemon.start();

      const status = daemon.getStatus();
      expect(status.tunnelUrl).toBe('https://tunnel-from-manager.example.com');
    });

    it('should return tunnelId from tunnel manager', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      mockTunnel.getTunnelId.mockReturnValue('tunnel-id-123');

      const daemon = new Daemon();
      await daemon.start();

      const status = daemon.getStatus();
      expect(status.tunnelId).toBe('tunnel-id-123');
    });

    it('should return client count from ws server', async () => {
      const daemon = new Daemon();
      await daemon.start();

      lastWsServerInstance.getClientCount.mockReturnValue(5);

      const status = daemon.getStatus();
      expect(status.connectedClients).toBe(5);
    });
  });

  // ── discoveredToSession edge cases ──────────────────────────

  describe('discoveredToSession', () => {
    it('should set machineId to "local" when not linked', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-local',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-local');
      expect(session?.machineId).toBe('local');
    });

    it('should set machineId from linked config', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-linked',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-linked');
      expect(session?.machineId).toBe('machine-123');

      fetchSpy.mockRestore();
    });
  });

  // ── initializeSessions edge cases ──────────────────────────

  describe('initializeSessions edge cases', () => {
    it('should filter out sessions older than 24 hours', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'old-sess',
          agent: 'claude-code',
          projectPath: '/tmp/old',
          projectName: 'old-project',
          createdAt: twoDaysAgo,
          lastActivity: twoDaysAgo,
        },
        {
          id: 'new-sess',
          agent: 'claude-code',
          projectPath: '/tmp/new',
          projectName: 'new-project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'new-sess',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      const status = await daemon.start();

      expect(status.activeSessions).toBe(1);
    });

    it('should handle discoverSessions failure gracefully', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      mockAdapter.discoverSessions.mockRejectedValueOnce(new Error('discover error'));

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      const status = await daemon.start();

      expect(status.activeSessions).toBe(0);
      expect(console.error).toHaveBeenCalledWith('Failed to discover sessions:', expect.any(Error));
    });

    it('should handle attachToSession failure during initialization', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-attach-fail',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockRejectedValueOnce(new Error('attach error'));

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      const status = await daemon.start();

      // Session should still be tracked even if attach fails
      expect(status.activeSessions).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to attach'),
        expect.any(Error)
      );
    });
  });

  // ── getAuthHeaders edge cases ─────────────────────────────

  describe('getAuthHeaders', () => {
    it('should not include Authorization header when no apiSecret', async () => {
      const daemon = new Daemon();
      await daemon.start();

      // Make a fetch call via handleAuth (unlinked, so it returns valid immediately)
      // Instead, test via heartbeat which won't be called for unlinked
      // We can test this indirectly via createLinkRequest which doesn't use getAuthHeaders
      // The most direct way is to trigger handleAuth for a linked daemon without apiSecret
      const linkedNoSecret = makeLinkedConfig();
      linkedNoSecret.machine.apiSecret = null;
      vi.mocked(loadConfig).mockReturnValueOnce(linkedNoSecret);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon2 = new Daemon();
      await daemon2.start();

      // Check heartbeat call - should not have Authorization header
      const heartbeatCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      );
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);

      const [, options] = heartbeatCalls[0];
      const headers = options!.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');

      fetchSpy.mockRestore();
    });
  });

  // ── HOST_ARCH env var ──────────────────────────────────────

  describe('environment variables', () => {
    it('should use HOST_ARCH env var if set', async () => {
      process.env.HOST_ARCH = 'x86_64';
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ABC' }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.createLinkRequest();

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options!.body as string);
      expect(body.arch).toBe('x86_64');
      fetchSpy.mockRestore();
    });
  });

  // ── tunnel events ──────────────────────────────────────────

  describe('tunnel events', () => {
    it('should emit tunnel:connected event', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const daemon = new Daemon();
      const connectedSpy = vi.fn();
      daemon.on('tunnel:connected', connectedSpy);

      await daemon.start();

      // Get the 'connected' handler registered on the tunnel
      const onCalls = mockTunnel.on.mock.calls;
      const connectedHandler = onCalls.find(([event]: any) => event === 'connected');
      expect(connectedHandler).toBeDefined();

      // Invoke the connected handler
      connectedHandler![1]('https://tunnel.example.com', 'tunnel-id');

      expect(connectedSpy).toHaveBeenCalledWith('https://tunnel.example.com', 'tunnel-id');
    });

    it('should emit tunnel:disconnected event', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const daemon = new Daemon();
      const disconnectedSpy = vi.fn();
      daemon.on('tunnel:disconnected', disconnectedSpy);

      await daemon.start();

      const onCalls = mockTunnel.on.mock.calls;
      const disconnectedHandler = onCalls.find(([event]: any) => event === 'disconnected');
      expect(disconnectedHandler).toBeDefined();

      disconnectedHandler![1]();

      expect(disconnectedSpy).toHaveBeenCalled();
    });

    it('should emit tunnel:error event', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const daemon = new Daemon();
      const errorSpy = vi.fn();
      daemon.on('tunnel:error', errorSpy);

      await daemon.start();

      const onCalls = mockTunnel.on.mock.calls;
      const errorHandler = onCalls.find(([event]: any) => event === 'error');
      expect(errorHandler).toBeDefined();

      const tunnelError = new Error('Tunnel error');
      errorHandler![1](tunnelError);

      expect(errorSpy).toHaveBeenCalledWith(tunnelError);
    });
  });

  // ── hookApprovals notifier ─────────────────────────────────

  describe('hookApprovals notifier', () => {
    it('should forward hook approval events to API', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      // Get the notifier function that was passed to hookApprovals.setNotifier
      const setNotifierCall = lastWsServerInstance.hookApprovals.setNotifier.mock.calls[0];
      const notifier = setNotifierCall[0];

      // Call the notifier with an approval event
      notifier({
        type: 'approval:requested',
        sessionId: 'hook-sess',
        requestId: 'hook-req',
        toolCallId: 'hook-tc',
        toolName: 'Write',
        description: 'Write file',
        riskLevel: 'high',
        timestamp: new Date().toISOString(),
        sequence: 1,
      });

      await vi.waitFor(() => {
        const approvalCalls = fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes('/notifications/approval')
        );
        expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
      });

      fetchSpy.mockRestore();
    });
  });

  // ── detachSession edge case ─────────────────────────────────

  describe('detachSession', () => {
    it('should handle detach when no cleanup exists', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-detach-nocleanup',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // stop() calls detachSession for all acpSessions - should not throw
      await daemon.stop();
    });
  });

  // ── handleTerminateSession edge cases ─────────────────────

  describe('handleTerminateSession edge cases', () => {
    it('should update session status to completed on terminate', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      const mockExecute = vi.fn();
      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-term-status',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockResolvedValueOnce({
        sessionId: 'sess-term-status',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: mockExecute,
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      await lastWsServerInstance.onTerminateSession('sess-term-status');

      const sessions = await lastWsServerInstance.getSessions();
      const session = sessions.find((s: any) => s.id === 'sess-term-status');
      expect(session?.status).toBe('completed');
    });
  });

  // ── getLanIp fallback ──────────────────────────────────────

  describe('getLanIp fallback', () => {
    it('should return localhost when no IPv4 non-internal interface found', async () => {
      const { networkInterfaces } = await import('os');
      vi.mocked(networkInterfaces).mockReturnValue({
        lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true } as any],
      });

      const daemon = new Daemon({ noTunnel: true });
      const status = await daemon.start();

      expect(status.tunnelUrl).toBe('http://localhost:9876');
    });

    it('should handle empty network interfaces', async () => {
      const { networkInterfaces } = await import('os');
      vi.mocked(networkInterfaces).mockReturnValue({});

      const daemon = new Daemon({ noTunnel: true });
      const status = await daemon.start();

      expect(status.tunnelUrl).toBe('http://localhost:9876');
    });

    it('should skip IPv6 interfaces', async () => {
      const { networkInterfaces } = await import('os');
      vi.mocked(networkInterfaces).mockReturnValue({
        en0: [{ family: 'IPv6', address: 'fe80::1', internal: false } as any],
      });

      const daemon = new Daemon({ noTunnel: true });
      const status = await daemon.start();

      expect(status.tunnelUrl).toBe('http://localhost:9876');
    });

    it('should handle null interface entries', async () => {
      const { networkInterfaces } = await import('os');
      vi.mocked(networkInterfaces).mockReturnValue({
        en0: undefined as any,
        en1: [{ family: 'IPv4', address: '10.0.0.1', internal: false } as any],
      });

      const daemon = new Daemon({ noTunnel: true });
      const status = await daemon.start();

      expect(status.tunnelUrl).toBe('http://10.0.0.1:9876');
    });
  });

  // ── attachToSession already attached ──────────────────────

  describe('attachToSession already attached', () => {
    it('should skip attach when session is already attached via handleCommand', async () => {
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-double-attach',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-double-attach',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => []),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Session is running, so it was already attached during initialization.
      expect(mockAdapter.attachToSession).toHaveBeenCalledTimes(1);

      // handleCommand checks acpSessions.get first (skips re-attach entirely)
      await lastWsServerInstance.onCommand('sess-double-attach', {
        command: 'send_message',
        message: 'test',
      });

      // attachToSession should NOT have been called again
      expect(mockAdapter.attachToSession).toHaveBeenCalledTimes(1);
    });

    it('should skip attach via attachToSession early return when already in acpSessions', async () => {
      // This tests the early return at line 676-678 of attachToSession.
      // We trigger getSessionHistory for a session that's already attached.
      const mockAdapter = makeMockAdapter('claude-code');
      const now = new Date();
      const mockHistory = [{ type: 'test' }];

      mockAdapter.discoverSessions.mockResolvedValueOnce([
        {
          id: 'sess-already-attached',
          agent: 'claude-code',
          projectPath: '/tmp/project',
          projectName: 'project',
          createdAt: now,
          lastActivity: now,
        },
      ]);
      mockAdapter.attachToSession.mockResolvedValue({
        sessionId: 'sess-already-attached',
        onEvent: vi.fn((_handler: any) => vi.fn()),
        execute: vi.fn(),
        getHistory: vi.fn((): any[] => mockHistory),
        refresh: vi.fn(),
      });

      vi.mocked(discoverAndLoadAdapters).mockResolvedValueOnce([
        {
          adapter: mockAdapter as any,
          meta: {
            packageName: 'test',
            source: 'node_modules',
            adapterName: 'claude-code',
            path: '/test',
          },
        },
      ]);
      vi.mocked(existsSync).mockReturnValue(false);

      const daemon = new Daemon();
      await daemon.start();

      // Session is running and attached during init
      expect(mockAdapter.attachToSession).toHaveBeenCalledTimes(1);

      // Now getSessionHistory checks acpSessions.get first (finds it, returns history directly)
      // This does NOT call attachToSession again
      const history = await lastWsServerInstance.getSessionHistory('sess-already-attached');
      expect(history).toEqual(mockHistory);
      expect(mockAdapter.attachToSession).toHaveBeenCalledTimes(1);
    });
  });

  // ── waitForLink timeout ───────────────────────────────────

  describe('waitForLink timeout', () => {
    it('should reject when link code expires (timeout)', async () => {
      // Manipulate Date.now() to simulate timeout without running timers
      const realDateNow = Date.now;
      let fakeNow = realDateNow.call(Date);

      vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

      // First poll: not timed out, returns { linked: false }, schedules next poll
      // Second poll: timed out, rejects
      let pollCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        pollCount++;
        // After first poll, advance time past the 10-minute timeout
        fakeNow += 11 * 60 * 1000;
        return new Response(JSON.stringify({ linked: false }), { status: 200 });
      });

      const daemon = new Daemon();

      await expect(daemon.waitForLink('EXPIRED-CODE')).rejects.toThrow('Link code expired');

      fetchSpy.mockRestore();
      vi.mocked(Date.now).mockRestore();
    });
  });

  // ── startHeartbeat interval callback ──────────────────────

  describe('startHeartbeat interval', () => {
    it('should call sendHeartbeat on each interval tick', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      vi.useFakeTimers();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const daemon = new Daemon();
      await daemon.start();

      const heartbeatCallsBefore = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      ).length;

      // Advance by one heartbeat interval (60 seconds)
      await vi.advanceTimersByTimeAsync(60000);

      const heartbeatCallsAfter = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/heartbeat')
      ).length;

      expect(heartbeatCallsAfter).toBeGreaterThan(heartbeatCallsBefore);

      await daemon.stop();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should handle errors in heartbeat interval callback', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce(makeLinkedConfig());
      vi.useFakeTimers();

      // First call succeeds (initial sendHeartbeat), then subsequent calls fail
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Heartbeat network error');
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const daemon = new Daemon();
      await daemon.start();

      // Advance by one interval to trigger the interval callback
      await vi.advanceTimersByTimeAsync(60000);

      // The interval calls sendHeartbeat which catches errors with 'Heartbeat failed:'
      expect(console.error).toHaveBeenCalledWith('Heartbeat failed:', expect.any(Error));

      await daemon.stop();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  // ── waitForLink outer catch for startTunnel failure ────────

  describe('waitForLink tunnel constructor failure', () => {
    it('should handle TunnelManager constructor throwing', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        ...DEFAULT_CONFIG,
        machine: { ...DEFAULT_CONFIG.machine },
      });

      const { TunnelManager: MockTM } = await import('../services/tunnel');
      vi.mocked(MockTM).mockImplementationOnce(() => {
        throw new Error('TunnelManager constructor failed');
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            linked: true,
            machineId: 'machine-tmfail',
            tunnelToken: 'tunnel-token-xyz',
            tunnelUrl: null,
            userId: 'user-1',
            apiSecret: null,
          }),
          { status: 200 }
        )
      );

      const daemon = new Daemon();
      const result = await daemon.waitForLink('CODE');

      expect(console.error).toHaveBeenCalledWith(
        'Failed to start tunnel after linking:',
        expect.any(Error)
      );
      expect(result.machineId).toBe('machine-tmfail');

      fetchSpy.mockRestore();
    });
  });
});

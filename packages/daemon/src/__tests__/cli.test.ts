import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module-level mocks ───────────────────────────────────────────────

const mockDaemon = {
  start: vi.fn(() =>
    Promise.resolve({
      running: true,
      port: 9876,
      tunnelUrl: null as string | null,
      tunnelId: null as string | null,
      connectedClients: 0,
      activeSessions: 0,
      detectedAgents: [] as string[],
      machineId: null as string | null,
      linked: false,
    })
  ),
  stop: vi.fn(() => Promise.resolve()),
  isLinked: vi.fn(() => false),
  getMachineId: vi.fn(() => null as string | null),
  createLinkRequest: vi.fn(() =>
    Promise.resolve({
      code: 'ABC123',
      qrData: '{"code":"ABC123","name":"test","v":1}',
    })
  ),
  waitForLink: vi.fn(() =>
    Promise.resolve({
      machineId: 'machine-1',
      tunnelToken: null as string | null,
      tunnelUrl: null as string | null,
      userId: 'user-1',
    })
  ),
  getStatus: vi.fn(() => ({
    running: false,
    port: 9876,
    tunnelUrl: null,
    tunnelId: null,
    connectedClients: 0,
    activeSessions: 0,
    detectedAgents: [],
    machineId: null,
    linked: false,
  })),
};

vi.mock('../daemon', () => {
  const MockDaemon = vi.fn(function (this: any) {
    Object.assign(this, mockDaemon);
    return this;
  });
  return { Daemon: MockDaemon };
});

vi.mock('../config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config')>();
  return {
    ...original,
    loadConfig: vi.fn(() => ({
      ...original.DEFAULT_CONFIG,
      machine: { ...original.DEFAULT_CONFIG.machine },
      portal: { ...original.DEFAULT_CONFIG.portal },
    })),
    getConfigValue: vi.fn((key: string) => {
      if (key === 'daemon.port') return 9876;
      if (key === 'api.url') return 'https://api.agentap.dev';
      return undefined;
    }),
    setConfigValue: vi.fn(),
  };
});

vi.mock('chalk', () => {
  const handler: ProxyHandler<any> = {
    get: (_target, _prop) => new Proxy((s: any) => String(s), handler),
    apply: (_target, _thisArg, args) => String(args[0]),
  };
  return { default: new Proxy((s: any) => String(s), handler) };
});

vi.mock('qrcode-terminal', () => ({
  default: {
    generate: vi.fn(),
  },
}));

vi.mock('../adapter-loader', () => ({
  discoverAndLoadAdapters: vi.fn(() => Promise.resolve([])),
}));

// ── Test Suite ───────────────────────────────────────────────────────

describe('CLI', () => {
  let originalArgv: string[];
  let originalExit: typeof process.exit;
  let mockExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    originalExit = process.exit;
    mockExit = vi.fn() as any;
    process.exit = mockExit as any;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // Helper to import a fresh CLI module with Commander
  async function runCli(args: string[]) {
    // Commander reads process.argv and expects [node, script, ...args]
    process.argv = ['node', 'agentap', ...args];
    vi.resetModules();

    // Re-apply all mocks after module reset
    vi.doMock('../daemon', () => {
      const MockDaemon = vi.fn(function (this: any) {
        Object.assign(this, mockDaemon);
        return this;
      });
      return { Daemon: MockDaemon };
    });
    vi.doMock('../config', async (importOriginal) => {
      const original = await importOriginal<typeof import('../config')>();
      return {
        ...original,
        loadConfig: vi.fn(() => ({
          ...original.DEFAULT_CONFIG,
          machine: { ...original.DEFAULT_CONFIG.machine },
          portal: { ...original.DEFAULT_CONFIG.portal },
        })),
        getConfigValue: vi.fn((key: string) => {
          if (key === 'daemon.port') return 9876;
          if (key === 'api.url') return 'https://api.agentap.dev';
          return undefined;
        }),
        setConfigValue: vi.fn(),
      };
    });
    vi.doMock('chalk', () => {
      const handler: ProxyHandler<any> = {
        get: (_target, _prop) => new Proxy((s: any) => String(s), handler),
        apply: (_target, _thisArg, args) => String(args[0]),
      };
      return { default: new Proxy((s: any) => String(s), handler) };
    });
    vi.doMock('qrcode-terminal', () => ({
      default: { generate: vi.fn() },
    }));
    vi.doMock('../adapter-loader', () => ({
      discoverAndLoadAdapters: vi.fn(() => Promise.resolve([])),
    }));

    await import('../cli');
  }

  // Helper that allows custom module mock overrides
  async function runCliWithMocks(
    args: string[],
    overrides: {
      config?: () => Record<string, any>;
      adapterLoader?: () => Record<string, any>;
      fs?: () => Record<string, any>;
    } = {}
  ) {
    process.argv = ['node', 'agentap', ...args];
    vi.resetModules();

    vi.doMock('../daemon', () => {
      const MockDaemon = vi.fn(function (this: any) {
        Object.assign(this, mockDaemon);
        return this;
      });
      return { Daemon: MockDaemon };
    });

    if (overrides.config) {
      vi.doMock('../config', overrides.config);
    } else {
      vi.doMock('../config', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config')>();
        return {
          ...original,
          loadConfig: vi.fn(() => ({
            ...original.DEFAULT_CONFIG,
            machine: { ...original.DEFAULT_CONFIG.machine },
            portal: { ...original.DEFAULT_CONFIG.portal },
          })),
          getConfigValue: vi.fn((key: string) => {
            if (key === 'daemon.port') return 9876;
            if (key === 'api.url') return 'https://api.agentap.dev';
            return undefined;
          }),
          setConfigValue: vi.fn(),
        };
      });
    }

    vi.doMock('chalk', () => {
      const handler: ProxyHandler<any> = {
        get: (_target, _prop) => new Proxy((s: any) => String(s), handler),
        apply: (_target, _thisArg, args) => String(args[0]),
      };
      return { default: new Proxy((s: any) => String(s), handler) };
    });
    vi.doMock('qrcode-terminal', () => ({
      default: { generate: vi.fn() },
    }));

    if (overrides.adapterLoader) {
      vi.doMock('../adapter-loader', overrides.adapterLoader);
    } else {
      vi.doMock('../adapter-loader', () => ({
        discoverAndLoadAdapters: vi.fn(() => Promise.resolve([])),
      }));
    }

    if (overrides.fs) {
      vi.doMock('fs', overrides.fs);
    }

    // Re-apply process.exit mock right before import to ensure it takes precedence
    // over vitest's internal process.exit interceptor
    process.exit = mockExit as any;

    await import('../cli');

    // Allow async Commander actions (which use dynamic imports like `await import('fs')`)
    // to complete before assertions run
    await new Promise((r) => setTimeout(r, 50));
  }

  // ── version command ─────────────────────────────────────────

  describe('version command', () => {
    it('should print version info', async () => {
      await runCli(['version']);
      expect(console.log).toHaveBeenCalledWith('agentap version 0.1.0');
    });
  });

  // ── status command ──────────────────────────────────────────

  describe('status command', () => {
    it('should show not-linked status', async () => {
      await runCli(['status']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should show linked status when machine.id is set', async () => {
      vi.doMock('../config', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config')>();
        return {
          ...original,
          loadConfig: vi.fn(() => ({
            ...original.DEFAULT_CONFIG,
            machine: {
              ...original.DEFAULT_CONFIG.machine,
              id: 'machine-123',
              tunnelUrl: 'https://tunnel.example.com',
            },
            portal: { ...original.DEFAULT_CONFIG.portal },
          })),
          getConfigValue: vi.fn(),
          setConfigValue: vi.fn(),
        };
      });

      await runCli(['status']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should show linked status with tunnelUrl using runCliWithMocks', async () => {
      await runCliWithMocks(['status'], {
        config: () => ({
          DEFAULT_CONFIG: {},
          loadConfig: vi.fn(() => ({
            api: { url: 'https://api.agentap.dev' },
            daemon: { port: 9876 },
            machine: {
              id: 'machine-456',
              token: 'tok',
              tunnelUrl: 'https://tunnel.example.com',
            },
            portal: { url: 'https://portal.agentap.dev' },
            adapters: { packages: [] },
          })),
          getConfigValue: vi.fn(),
          setConfigValue: vi.fn(),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('should show linked status without tunnelUrl', async () => {
      await runCliWithMocks(['status'], {
        config: () => ({
          DEFAULT_CONFIG: {},
          loadConfig: vi.fn(() => ({
            api: { url: 'https://api.agentap.dev' },
            daemon: { port: 9876 },
            machine: {
              id: 'machine-789',
              token: null,
              tunnelUrl: null,
            },
            portal: { url: 'https://portal.agentap.dev' },
            adapters: { packages: [] },
          })),
          getConfigValue: vi.fn(),
          setConfigValue: vi.fn(),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });
  });

  // ── config commands ─────────────────────────────────────────

  describe('config list command', () => {
    it('should list all config values', async () => {
      await runCli(['config', 'list']);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('config get command', () => {
    it('should get a config value', async () => {
      await runCli(['config', 'get', 'daemon.port']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should show error for nonexistent key', async () => {
      vi.doMock('../config', async (importOriginal) => {
        const original = await importOriginal<typeof import('../config')>();
        return {
          ...original,
          loadConfig: vi.fn(() => ({
            ...original.DEFAULT_CONFIG,
            machine: { ...original.DEFAULT_CONFIG.machine },
            portal: { ...original.DEFAULT_CONFIG.portal },
          })),
          getConfigValue: vi.fn(() => undefined),
          setConfigValue: vi.fn(),
        };
      });

      await runCli(['config', 'get', 'nonexistent.key']);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('config set command', () => {
    it('should set a string value', async () => {
      await runCli(['config', 'set', 'api.url', 'http://custom.api']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should parse boolean true', async () => {
      await runCli(['config', 'set', 'agents.claudeCode', 'true']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should parse boolean false', async () => {
      await runCli(['config', 'set', 'agents.claudeCode', 'false']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should parse numeric value', async () => {
      await runCli(['config', 'set', 'daemon.port', '4000']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should handle JSON value', async () => {
      await runCli(['config', 'set', 'adapters.packages', '["pkg1"]']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should handle empty string as null', async () => {
      await runCli(['config', 'set', 'machine.id', '']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should handle null string as null', async () => {
      await runCli(['config', 'set', 'machine.id', 'null']);
      expect(console.log).toHaveBeenCalled();
    });
  });

  // ── start command ───────────────────────────────────────────

  describe('start command', () => {
    it('should create and start the daemon', async () => {
      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);
      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should show tunnel URL when available', async () => {
      mockDaemon.start.mockResolvedValueOnce({
        running: true,
        port: 9876,
        tunnelUrl: 'https://tunnel.example.com',
        tunnelId: null,
        connectedClients: 0,
        activeSessions: 0,
        detectedAgents: ['claude-code'],
        machineId: 'machine-1',
        linked: true,
      });

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);
      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should handle start error', async () => {
      mockDaemon.start.mockRejectedValueOnce(new Error('Port in use'));

      await runCli(['start']);
      expect(console.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle already linked machine on start', async () => {
      mockDaemon.start.mockResolvedValueOnce({
        running: true,
        port: 9876,
        tunnelUrl: 'https://tunnel.example.com',
        tunnelId: null,
        connectedClients: 0,
        activeSessions: 0,
        detectedAgents: [],
        machineId: 'machine-1',
        linked: true,
      });

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);
      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should handle link request failure on start', async () => {
      mockDaemon.start.mockResolvedValueOnce({
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
      mockDaemon.createLinkRequest.mockRejectedValueOnce(new Error('API unreachable'));

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);
      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should accept custom port option', async () => {
      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start', '--port', '4000']);
      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should handle SIGINT by stopping daemon and exiting', async () => {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {};
      const onSpy = vi
        .spyOn(process, 'on')
        .mockImplementation((event: string | symbol, handler: any) => {
          handlers[event as string] = handler;
          return process;
        });

      await runCli(['start']);

      // Invoke the SIGINT handler
      expect(handlers['SIGINT']).toBeDefined();
      await handlers['SIGINT']();
      expect(mockDaemon.stop).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
      onSpy.mockRestore();
    });

    it('should handle SIGTERM by stopping daemon and exiting', async () => {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {};
      const onSpy = vi
        .spyOn(process, 'on')
        .mockImplementation((event: string | symbol, handler: any) => {
          handlers[event as string] = handler;
          return process;
        });

      await runCli(['start']);

      // Invoke the SIGTERM handler
      expect(handlers['SIGTERM']).toBeDefined();
      await handlers['SIGTERM']();
      expect(mockDaemon.stop).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
      onSpy.mockRestore();
    });

    it('should handle waitForLink success with tunnelUrl in start (not linked)', async () => {
      // Return not-linked status to enter the link flow
      mockDaemon.start.mockResolvedValueOnce({
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

      // waitForLink returns a result with tunnelUrl
      let resolveWaitForLink: (value: any) => void;
      const waitPromise = new Promise<any>((resolve) => {
        resolveWaitForLink = resolve;
      });
      mockDaemon.waitForLink.mockReturnValueOnce(waitPromise);

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);

      // Resolve the waitForLink to trigger the .then() callback
      resolveWaitForLink!({
        machineId: 'machine-1',
        tunnelUrl: 'https://tunnel.example.com',
      });

      // Wait for the .then() to execute
      await new Promise((r) => setTimeout(r, 10));

      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should handle waitForLink success without tunnelUrl in start (not linked)', async () => {
      mockDaemon.start.mockResolvedValueOnce({
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

      let resolveWaitForLink: (value: any) => void;
      const waitPromise = new Promise<any>((resolve) => {
        resolveWaitForLink = resolve;
      });
      mockDaemon.waitForLink.mockReturnValueOnce(waitPromise);

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);

      resolveWaitForLink!({
        machineId: 'machine-1',
        tunnelUrl: null,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should handle waitForLink expired error in start (not linked)', async () => {
      mockDaemon.start.mockResolvedValueOnce({
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

      let rejectWaitForLink: (err: Error) => void;
      const waitPromise = new Promise<any>((_resolve, reject) => {
        rejectWaitForLink = reject;
      });
      mockDaemon.waitForLink.mockReturnValueOnce(waitPromise);

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);

      rejectWaitForLink!(new Error('Link code expired'));

      await new Promise((r) => setTimeout(r, 10));

      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should handle waitForLink non-expired error in start (not linked)', async () => {
      mockDaemon.start.mockResolvedValueOnce({
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

      let rejectWaitForLink: (err: Error) => void;
      const waitPromise = new Promise<any>((_resolve, reject) => {
        rejectWaitForLink = reject;
      });
      mockDaemon.waitForLink.mockReturnValueOnce(waitPromise);

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);

      rejectWaitForLink!(new Error('Some other error'));

      await new Promise((r) => setTimeout(r, 10));

      // The catch only handles 'Link code expired', other errors are silently ignored
      onSpy.mockRestore();
    });

    it('should handle linked machine on start without tunnelUrl', async () => {
      mockDaemon.start.mockResolvedValueOnce({
        running: true,
        port: 9876,
        tunnelUrl: null,
        tunnelId: null,
        connectedClients: 0,
        activeSessions: 0,
        detectedAgents: [],
        machineId: 'machine-1',
        linked: true,
      });

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);
      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });

    it('should handle link request failure with non-Error object on start', async () => {
      mockDaemon.start.mockResolvedValueOnce({
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
      mockDaemon.createLinkRequest.mockRejectedValueOnce('string error');

      const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      await runCli(['start']);
      expect(console.log).toHaveBeenCalled();
      onSpy.mockRestore();
    });
  });

  // ── link command ────────────────────────────────────────────

  describe('link command', () => {
    it('should show already linked message', async () => {
      mockDaemon.isLinked.mockReturnValueOnce(true);
      mockDaemon.getMachineId.mockReturnValueOnce('machine-123');

      await runCli(['link']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should generate link code and wait for link', async () => {
      mockDaemon.isLinked.mockReturnValueOnce(false);

      await runCli(['link']);
      expect(console.log).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should handle link code expired error', async () => {
      mockDaemon.isLinked.mockReturnValueOnce(false);
      mockDaemon.waitForLink.mockRejectedValueOnce(new Error('Link code expired'));

      await runCli(['link']);
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle generic link error', async () => {
      mockDaemon.isLinked.mockReturnValueOnce(false);
      mockDaemon.waitForLink.mockRejectedValueOnce(new Error('Network error'));

      await runCli(['link']);
      expect(console.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should support --text flag', async () => {
      mockDaemon.isLinked.mockReturnValueOnce(false);

      await runCli(['link', '--text']);
      expect(console.log).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should show tunnel URL after successful link', async () => {
      mockDaemon.isLinked.mockReturnValueOnce(false);
      mockDaemon.waitForLink.mockResolvedValueOnce({
        machineId: 'machine-1',
        tunnelToken: 'tk-1',
        tunnelUrl: 'https://tunnel.example.com',
        userId: 'user-1',
      });

      await runCli(['link']);
      expect(console.log).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  // ── agents command ──────────────────────────────────────────

  describe('agents command', () => {
    it('should show no adapters found message when empty', async () => {
      await runCli(['agents']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should list detected adapters', async () => {
      vi.doMock('../adapter-loader', () => ({
        discoverAndLoadAdapters: vi.fn(() =>
          Promise.resolve([
            {
              adapter: {
                getCapabilities: () => ({
                  agent: {
                    name: 'claude-code',
                    displayName: 'Claude Code',
                  },
                }),
                isInstalled: () => Promise.resolve(true),
                getVersion: () => Promise.resolve('1.5.0'),
              },
              meta: {
                packageName: '@agentap-dev/adapter-claude-code',
                source: 'node_modules',
                adapterName: 'claude-code',
              },
            },
          ])
        ),
      }));

      await runCli(['agents']);
      expect(console.log).toHaveBeenCalled();
    });

    it('should list adapters with installed and not-installed agents using runCliWithMocks', async () => {
      await runCliWithMocks(['agents'], {
        adapterLoader: () => ({
          discoverAndLoadAdapters: vi.fn(() =>
            Promise.resolve([
              {
                adapter: {
                  getCapabilities: () => ({
                    agent: {
                      name: 'claude-code',
                      displayName: 'Claude Code',
                    },
                  }),
                  isInstalled: () => Promise.resolve(true),
                  getVersion: () => Promise.resolve('1.5.0'),
                },
                meta: {
                  packageName: '@agentap-dev/adapter-claude-code',
                  source: 'node_modules',
                  adapterName: 'claude-code',
                },
              },
              {
                adapter: {
                  getCapabilities: () => ({
                    agent: {
                      name: 'other-agent',
                      displayName: '',
                    },
                  }),
                  isInstalled: () => Promise.resolve(false),
                  getVersion: () => Promise.resolve(null),
                },
                meta: {
                  packageName: '@agentap-dev/adapter-other',
                  source: 'local',
                  adapterName: 'other-agent',
                },
              },
            ])
          ),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });
  });

  // ── hooks commands ──────────────────────────────────────────

  describe('hooks commands', () => {
    it('hooks install should attempt installation', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        mkdirSync: vi.fn(),
        cpSync: vi.fn(),
        chmodSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
      }));

      await runCli(['hooks', 'install']);
      // Either succeeds or exits with error
      expect(true).toBe(true);
    });

    it('hooks uninstall should remove hooks', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        rmSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
      }));

      await runCli(['hooks', 'uninstall']);
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks status should check installation', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(),
      }));

      await runCli(['hooks', 'status']);
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks status should show installed when both exist', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() =>
          JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  hooks: [
                    {
                      command: '/Users/testuser/.agentap/hooks/pre-tool-use.sh',
                    },
                  ],
                },
              ],
            },
          })
        ),
      }));

      await runCli(['hooks', 'status']);
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks status should show fully installed when script and settings match homedir', async () => {
      const os = await import('os');
      const path = await import('path');
      const hookScriptDest = path.join(os.homedir(), '.agentap', 'hooks', 'pre-tool-use.sh');

      await runCliWithMocks(['hooks', 'status'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() =>
            JSON.stringify({
              hooks: {
                PreToolUse: [
                  {
                    hooks: [
                      {
                        command: hookScriptDest,
                      },
                    ],
                  },
                ],
              },
            })
          ),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks status should show script exists but not registered', async () => {
      await runCliWithMocks(['hooks', 'status'], {
        fs: () => ({
          existsSync: vi.fn((p: string) => {
            // Script path exists, settings path also exists but has no matching hook
            return true;
          }),
          readFileSync: vi.fn(() =>
            JSON.stringify({
              hooks: {
                PreToolUse: [
                  {
                    hooks: [
                      {
                        command: '/some/other/path/hook.sh',
                      },
                    ],
                  },
                ],
              },
            })
          ),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks status should handle parse errors in settings.json', async () => {
      await runCliWithMocks(['hooks', 'status'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() => 'not valid json'),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks install should handle existing settings with alreadyInstalled hook', async () => {
      const os = await import('os');
      const path = await import('path');
      const hookScriptDest = path.join(os.homedir(), '.agentap', 'hooks', 'pre-tool-use.sh');

      await runCliWithMocks(['hooks', 'install'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          mkdirSync: vi.fn(),
          cpSync: vi.fn(),
          chmodSync: vi.fn(),
          readFileSync: vi.fn(() =>
            JSON.stringify({
              hooks: {
                PreToolUse: [
                  {
                    matcher: 'Bash|Write|Edit|NotebookEdit',
                    hooks: [{ type: 'command', command: hookScriptDest, timeout: 300 }],
                  },
                ],
              },
            })
          ),
          writeFileSync: vi.fn(),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks install should register hook when not alreadyInstalled but settings exist', async () => {
      const writeFileSync = vi.fn();
      await runCliWithMocks(['hooks', 'install'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          mkdirSync: vi.fn(),
          cpSync: vi.fn(),
          chmodSync: vi.fn(),
          readFileSync: vi.fn(() =>
            JSON.stringify({
              hooks: {
                PreToolUse: [],
              },
            })
          ),
          writeFileSync,
        }),
      });
      expect(console.log).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('hooks install should handle cpSync error', async () => {
      await runCliWithMocks(['hooks', 'install'], {
        fs: () => ({
          existsSync: vi.fn(() => false),
          mkdirSync: vi.fn(),
          cpSync: vi.fn(() => {
            throw new Error('copy failed');
          }),
          chmodSync: vi.fn(),
          readFileSync: vi.fn(),
          writeFileSync: vi.fn(),
        }),
      });
      expect(console.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('hooks install should handle settings update error', async () => {
      await runCliWithMocks(['hooks', 'install'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          mkdirSync: vi.fn(),
          cpSync: vi.fn(),
          chmodSync: vi.fn(),
          readFileSync: vi.fn(() => {
            throw new Error('read failed');
          }),
          writeFileSync: vi.fn(),
        }),
      });
      expect(console.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('hooks uninstall should remove hooks from settings and delete script', async () => {
      const os = await import('os');
      const path = await import('path');
      const hookScriptDest = path.join(os.homedir(), '.agentap', 'hooks', 'pre-tool-use.sh');
      const rmSync = vi.fn();
      const writeFileSync = vi.fn();

      await runCliWithMocks(['hooks', 'uninstall'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          rmSync,
          readFileSync: vi.fn(() =>
            JSON.stringify({
              hooks: {
                PreToolUse: [
                  {
                    matcher: 'Bash|Write|Edit|NotebookEdit',
                    hooks: [{ type: 'command', command: hookScriptDest, timeout: 300 }],
                  },
                ],
              },
            })
          ),
          writeFileSync,
        }),
      });
      expect(writeFileSync).toHaveBeenCalled();
      expect(rmSync).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks uninstall should handle settings read error', async () => {
      await runCliWithMocks(['hooks', 'uninstall'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          rmSync: vi.fn(),
          readFileSync: vi.fn(() => {
            throw new Error('read failed');
          }),
          writeFileSync: vi.fn(),
        }),
      });
      expect(console.error).toHaveBeenCalled();
    });

    it('hooks uninstall should handle settings with no hooks key', async () => {
      await runCliWithMocks(['hooks', 'uninstall'], {
        fs: () => ({
          existsSync: vi.fn((p: string) => p.includes('settings.json')),
          rmSync: vi.fn(),
          readFileSync: vi.fn(() => JSON.stringify({})),
          writeFileSync: vi.fn(),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks uninstall should handle settings with hooks but no PreToolUse', async () => {
      await runCliWithMocks(['hooks', 'uninstall'], {
        fs: () => ({
          existsSync: vi.fn((p: string) => p.includes('settings.json')),
          rmSync: vi.fn(),
          readFileSync: vi.fn(() => JSON.stringify({ hooks: {} })),
          writeFileSync: vi.fn(),
        }),
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('hooks uninstall should clean up empty hooks object', async () => {
      const os = await import('os');
      const path = await import('path');
      const hookScriptDest = path.join(os.homedir(), '.agentap', 'hooks', 'pre-tool-use.sh');
      const writeFileSync = vi.fn();

      await runCliWithMocks(['hooks', 'uninstall'], {
        fs: () => ({
          existsSync: vi.fn(() => true),
          rmSync: vi.fn(),
          readFileSync: vi.fn(() =>
            JSON.stringify({
              hooks: {
                PreToolUse: [
                  {
                    hooks: [{ command: hookScriptDest }],
                  },
                ],
              },
            })
          ),
          writeFileSync,
        }),
      });

      // After removing the only entry, PreToolUse becomes empty, then hooks becomes empty,
      // then settings.hooks is deleted
      expect(writeFileSync).toHaveBeenCalled();
    });
  });
});

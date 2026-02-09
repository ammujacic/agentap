import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Module-level mocks ───────────────────────────────────────────────

// Mock child process
const mockSpawnProcess = {
  stdout: new EventEmitter(),
  stderr: new EventEmitter(),
  on: vi.fn(),
  kill: vi.fn(),
  removeAllListeners: vi.fn(),
};

// Reset stdout/stderr for each test
function resetMockProcess() {
  mockSpawnProcess.stdout = new EventEmitter();
  mockSpawnProcess.stderr = new EventEmitter();
  mockSpawnProcess.on = vi.fn();
  mockSpawnProcess.kill = vi.fn();
  mockSpawnProcess.removeAllListeners = vi.fn();
  // Also add removeAllListeners to stdout/stderr
  (mockSpawnProcess.stdout as any).removeAllListeners = vi.fn();
  (mockSpawnProcess.stderr as any).removeAllListeners = vi.fn();
}

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockSpawnProcess),
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  createWriteStream: vi.fn(() => ({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  })),
  chmodSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
  platform: vi.fn(() => 'darwin'),
  arch: vi.fn(() => 'arm64'),
}));

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(() => Promise.resolve()),
}));

vi.mock('stream', () => ({
  Readable: {
    fromWeb: vi.fn(() => ({})),
  },
}));

// Import after mocks
import { TunnelManager } from '../services/tunnel';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { platform, arch } from 'os';

// ── Test Suite ───────────────────────────────────────────────────────

describe('TunnelManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetMockProcess();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('should create instance with options', () => {
      const tm = new TunnelManager({ localPort: 9876 });
      expect(tm).toBeInstanceOf(TunnelManager);
      expect(tm).toBeInstanceOf(EventEmitter);
    });

    it('should start with no tunnel URL', () => {
      const tm = new TunnelManager({ localPort: 9876 });
      expect(tm.getTunnelUrl()).toBeNull();
    });

    it('should start with no tunnel ID', () => {
      const tm = new TunnelManager({ localPort: 9876 });
      expect(tm.getTunnelId()).toBeNull();
    });

    it('should not be running initially', () => {
      const tm = new TunnelManager({ localPort: 9876 });
      expect(tm.isRunning()).toBe(false);
    });

    it('should not be a named tunnel initially', () => {
      const tm = new TunnelManager({ localPort: 9876 });
      expect(tm.isNamedTunnel()).toBe(false);
    });
  });

  // ── isCloudflaredInstalled ─────────────────────────────────

  describe('isCloudflaredInstalled()', () => {
    it('should return true when cloudflared exits with code 0', async () => {
      const tm = new TunnelManager({ localPort: 9876 });

      // Mock the spawn call for version check
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn).mockReturnValueOnce(versionProcess as any);

      const result = await tm.isCloudflaredInstalled();
      expect(result).toBe(true);
      expect(spawn).toHaveBeenCalledWith('cloudflared', ['--version']);
    });

    it('should return false when cloudflared exits with non-zero code', async () => {
      const tm = new TunnelManager({ localPort: 9876 });

      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(1), 0);
        }),
      };
      vi.mocked(spawn).mockReturnValueOnce(versionProcess as any);

      const result = await tm.isCloudflaredInstalled();
      expect(result).toBe(false);
    });

    it('should return false on spawn error', async () => {
      const tm = new TunnelManager({ localPort: 9876 });

      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'error') setTimeout(() => cb(new Error('ENOENT')), 0);
        }),
      };
      vi.mocked(spawn).mockReturnValueOnce(versionProcess as any);

      const result = await tm.isCloudflaredInstalled();
      expect(result).toBe(false);
    });
  });

  // ── installCloudflared ─────────────────────────────────────

  describe('installCloudflared()', () => {
    it('should try brew on macOS', async () => {
      vi.mocked(platform).mockReturnValue('darwin' as any);

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(execSync).toHaveBeenCalledWith('which brew', { stdio: 'ignore' });
      expect(execSync).toHaveBeenCalledWith('brew install cloudflared', { stdio: 'inherit' });
    });

    it('should fall back to direct download when brew is not available', async () => {
      vi.mocked(platform).mockReturnValue('darwin' as any);
      vi.mocked(arch).mockReturnValue('arm64' as any);
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === 'which brew') throw new Error('not found');
        return Buffer.from('');
      });

      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary-content'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('cloudflared-darwin-arm64'));
      fetchSpy.mockRestore();
    });

    it('should download linux-amd64 binary for linux x64', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('x64' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary-content'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('cloudflared-linux-amd64'));
      fetchSpy.mockRestore();
    });

    it('should download linux-arm64 binary for linux aarch64', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('arm64' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary-content'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('cloudflared-linux-arm64'));
      fetchSpy.mockRestore();
    });

    it('should download linux-arm binary for linux arm', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('arm' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary-content'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('cloudflared-linux-arm'));
      fetchSpy.mockRestore();
    });

    it('should throw for unsupported platform', async () => {
      vi.mocked(platform).mockReturnValue('win32' as any);
      vi.mocked(arch).mockReturnValue('x64' as any);

      const tm = new TunnelManager({ localPort: 9876 });
      await expect(tm.installCloudflared()).rejects.toThrow('Unsupported platform');
    });

    it('should throw on failed download', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('x64' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 404, statusText: 'Not Found' }));

      const tm = new TunnelManager({ localPort: 9876 });
      await expect(tm.installCloudflared()).rejects.toThrow('Failed to download');
      fetchSpy.mockRestore();
    });

    it('should create install directory if not exists', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('x64' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.agentap/bin'), {
        recursive: true,
      });
      fetchSpy.mockRestore();
    });

    it('should chmod the downloaded binary', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('x64' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(chmodSync).toHaveBeenCalledWith(expect.stringContaining('cloudflared'), 0o755);
      fetchSpy.mockRestore();
    });

    it('should download darwin-amd64 for macOS x64', async () => {
      vi.mocked(platform).mockReturnValue('darwin' as any);
      vi.mocked(arch).mockReturnValue('x64' as any);
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === 'which brew') throw new Error('not found');
        return Buffer.from('');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('cloudflared-darwin-amd64'));
      fetchSpy.mockRestore();
    });
  });

  // ── start() (anonymous quick tunnel) ──────────────────────

  describe('start()', () => {
    it('should spawn cloudflared with correct args', async () => {
      // Make isCloudflaredInstalled return true
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any) // version check
        .mockReturnValueOnce(mockSpawnProcess as any); // actual tunnel

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      // Simulate tunnel URL appearing in output
      setTimeout(() => {
        mockSpawnProcess.stderr.emit(
          'data',
          Buffer.from('https://test-tunnel-1234.trycloudflare.com')
        );
      }, 10);

      const result = await startPromise;
      expect(result.tunnelUrl).toBe('https://test-tunnel-1234.trycloudflare.com');
      expect(result.tunnelId).toBeDefined();
    });

    it('should throw if tunnel already running', async () => {
      // Make isCloudflaredInstalled return true
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('https://test-tunnel.trycloudflare.com'));
      }, 10);

      await startPromise;

      // Second start should throw
      await expect(tm.start()).rejects.toThrow('Tunnel already running');
    });

    it('should emit connected event', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const connectedSpy = vi.fn();
      tm.on('connected', connectedSpy);

      const startPromise = tm.start();

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('https://test-tunnel.trycloudflare.com'));
      }, 10);

      await startPromise;
      expect(connectedSpy).toHaveBeenCalledWith(
        'https://test-tunnel.trycloudflare.com',
        expect.any(String)
      );
    });

    it('should reject on process error', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const errorSpy = vi.fn();
      tm.on('error', errorSpy);

      const startPromise = tm.start();

      // Find and call the error handler
      setTimeout(() => {
        const errorCall = mockSpawnProcess.on.mock.calls.find((call: any[]) => call[0] === 'error');
        if (errorCall) {
          errorCall[1](new Error('spawn failed'));
        }
      }, 10);

      await expect(startPromise).rejects.toThrow('spawn failed');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should emit disconnected when process closes normally', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const disconnectedSpy = vi.fn();
      tm.on('disconnected', disconnectedSpy);

      const startPromise = tm.start();

      // First emit URL to resolve the promise
      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('https://test-tunnel.trycloudflare.com'));
      }, 10);

      await startPromise;

      // Then simulate process close with code 0 (past max reconnects)
      // Set reconnectAttempts to max so it emits disconnected
      const closeCall = mockSpawnProcess.on.mock.calls.find((call: any[]) => call[0] === 'close');
      if (closeCall) {
        // Close with code 0 means normal exit, should emit disconnected
        closeCall[1](0);
      }

      expect(disconnectedSpy).toHaveBeenCalled();
    });

    it('should handle URL in stdout', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      setTimeout(() => {
        mockSpawnProcess.stdout.emit(
          'data',
          Buffer.from('Your quick tunnel: https://quick-abc.trycloudflare.com')
        );
      }, 10);

      const result = await startPromise;
      expect(result.tunnelUrl).toBe('https://quick-abc.trycloudflare.com');
    });

    it('should reject on timeout', async () => {
      vi.useFakeTimers();

      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') cb(0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      tm.on('error', vi.fn());
      const startPromise = tm.start();

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const expectation = expect(startPromise).rejects.toThrow('Tunnel startup timeout');

      await vi.advanceTimersByTimeAsync(31000);

      await expectation;
    });
  });

  // ── startWithToken() (named tunnel) ───────────────────────

  describe('startWithToken()', () => {
    it('should spawn cloudflared with token args', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.startWithToken('my-tunnel-token');

      setTimeout(() => {
        mockSpawnProcess.stderr.emit(
          'data',
          Buffer.from('Registered tunnel connection connIndex=0')
        );
      }, 10);

      await startPromise;

      expect(spawn).toHaveBeenCalledWith('cloudflared', [
        'tunnel',
        '--no-autoupdate',
        'run',
        '--token',
        'my-tunnel-token',
      ]);
    });

    it('should throw if tunnel already running', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.startWithToken('token1');

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('Registered tunnel connection'));
      }, 10);

      await startPromise;

      await expect(tm.startWithToken('token2')).rejects.toThrow('Tunnel already running');
    });

    it('should emit connected event for named tunnel', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const connectedSpy = vi.fn();
      tm.on('connected', connectedSpy);

      const startPromise = tm.startWithToken('token');

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('Registered tunnel connection'));
      }, 10);

      await startPromise;
      expect(connectedSpy).toHaveBeenCalledWith('named-tunnel', 'named');
      expect(tm.isNamedTunnel()).toBe(true);
    });

    it('should reject on process error', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      tm.on('error', vi.fn()); // Prevent EventEmitter from throwing on 'error' event
      const startPromise = tm.startWithToken('token');

      setTimeout(() => {
        const errorCall = mockSpawnProcess.on.mock.calls.find((call: any[]) => call[0] === 'error');
        if (errorCall) {
          errorCall[1](new Error('spawn error'));
        }
      }, 10);

      await expect(startPromise).rejects.toThrow('spawn error');
    });

    it('should reject on timeout for named tunnel', async () => {
      vi.useFakeTimers();

      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') cb(0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      tm.on('error', vi.fn());
      const startPromise = tm.startWithToken('token');

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const expectation = expect(startPromise).rejects.toThrow('Named tunnel startup timeout');

      await vi.advanceTimersByTimeAsync(31000);

      await expectation;
    });

    it('should return early if another start is in progress', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });

      // Start the first one
      const firstStart = tm.startWithToken('token');

      // Immediately try to start another - should return early
      const secondStart = tm.startWithToken('token2');

      // Resolve the first one
      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('Registered tunnel connection'));
      }, 10);

      await firstStart;

      // Second should have returned undefined (early return)
      expect(secondStart).toBeInstanceOf(Promise);
    });

    it('should handle reconnection on non-zero exit', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.startWithToken('token');

      // Resolve first
      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('Registered tunnel connection'));
      }, 10);

      await startPromise;

      // Now simulate a non-zero exit (should trigger reconnection)
      const closeCall = mockSpawnProcess.on.mock.calls.find((call: any[]) => call[0] === 'close');
      if (closeCall) {
        closeCall[1](1); // Non-zero exit
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('reconnecting'));
    });
  });

  // ── stop() ────────────────────────────────────────────────

  describe('stop()', () => {
    it('should kill the process', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('https://test-tunnel.trycloudflare.com'));
      }, 10);

      await startPromise;

      tm.stop();

      expect(mockSpawnProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(tm.isRunning()).toBe(false);
      expect(tm.getTunnelUrl()).toBeNull();
    });

    it('should be safe to call when not running', () => {
      const tm = new TunnelManager({ localPort: 9876 });
      expect(() => tm.stop()).not.toThrow();
    });
  });

  // ── Getter methods ────────────────────────────────────────

  describe('getter methods', () => {
    it('getTunnelUrl should return URL after connected', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('https://my-tunnel.trycloudflare.com'));
      }, 10);

      await startPromise;
      expect(tm.getTunnelUrl()).toBe('https://my-tunnel.trycloudflare.com');
    });

    it('getTunnelId should return ID after start', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('https://tunnel.trycloudflare.com'));
      }, 10);

      await startPromise;
      expect(tm.getTunnelId()).toBeTruthy();
      expect(typeof tm.getTunnelId()).toBe('string');
    });

    it('isRunning should return true when tunnel is active', async () => {
      const versionProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn)
        .mockReturnValueOnce(versionProcess as any)
        .mockReturnValueOnce(mockSpawnProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      setTimeout(() => {
        mockSpawnProcess.stderr.emit('data', Buffer.from('https://tunnel.trycloudflare.com'));
      }, 10);

      await startPromise;
      expect(tm.isRunning()).toBe(true);
    });
  });

  // ── ensureCloudflared (private, tested via start) ─────────

  describe('ensureCloudflared (via start)', () => {
    it('should auto-install if not found', async () => {
      // Ensure execSync is clean (earlier tests may set mockImplementation that persists)
      vi.mocked(execSync).mockReset();

      // First call: version check fails
      const failProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'error') setTimeout(() => cb(new Error('ENOENT')), 0);
        }),
      };

      // Second call: version check succeeds (after brew install)
      const successProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 0);
        }),
      };

      vi.mocked(spawn)
        .mockReturnValueOnce(failProcess as any) // first version check
        .mockReturnValueOnce(successProcess as any) // second version check
        .mockReturnValueOnce(mockSpawnProcess as any); // actual tunnel start

      const tm = new TunnelManager({ localPort: 9876 });
      const startPromise = tm.start();

      // Wait until all 3 spawn calls have been made (version check x2 + tunnel)
      await vi.waitFor(() => {
        expect(vi.mocked(spawn)).toHaveBeenCalledTimes(3);
      });

      // Now handlers are registered on mockSpawnProcess — emit the URL
      mockSpawnProcess.stderr.emit('data', Buffer.from('https://tunnel.trycloudflare.com'));

      await startPromise;
      expect(execSync).toHaveBeenCalledWith('brew install cloudflared', { stdio: 'inherit' });
    });

    it('should throw if auto-install fails and still not found', async () => {
      vi.mocked(platform).mockReturnValue('win32' as any);
      const failProcess = {
        on: vi.fn((event: string, cb: (arg?: any) => void) => {
          if (event === 'error') setTimeout(() => cb(new Error('ENOENT')), 0);
        }),
      };

      vi.mocked(spawn).mockReturnValue(failProcess as any);

      const tm = new TunnelManager({ localPort: 9876 });
      await expect(tm.start()).rejects.toThrow('Unsupported platform');
    });
  });

  // ── getCloudflaredBinaryName (private, tested via install) ─

  describe('binary name selection', () => {
    it('should return null for unsupported linux arch', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('mips' as any);

      const tm = new TunnelManager({ localPort: 9876 });
      await expect(tm.installCloudflared()).rejects.toThrow('Unsupported platform');
    });

    it('should handle linux amd64 arch', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('amd64' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('cloudflared-linux-amd64'));
      fetchSpy.mockRestore();
    });

    it('should handle linux aarch64 arch', async () => {
      vi.mocked(platform).mockReturnValue('linux' as any);
      vi.mocked(arch).mockReturnValue('aarch64' as any);
      vi.mocked(existsSync).mockReturnValue(false);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(Buffer.from('binary'), { status: 200 }));

      const tm = new TunnelManager({ localPort: 9876 });
      await tm.installCloudflared();

      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('cloudflared-linux-arm64'));
      fetchSpy.mockRestore();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadConfig,
  DEFAULT_CONFIG,
  getConfigDir,
  getConfigPath,
  getPidfilePath,
  ensureConfigDir,
  saveConfig,
  getConfigValue,
  setConfigValue,
} from '../config';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('fs');
vi.mock('os');
vi.mock('@iarna/toml', () => ({
  default: {
    parse: vi.fn((content: string) => JSON.parse(content)),
    stringify: vi.fn((obj: object) => JSON.stringify(obj)),
  },
}));

const originalEnv = { ...process.env };

describe('Config', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/home/testuser');
    process.env = { ...originalEnv };
    // Clear env vars that could interfere with tests
    delete process.env.API_URL;
    delete process.env.PORTAL_URL;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Existing tests ──────────────────────────────────────────────

  it('should return default config when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadConfig();

    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should have correct default port', () => {
    expect(DEFAULT_CONFIG.daemon.port).toBe(9876);
  });

  it('should have correct default API URL', () => {
    expect(DEFAULT_CONFIG.api.url).toBe('https://api.agentap.dev');
  });

  it('should define all agent types in defaults', () => {
    expect(DEFAULT_CONFIG.agents).toHaveProperty('claudeCode');
    expect(DEFAULT_CONFIG.agents).toHaveProperty('codex');
    expect(DEFAULT_CONFIG.agents).toHaveProperty('aider');
    expect(DEFAULT_CONFIG.agents).toHaveProperty('opencode');
  });

  it('should have all agents enabled by default', () => {
    expect(DEFAULT_CONFIG.agents.claudeCode).toBe(true);
    expect(DEFAULT_CONFIG.agents.codex).toBe(true);
    expect(DEFAULT_CONFIG.agents.aider).toBe(true);
    expect(DEFAULT_CONFIG.agents.opencode).toBe(true);
  });

  // ── getConfigDir ────────────────────────────────────────────────

  describe('getConfigDir', () => {
    it('should return path based on homedir', () => {
      const dir = getConfigDir();
      expect(dir).toBe('/home/testuser/.agentap');
    });
  });

  // ── getConfigPath ───────────────────────────────────────────────

  describe('getConfigPath', () => {
    it('should return config.toml path inside config dir', () => {
      const path = getConfigPath();
      expect(path).toBe('/home/testuser/.agentap/config.toml');
    });
  });

  // ── getPidfilePath ──────────────────────────────────────────────

  describe('getPidfilePath', () => {
    it('should return daemon.pid path inside config dir', () => {
      const path = getPidfilePath();
      expect(path).toBe('/home/testuser/.agentap/daemon.pid');
    });
  });

  // ── ensureConfigDir ─────────────────────────────────────────────

  describe('ensureConfigDir', () => {
    it('should create directory when it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureConfigDir();

      expect(fs.mkdirSync).toHaveBeenCalledWith('/home/testuser/.agentap', {
        recursive: true,
        mode: 0o700,
      });
    });

    it('should do nothing when directory already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      ensureConfigDir();

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  // ── loadConfig ──────────────────────────────────────────────────

  describe('loadConfig', () => {
    it('should read and parse TOML config when file exists', () => {
      // First existsSync call is for ensureConfigDir (dir exists),
      // second is for the config file itself (file exists)
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(DEFAULT_CONFIG));

      const config = loadConfig();

      expect(fs.readFileSync).toHaveBeenCalledWith('/home/testuser/.agentap/config.toml', 'utf-8');
      expect(config.daemon.port).toBe(DEFAULT_CONFIG.daemon.port);
    });

    it('should merge parsed config with defaults for partial config', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const partialConfig = {
        daemon: { port: 4000 },
        api: { url: 'http://custom-api.example.com' },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(partialConfig));

      const config = loadConfig();

      // Overridden values
      expect(config.daemon.port).toBe(4000);
      expect(config.api.url).toBe('http://custom-api.example.com');
      // Defaults preserved
      expect(config.daemon.logLevel).toBe('info');
      expect(config.agents.claudeCode).toBe(true);
      expect(config.portal.url).toBe('https://app.agentap.dev');
    });

    it('should return defaults on TOML parse error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Invalid TOML');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const config = loadConfig();

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error loading config, using defaults:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should override api.url from API_URL env var', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.API_URL = 'http://env-api.example.com';

      const config = loadConfig();

      expect(config.api.url).toBe('http://env-api.example.com');
    });

    it('should override portal.url from PORTAL_URL env var', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.PORTAL_URL = 'http://env-portal.example.com';

      const config = loadConfig();

      expect(config.portal.url).toBe('http://env-portal.example.com');
    });

    it('should override daemon.port from PORT env var', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.PORT = '3000';

      const config = loadConfig();

      expect(config.daemon.port).toBe(3000);
    });
  });

  // ── saveConfig ──────────────────────────────────────────────────

  describe('saveConfig', () => {
    it('should write TOML to correct path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      saveConfig(DEFAULT_CONFIG);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/home/testuser/.agentap/config.toml',
        expect.any(String),
        { encoding: 'utf-8', mode: 0o600 }
      );
    });
  });

  // ── getConfigValue ──────────────────────────────────────────────

  describe('getConfigValue', () => {
    it('should return nested value with dot notation', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const port = getConfigValue('daemon.port');

      expect(port).toBe(DEFAULT_CONFIG.daemon.port);
    });

    it('should return undefined for nonexistent key', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const value = getConfigValue('nonexistent.key.path');

      expect(value).toBeUndefined();
    });
  });

  // ── setConfigValue ──────────────────────────────────────────────

  describe('setConfigValue', () => {
    it('should set nested value and save config', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      setConfigValue('daemon.port', 5555);

      // saveConfig should have been called, which calls writeFileSync
      // The first writeFileSync call is from loadConfig creating defaults,
      // the second is from the setConfigValue save.
      expect(fs.writeFileSync).toHaveBeenCalled();

      // Verify the last call to writeFileSync contains the updated value
      const lastCall = vi.mocked(fs.writeFileSync).mock.calls;
      const lastContent = lastCall[lastCall.length - 1][1] as string;
      const written = JSON.parse(lastContent);
      expect(written.daemon.port).toBe(5555);
    });
  });
});

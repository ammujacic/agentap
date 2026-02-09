/**
 * Daemon configuration
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import TOML from '@iarna/toml';

export interface DaemonConfig {
  daemon: {
    port: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  tunnel: {
    provider: 'cloudflare';
  };
  agents: {
    claudeCode: boolean;
    codex: boolean;
    aider: boolean;
    opencode: boolean;
  };
  adapters: {
    packages: string[];
  };
  api: {
    url: string;
  };
  portal: {
    url: string;
  };
  machine: {
    id: string | null;
    userId: string | null;
    apiSecret: string | null;
    tunnelToken: string | null;
    tunnelUrl: string | null;
  };
  approvals: {
    /** Minimum risk level to route to mobile. Actions below this auto-approve locally. */
    mobileThreshold: 'low' | 'medium' | 'high' | 'critical';
    /** If true, fall through to local VS Code prompt when no mobile client is connected */
    requireClient: boolean;
  };
}

export const DEFAULT_CONFIG: DaemonConfig = {
  daemon: {
    port: 9876,
    logLevel: 'info',
  },
  tunnel: {
    provider: 'cloudflare',
  },
  agents: {
    claudeCode: true,
    codex: true,
    aider: true,
    opencode: true,
  },
  adapters: {
    packages: [],
  },
  api: {
    url: 'https://api.agentap.dev',
  },
  portal: {
    url: 'https://app.agentap.dev',
  },
  machine: {
    id: null,
    userId: null,
    apiSecret: null,
    tunnelToken: null,
    tunnelUrl: null,
  },
  approvals: {
    mobileThreshold: 'medium',
    requireClient: true,
  },
};

/**
 * Get the Agentap config directory path
 */
export function getConfigDir(): string {
  return join(homedir(), '.agentap');
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.toml');
}

/**
 * Get the pidfile path (used by hook scripts to discover the daemon port)
 */
export function getPidfilePath(): string {
  return join(getConfigDir(), 'daemon.pid');
}

/**
 * Ensure config directory exists
 */
export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load configuration from file, or create default if not exists
 */
export function loadConfig(): DaemonConfig {
  ensureConfigDir();

  const configPath = getConfigPath();

  let config: DaemonConfig;

  if (!existsSync(configPath)) {
    // Create default config file
    saveConfig(DEFAULT_CONFIG);
    config = { ...DEFAULT_CONFIG };
  } else {
    try {
      const content = readFileSync(configPath, 'utf-8');
      const parsed = TOML.parse(content) as Record<string, Record<string, unknown>>;

      // Merge with defaults to ensure all keys exist
      config = {
        daemon: { ...DEFAULT_CONFIG.daemon, ...(parsed.daemon as DaemonConfig['daemon']) },
        tunnel: { ...DEFAULT_CONFIG.tunnel, ...(parsed.tunnel as DaemonConfig['tunnel']) },
        agents: { ...DEFAULT_CONFIG.agents, ...(parsed.agents as DaemonConfig['agents']) },
        adapters: { ...DEFAULT_CONFIG.adapters, ...(parsed.adapters as DaemonConfig['adapters']) },
        api: { ...DEFAULT_CONFIG.api, ...(parsed.api as DaemonConfig['api']) },
        portal: { ...DEFAULT_CONFIG.portal, ...(parsed.portal as DaemonConfig['portal']) },
        machine: { ...DEFAULT_CONFIG.machine, ...(parsed.machine as DaemonConfig['machine']) },
        approvals: {
          ...DEFAULT_CONFIG.approvals,
          ...(parsed.approvals as DaemonConfig['approvals']),
        },
      };
    } catch (error) {
      console.error('Error loading config, using defaults:', error);
      config = { ...DEFAULT_CONFIG };
    }
  }

  // Environment variables override config file
  if (process.env.API_URL) {
    config.api.url = process.env.API_URL;
  }
  if (process.env.PORTAL_URL) {
    config.portal.url = process.env.PORTAL_URL;
  }
  if (process.env.PORT) {
    config.daemon.port = parseInt(process.env.PORT, 10);
  }

  return config;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: DaemonConfig): void {
  ensureConfigDir();

  const configPath = getConfigPath();
  const content = TOML.stringify(config as unknown as TOML.JsonMap);

  writeFileSync(configPath, content, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Get a specific config value
 */
export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  const parts = key.split('.');

  let value: unknown = config;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Set a specific config value
 */
export function setConfigValue(key: string, value: unknown): void {
  const config = loadConfig();
  const parts = key.split('.');

  let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in obj)) {
      obj[parts[i]] = {};
    }
    obj = obj[parts[i]] as Record<string, unknown>;
  }

  obj[parts[parts.length - 1]] = value;
  saveConfig(config);
}

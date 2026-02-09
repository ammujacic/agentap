import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DaemonConfig } from '../config';
import { DEFAULT_CONFIG } from '../config';
import type { LoadedAdapter } from '../adapter-loader';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

// Mock getConfigDir from the config module.
// The source file (adapter-loader.ts) imports from './config' which resolves
// to packages/daemon/src/config.ts. From this test file in __tests__/, that
// module is at '../config'.
vi.mock('../config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config')>();
  return {
    ...original,
    getConfigDir: () => '/mock/home/.agentap',
  };
});

import { readdir, readFile, stat } from 'fs/promises';
import type { Dirent, Stats } from 'fs';

// ── Helpers ────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    agents: { ...DEFAULT_CONFIG.agents, ...(overrides.agents ?? {}) },
    adapters: { ...DEFAULT_CONFIG.adapters, ...(overrides.adapters ?? {}) },
  };
}

function validAdapterPkgJson(name: string, adapterName?: string) {
  return JSON.stringify({
    name,
    main: 'index.js',
    agentap: {
      type: 'adapter',
      ...(adapterName ? { name: adapterName } : {}),
    },
  });
}

function nonAdapterPkgJson(name: string) {
  return JSON.stringify({ name, main: 'index.js' });
}

function libraryPkgJson(name: string) {
  return JSON.stringify({
    name,
    main: 'index.js',
    agentap: { type: 'library' },
  });
}

function mockStat(isDir: boolean): Stats {
  return { isDirectory: () => isDir } as unknown as Stats;
}

// ── Test Suite ─────────────────────────────────────────────────────────

describe('adapter-loader', () => {
  let discoverAndLoadAdapters: (config: DaemonConfig) => Promise<LoadedAdapter[]>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();

    // Default: all fs calls throw (no dirs exist)
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));

    // Suppress console output in tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Re-import after resetting modules so mocks are fresh
    const mod = await import('../adapter-loader');
    discoverAndLoadAdapters = mod.discoverAndLoadAdapters;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. discoverAndLoadAdapters basics ──────────────────────────────

  describe('discoverAndLoadAdapters basics', () => {
    it('returns empty array when no adapters are found (all readdir throw)', async () => {
      const result = await discoverAndLoadAdapters(makeConfig());
      expect(result).toEqual([]);
    });

    it('returns empty array when node_modules dirs do not exist', async () => {
      const result = await discoverAndLoadAdapters(makeConfig());
      expect(result).toEqual([]);
      expect(result).toBeInstanceOf(Array);
    });
  });

  // ── 2. Node modules discovery ──────────────────────────────────────

  describe('node modules discovery', () => {
    it('discovers @agentap-dev/adapter-* packages with valid agentap.type', async () => {
      // Use the real @agentap-dev/adapter-claude-code package which exists
      // in this monorepo and can be successfully imported via import().
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-claude-code'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-claude-code') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-claude-code', 'claude-code');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const result = await discoverAndLoadAdapters(makeConfig());

      // The real package is importable, so it should load successfully
      expect(result.length).toBeGreaterThanOrEqual(1);
      const ccAdapter = result.find(
        (r) => r.meta.packageName === '@agentap-dev/adapter-claude-code'
      );
      expect(ccAdapter).toBeDefined();
      expect(ccAdapter!.meta.source).toBe('node_modules');
      expect(ccAdapter!.meta.adapterName).toBe('claude-code');
      expect(readFile).toHaveBeenCalled();
    });

    it('skips adapter-base package', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-base', 'adapter-claude-code'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-base') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-base');
        }
        if (p.includes('adapter-claude-code') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-claude-code', 'claude-code');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      await discoverAndLoadAdapters(makeConfig());

      // adapter-base should never have its package.json read
      const readFileCalls = vi.mocked(readFile).mock.calls.map((c) => String(c[0]));
      const baseReads = readFileCalls.filter((p) => p.includes('adapter-base'));
      expect(baseReads).toHaveLength(0);
    });

    it('discovers agentap-adapter-* community packages', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return [];
        }
        if (p.includes('node_modules')) {
          return ['agentap-adapter-custom', 'some-other-package'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('agentap-adapter-custom') && p.endsWith('package.json')) {
          return validAdapterPkgJson('agentap-adapter-custom', 'custom');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      await discoverAndLoadAdapters(makeConfig());

      const readFileCalls = vi.mocked(readFile).mock.calls.map((c) => String(c[0]));
      const communityReads = readFileCalls.filter((p) => p.includes('agentap-adapter-custom'));
      expect(communityReads.length).toBeGreaterThan(0);
    });

    it('ignores packages without agentap.type="adapter" in package.json', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-notreal'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-notreal') && p.endsWith('package.json')) {
          return nonAdapterPkgJson('@agentap-dev/adapter-notreal');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const result = await discoverAndLoadAdapters(makeConfig());

      expect(result).toEqual([]);
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(0);
    });

    it('ignores packages with agentap.type other than "adapter"', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-lib'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-lib') && p.endsWith('package.json')) {
          return libraryPkgJson('@agentap-dev/adapter-lib');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const result = await discoverAndLoadAdapters(makeConfig());

      expect(result).toEqual([]);
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(0);
    });

    it('handles readdir errors gracefully for scoped directories', async () => {
      await expect(discoverAndLoadAdapters(makeConfig())).resolves.toEqual([]);
    });
  });

  // ── 3. Config adapter discovery ────────────────────────────────────

  describe('config adapter discovery', () => {
    it('handles empty packages array in config', async () => {
      const config = makeConfig({ adapters: { packages: [] } });
      const result = await discoverAndLoadAdapters(config);
      expect(result).toEqual([]);
    });

    it('handles unresolvable packages gracefully and logs warning', async () => {
      const config = makeConfig({
        adapters: { packages: ['nonexistent-adapter-package'] },
      });
      const result = await discoverAndLoadAdapters(config);

      expect(result).toEqual([]);
      const resolveWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) =>
          String(c[0]).includes('Could not resolve configured adapter package')
        );
      expect(resolveWarns.length).toBeGreaterThanOrEqual(1);
    });

    it('handles config without adapters field', async () => {
      const config = makeConfig();
      (config as unknown as Record<string, unknown>).adapters = undefined;
      const result = await discoverAndLoadAdapters(config);
      expect(result).toEqual([]);
    });
  });

  // ── 4. Local adapter discovery ─────────────────────────────────────

  describe('local adapter discovery', () => {
    it('discovers adapters in ~/.agentap/adapters/', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.endsWith('/adapters') && p.includes('.agentap')) {
          return ['my-local-adapter'];
        }
        throw new Error('ENOENT');
      }) as typeof readdir);

      vi.mocked(stat).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('my-local-adapter')) {
          return mockStat(true);
        }
        throw new Error('ENOENT');
      }) as typeof stat);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('my-local-adapter') && p.endsWith('package.json')) {
          return validAdapterPkgJson('my-local-adapter', 'local-agent');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      await discoverAndLoadAdapters(makeConfig());

      const readFileCalls = vi.mocked(readFile).mock.calls.map((c) => String(c[0]));
      const localReads = readFileCalls.filter((p) => p.includes('my-local-adapter'));
      expect(localReads.length).toBeGreaterThan(0);
    });

    it('skips non-directory entries in local adapters dir', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.endsWith('/adapters') && p.includes('.agentap')) {
          return ['some-file.txt', 'valid-adapter'];
        }
        throw new Error('ENOENT');
      }) as typeof readdir);

      vi.mocked(stat).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('some-file.txt')) {
          return mockStat(false);
        }
        if (p.includes('valid-adapter')) {
          return mockStat(true);
        }
        throw new Error('ENOENT');
      }) as typeof stat);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('valid-adapter') && p.endsWith('package.json')) {
          return validAdapterPkgJson('valid-adapter', 'valid');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      await discoverAndLoadAdapters(makeConfig());

      const readFileCalls = vi.mocked(readFile).mock.calls.map((c) => String(c[0]));
      // Should NOT have tried to read package.json for the file entry
      const fileReads = readFileCalls.filter((p) => p.includes('some-file.txt'));
      expect(fileReads).toHaveLength(0);

      // Should have read valid-adapter's package.json
      const validReads = readFileCalls.filter((p) => p.includes('valid-adapter'));
      expect(validReads.length).toBeGreaterThan(0);
    });

    it('handles missing adapters directory gracefully', async () => {
      await expect(discoverAndLoadAdapters(makeConfig())).resolves.toEqual([]);
    });

    it('validates package.json agentap.type for local adapters', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.endsWith('/adapters') && p.includes('.agentap')) {
          return ['invalid-adapter'];
        }
        throw new Error('ENOENT');
      }) as typeof readdir);

      vi.mocked(stat).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('invalid-adapter')) {
          return mockStat(true);
        }
        throw new Error('ENOENT');
      }) as typeof stat);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('invalid-adapter') && p.endsWith('package.json')) {
          return nonAdapterPkgJson('invalid-adapter');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const result = await discoverAndLoadAdapters(makeConfig());

      expect(result).toEqual([]);
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(0);
    });
  });

  // ── 5. Deduplication ──────────────────────────────────────────────

  describe('deduplication', () => {
    it('deduplicates by packageName (first source wins)', async () => {
      // Both search paths return the same adapter name in their scoped dirs.
      // Discovery finds it twice, but dedup ensures only one load attempt.
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-duped'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-duped') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-duped', 'duped');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      await discoverAndLoadAdapters(makeConfig());

      // Only one "Failed to load" warning because dedup keeps only the first
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(1);
      expect(failedLoadWarns[0][0]).toContain('@agentap-dev/adapter-duped');
    });
  });

  // ── 6. Config filtering (isAdapterEnabled) ────────────────────────

  describe('config filtering', () => {
    it('skips adapters disabled in config (e.g., config.agents.claudeCode = false)', async () => {
      // Use the real adapter-claude-code which is importable in this monorepo.
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-claude-code'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-claude-code') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-claude-code', 'claude-code');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const config = makeConfig({
        agents: { ...DEFAULT_CONFIG.agents, claudeCode: false },
      });

      const result = await discoverAndLoadAdapters(config);

      // The adapter loads successfully (real package) but is filtered out
      expect(result).toEqual([]);

      // Confirm the "disabled in config" log message was emitted
      const disabledLogs = vi
        .mocked(console.log)
        .mock.calls.filter((c) => String(c[0]).includes('disabled in config'));
      expect(disabledLogs.length).toBeGreaterThanOrEqual(1);
    });

    it('loads enabled adapters (config.agents.claudeCode = true)', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-claude-code'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-claude-code') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-claude-code', 'claude-code');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const config = makeConfig({
        agents: { ...DEFAULT_CONFIG.agents, claudeCode: true },
      });

      const result = await discoverAndLoadAdapters(config);

      expect(result.length).toBeGreaterThanOrEqual(1);
      const ccAdapter = result.find(
        (r) => r.meta.packageName === '@agentap-dev/adapter-claude-code'
      );
      expect(ccAdapter).toBeDefined();
      // Verify duck-type detected methods
      expect(typeof ccAdapter!.adapter.getCapabilities).toBe('function');
      expect(typeof ccAdapter!.adapter.isInstalled).toBe('function');
      expect(typeof ccAdapter!.adapter.discoverSessions).toBe('function');
    });

    it('allows unknown adapters by default (not in ADAPTER_CONFIG_MAP)', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('node_modules') && !p.includes('@agentap-dev')) {
          return ['agentap-adapter-unknown'];
        }
        if (p.includes('@agentap-dev')) {
          return [];
        }
        throw new Error('ENOENT');
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('agentap-adapter-unknown') && p.endsWith('package.json')) {
          return validAdapterPkgJson('agentap-adapter-unknown', 'unknown-agent');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const config = makeConfig({
        agents: {
          claudeCode: false,
          codex: false,
          aider: false,
          opencode: false,
        },
      });

      await discoverAndLoadAdapters(config);

      // No "disabled in config" messages for unknown adapters
      const disabledLogs = vi
        .mocked(console.log)
        .mock.calls.filter((c) => String(c[0]).includes('disabled in config'));
      expect(disabledLogs).toHaveLength(0);
    });
  });

  // ── 7. Error handling ─────────────────────────────────────────────

  describe('error handling', () => {
    it('catches and logs adapter load failures without crashing', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-broken'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-broken') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-broken', 'broken');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const result = await discoverAndLoadAdapters(makeConfig());

      expect(result).toEqual([]);
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(1);
      expect(failedLoadWarns[0][0]).toContain('@agentap-dev/adapter-broken');
    });

    it('continues loading other adapters when one fails', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-first', 'adapter-second'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-first') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-first', 'first');
        }
        if (p.includes('adapter-second') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-second', 'second');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const result = await discoverAndLoadAdapters(makeConfig());

      expect(result).toEqual([]);

      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(2);

      const warnTexts = failedLoadWarns.map((c) => String(c[0]));
      expect(warnTexts.some((t) => t.includes('@agentap-dev/adapter-first'))).toBe(true);
      expect(warnTexts.some((t) => t.includes('@agentap-dev/adapter-second'))).toBe(true);
    });

    it('handles corrupted package.json gracefully', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-corrupt'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-corrupt') && p.endsWith('package.json')) {
          return '{ invalid json !!!';
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      const result = await discoverAndLoadAdapters(makeConfig());

      expect(result).toEqual([]);
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(0);
    });

    it('handles readFile errors for package.json gracefully', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-noread'];
        }
        return [];
      }) as typeof readdir);

      // readFile throws ENOENT by default

      const result = await discoverAndLoadAdapters(makeConfig());

      expect(result).toEqual([]);
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(0);
    });
  });

  // ── 8. Mixed sources integration ──────────────────────────────────

  describe('mixed sources', () => {
    it('discovers adapters from both node_modules and local dirs simultaneously', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-npm'];
        }
        if (p.endsWith('/adapters') && p.includes('.agentap')) {
          return ['local-adapter'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(stat).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('local-adapter')) {
          return mockStat(true);
        }
        throw new Error('ENOENT');
      }) as typeof stat);

      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-npm') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-npm', 'npm-agent');
        }
        if (p.includes('local-adapter') && p.endsWith('package.json')) {
          return validAdapterPkgJson('local-adapter', 'local-agent');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      await discoverAndLoadAdapters(makeConfig());

      // Both should have been discovered and load attempted (both fail)
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(2);
      const failedNames = failedLoadWarns.map((c) => String(c[0]));
      expect(failedNames.some((n) => n.includes('@agentap-dev/adapter-npm'))).toBe(true);
      expect(failedNames.some((n) => n.includes('local-adapter'))).toBe(true);
    });

    it('deduplicates across node_modules and local sources', async () => {
      vi.mocked(readdir).mockImplementation((async (dirPath: string) => {
        const p = String(dirPath);
        if (p.includes('@agentap-dev')) {
          return ['adapter-shared'];
        }
        if (p.endsWith('/adapters') && p.includes('.agentap')) {
          return ['adapter-shared-local'];
        }
        return [];
      }) as typeof readdir);

      vi.mocked(stat).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-shared-local')) {
          return mockStat(true);
        }
        throw new Error('ENOENT');
      }) as typeof stat);

      // Both sources produce the same packageName
      vi.mocked(readFile).mockImplementation((async (filePath: string) => {
        const p = String(filePath);
        if (p.includes('adapter-shared') && p.endsWith('package.json')) {
          return validAdapterPkgJson('@agentap-dev/adapter-shared', 'shared-agent');
        }
        throw new Error('ENOENT');
      }) as typeof readFile);

      await discoverAndLoadAdapters(makeConfig());

      // Only one load attempt due to deduplication by packageName
      const failedLoadWarns = vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('Failed to load adapter'));
      expect(failedLoadWarns).toHaveLength(1);
      expect(failedLoadWarns[0][0]).toContain('@agentap-dev/adapter-shared');
    });
  });
});

/**
 * Dynamic adapter plugin discovery and loading.
 *
 * Discovers adapters from three sources:
 * 1. npm packages matching @agentap-dev/adapter-* or agentap-adapter-*
 * 2. Explicitly listed packages in config.adapters.packages
 * 3. Local plugins in ~/.agentap/adapters/
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ACPAdapter } from '@agentap-dev/acp';
import { type DaemonConfig, getConfigDir } from './config';

/** Known adapter names mapped to their config.agents boolean keys */
const ADAPTER_CONFIG_MAP: Record<string, keyof DaemonConfig['agents']> = {
  'claude-code': 'claudeCode',
  codex: 'codex',
  aider: 'aider',
  opencode: 'opencode',
};

interface AdapterPackageJson {
  name: string;
  main?: string;
  module?: string;
  agentap?: {
    type: string;
    name?: string;
  };
}

export interface AdapterPluginMeta {
  packageName: string;
  adapterName: string | null;
  source: 'node_modules' | 'config' | 'local';
  path: string;
}

export interface LoadedAdapter {
  adapter: ACPAdapter;
  meta: AdapterPluginMeta;
}

function isAdapterEnabled(adapterName: string, config: DaemonConfig): boolean {
  const configKey = ADAPTER_CONFIG_MAP[adapterName];
  if (configKey) {
    return config.agents[configKey] !== false;
  }
  // Unknown adapters are enabled by default
  return true;
}

async function readPackageJson(dir: string): Promise<AdapterPackageJson | null> {
  try {
    const content = await readFile(join(dir, 'package.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isValidAdapterPackage(pkg: AdapterPackageJson): boolean {
  return pkg.agentap?.type === 'adapter';
}

/**
 * Scan node_modules for packages matching adapter naming conventions.
 * Checks both the monorepo root and the daemon package's own node_modules.
 */
async function discoverNodeModulesAdapters(): Promise<AdapterPluginMeta[]> {
  const results: AdapterPluginMeta[] = [];
  const thisDir = dirname(fileURLToPath(import.meta.url));

  const searchPaths = [
    join(thisDir, '..', 'node_modules'), // packages/daemon/node_modules
    join(thisDir, '..', '..', '..', 'node_modules'), // monorepo root node_modules
  ];

  for (const nmPath of searchPaths) {
    // Scoped: @agentap-dev/adapter-*
    const scopedDir = join(nmPath, '@agentap-dev');
    try {
      const entries = await readdir(scopedDir);
      for (const entry of entries) {
        if (!entry.startsWith('adapter-') || entry === 'adapter-base') continue;
        const pkgDir = join(scopedDir, entry);
        const pkg = await readPackageJson(pkgDir);
        if (pkg && isValidAdapterPackage(pkg)) {
          results.push({
            packageName: pkg.name,
            adapterName: pkg.agentap?.name ?? null,
            source: 'node_modules',
            path: pkgDir,
          });
        }
      }
    } catch {
      // Directory doesn't exist
    }

    // Community: agentap-adapter-*
    try {
      const entries = await readdir(nmPath);
      for (const entry of entries) {
        if (!entry.startsWith('agentap-adapter-')) continue;
        const pkgDir = join(nmPath, entry);
        const pkg = await readPackageJson(pkgDir);
        if (pkg && isValidAdapterPackage(pkg)) {
          results.push({
            packageName: pkg.name,
            adapterName: pkg.agentap?.name ?? null,
            source: 'node_modules',
            path: pkgDir,
          });
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return results;
}

/**
 * Resolve explicitly configured adapter packages.
 */
async function discoverConfigAdapters(config: DaemonConfig): Promise<AdapterPluginMeta[]> {
  const results: AdapterPluginMeta[] = [];
  const packages = config.adapters?.packages ?? [];

  for (const pkg of packages) {
    try {
      // Try to resolve the package by importing its package.json
      const resolved = await import.meta.resolve?.(pkg);
      if (resolved) {
        const pkgDir = dirname(fileURLToPath(resolved));
        results.push({
          packageName: pkg,
          adapterName: null,
          source: 'config',
          path: pkgDir,
        });
      }
    } catch {
      console.warn(`Could not resolve configured adapter package: ${pkg}`);
    }
  }

  return results;
}

/**
 * Scan ~/.agentap/adapters/ for local adapter plugins.
 */
async function discoverLocalAdapters(): Promise<AdapterPluginMeta[]> {
  const results: AdapterPluginMeta[] = [];
  const localDir = join(getConfigDir(), 'adapters');

  try {
    const entries = await readdir(localDir);
    for (const entry of entries) {
      const pkgDir = join(localDir, entry);
      const s = await stat(pkgDir);
      if (!s.isDirectory()) continue;

      const pkg = await readPackageJson(pkgDir);
      if (pkg && isValidAdapterPackage(pkg)) {
        results.push({
          packageName: pkg.name,
          adapterName: pkg.agentap?.name ?? null,
          source: 'local',
          path: pkgDir,
        });
      }
    }
  } catch {
    // Directory doesn't exist — that's fine
  }

  return results;
}

/**
 * Dynamically import an adapter package and find the adapter class export.
 * Uses duck-typing to identify the class that implements ACPAdapter.
 */
async function loadAdapter(meta: AdapterPluginMeta): Promise<ACPAdapter> {
  // Try package name first (works with Node.js ESM resolution), fall back to path
  let mod: Record<string, unknown>;
  try {
    mod = await import(meta.packageName);
  } catch {
    // Fall back to resolving entry point from package.json
    const pkg = await readPackageJson(meta.path);
    const entry = pkg?.module ?? pkg?.main ?? 'index.js';
    mod = await import(join(meta.path, entry));
  }

  // Check default export first, then named exports
  const candidates = mod.default ? [mod.default, ...Object.values(mod)] : Object.values(mod);

  for (const value of candidates) {
    if (
      typeof value === 'function' &&
      value.prototype &&
      typeof value.prototype.getCapabilities === 'function' &&
      typeof value.prototype.isInstalled === 'function' &&
      typeof value.prototype.discoverSessions === 'function'
    ) {
      return new (value as new () => ACPAdapter)();
    }
  }

  throw new Error(`No valid adapter class found in ${meta.packageName}`);
}

/**
 * Discover and load all adapter plugins.
 *
 * Searches npm packages, config entries, and local plugins.
 * Respects enable/disable flags in config.agents.
 * Errors per-adapter are caught and logged — a broken adapter never crashes the daemon.
 */
export async function discoverAndLoadAdapters(config: DaemonConfig): Promise<LoadedAdapter[]> {
  const allMeta: AdapterPluginMeta[] = [];

  const [nmAdapters, cfgAdapters, localAdapters] = await Promise.all([
    discoverNodeModulesAdapters(),
    discoverConfigAdapters(config),
    discoverLocalAdapters(),
  ]);

  allMeta.push(...nmAdapters, ...cfgAdapters, ...localAdapters);

  // Deduplicate by packageName (first source wins)
  const seen = new Set<string>();
  const uniqueMeta = allMeta.filter((m) => {
    if (seen.has(m.packageName)) return false;
    seen.add(m.packageName);
    return true;
  });

  const loaded: LoadedAdapter[] = [];

  for (const meta of uniqueMeta) {
    try {
      const adapter = await loadAdapter(meta);
      const adapterName = adapter.getCapabilities().agent.name;
      meta.adapterName = adapterName;

      if (!isAdapterEnabled(adapterName, config)) {
        console.log(`Adapter ${adapterName} is disabled in config, skipping`);
        continue;
      }

      loaded.push({ adapter, meta });
    } catch (err) {
      console.warn(
        `Failed to load adapter from ${meta.packageName}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return loaded;
}

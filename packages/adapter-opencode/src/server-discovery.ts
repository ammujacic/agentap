/**
 * Discover a running OpenCode HTTP server.
 *
 * OpenCode defaults to port 4096 when started with `opencode serve` or
 * `--port`.  In normal TUI mode, NO HTTP server is started, so discovery
 * may return null — the adapter then falls back to file-based monitoring.
 */

import type { ServerInfo } from './types';

const DEFAULT_PORT = 4096;
const SCAN_RANGE = 10; // probe 4096‑4106
const PROBE_TIMEOUT_MS = 1500;

async function probeHealth(port: number): Promise<ServerInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const resp = await fetch(`http://127.0.0.1:${port}/global/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      healthy: boolean;
      version: string;
    };

    if (data.healthy) {
      return {
        url: `http://127.0.0.1:${port}`,
        version: data.version,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to find a running OpenCode server by probing ports 4096‑4106.
 */
export async function discoverServer(): Promise<ServerInfo | null> {
  // Try the default port first (most common case)
  const defaultResult = await probeHealth(DEFAULT_PORT);
  if (defaultResult) return defaultResult;

  // Scan nearby ports in case 4096 was taken
  for (let port = DEFAULT_PORT + 1; port <= DEFAULT_PORT + SCAN_RANGE; port++) {
    const result = await probeHealth(port);
    if (result) return result;
  }

  return null;
}

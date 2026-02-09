/**
 * Agentap plugin for OpenCode — routes permission requests to the
 * Agentap daemon for mobile approval.
 *
 * Auto-installed to ~/.config/opencode/plugins/ by the Agentap daemon.
 * The plugin reads ~/.agentap/daemon.pid to discover the daemon port,
 * then POSTs permission requests to the daemon's long-poll endpoint.
 * If the daemon isn't running, it falls back to "ask" (normal TUI prompt).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PIDFILE = join(homedir(), '.agentap', 'daemon.pid');
const TIMEOUT_MS = 290_000; // Just under the 5-min default

function getDaemonPort() {
  try {
    const content = readFileSync(PIDFILE, 'utf-8').trim();
    const port = parseInt(content, 10);
    return Number.isFinite(port) ? port : null;
  } catch {
    return null;
  }
}

/**
 * @type {import("opencode/plugin").Plugin}
 */
export const AgentapPlugin = async (ctx) => {
  return {
    /**
     * Intercept permission requests and route to the Agentap daemon.
     * The daemon forwards to mobile for approval, then responds.
     */
    'permission.ask': async (input, output) => {
      const port = getDaemonPort();
      if (!port) return; // No daemon — fall through to normal TUI prompt

      // Map OpenCode permission to the daemon's HookInput format
      const hookInput = {
        session_id: input.sessionID,
        tool_name: input.type || 'unknown',
        tool_input: input.metadata || {},
        tool_use_id: input.callID || input.id,
        cwd: ctx.directory,
        hook_event_name: 'PreToolUse',
      };

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const resp = await fetch(`http://127.0.0.1:${port}/api/hooks/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hookInput),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) return; // Error — fall through

        const data = await resp.json();
        const decision = data?.hookSpecificOutput?.permissionDecision;

        if (decision === 'allow') {
          output.status = 'allow';
        } else if (decision === 'deny') {
          output.status = 'deny';
        }
        // "ask" = fall through to TUI prompt (default)
      } catch {
        // Daemon unreachable or timed out — fall through
      }
    },

    /**
     * After a tool executes, notify the daemon for real-time monitoring.
     * This is fire-and-forget — errors are silently ignored.
     */
    'tool.execute.after': async (input, output) => {
      const port = getDaemonPort();
      if (!port) return;

      try {
        fetch(`http://127.0.0.1:${port}/api/hooks/health`, {
          signal: AbortSignal.timeout(2000),
        }).catch(() => {});
      } catch {
        // Ignore — best-effort monitoring
      }
    },
  };
};

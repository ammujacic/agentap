/**
 * Main Agentap Daemon — uses ACP for all adapter communication
 */

import { EventEmitter } from 'events';
import {
  hostname as osHostname,
  platform as osPlatform,
  arch as osArch,
  networkInterfaces,
  homedir as osHomedir,
} from 'os';
import { loadConfig, saveConfig, getPidfilePath, getConfigDir, type DaemonConfig } from './config';
import { AgentapWebSocketServer } from './services/websocket';
import { TunnelManager } from './services/tunnel';
import { discoverAndLoadAdapters } from './adapter-loader';
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  cpSync,
  chmodSync,
  appendFileSync,
} from 'fs';

const DEBUG_LOG = join(osHomedir(), '.agentap', 'logs', 'debug.log');
function dbg(msg: string) {
  const logDir = join(osHomedir(), '.agentap', 'logs');
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const ts = new Date().toISOString().slice(11, 23);
  // eslint-disable-next-line no-control-regex
  const sanitized = msg.replace(/[\x00-\x1f\x7f]/g, '');
  appendFileSync(DEBUG_LOG, `[${ts}] ${sanitized}\n`, { mode: 0o600 });
}
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { homedir } from 'os';
import type {
  ACPAdapter,
  ACPSession,
  ACPEvent,
  ACPCommand,
  ACPCapabilities,
} from '@agentap-dev/acp';

/** Strip system/IDE tags from user messages to extract real user text */
const TAG_NAMES =
  'system-reminder|ide_opened_file|ide_selection|ide_context|gitStatus|command-name|claudeMd';
const PAIRED_TAG_RE = new RegExp(
  `<(?:${TAG_NAMES}|antml:[^>]*)>[\\s\\S]*?<\\/(?:${TAG_NAMES}|antml:[^>]*)>`,
  'g'
);
const ORPHAN_TAG_RE = new RegExp(`<(?:${TAG_NAMES}|antml:[^>]*)>[\\s\\S]*`, 'g');

/**
 * Session state tracked by the daemon
 */
interface DaemonSession {
  [key: string]: unknown;
  id: string;
  agent: string;
  machineId: string;
  projectPath: string;
  projectName: string;
  status: string;
  lastMessage: string | null;
  lastActivity: Date;
  createdAt: Date;
  sessionName: string | null;
  model: string | null;
  agentMode: string | null;
}

function getHostInfo() {
  return {
    hostname: process.env.HOST_NAME || osHostname(),
    platform: process.env.HOST_OS || osPlatform(),
    arch: process.env.HOST_ARCH || osArch(),
  };
}

function getLanIp(): string {
  const interfaces = networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

export interface DaemonOptions {
  port?: number;
  noTunnel?: boolean;
  apiUrl?: string;
}

export interface DaemonStatus {
  running: boolean;
  port: number;
  tunnelUrl: string | null;
  tunnelId: string | null;
  connectedClients: number;
  activeSessions: number;
  detectedAgents: string[];
  machineId: string | null;
  linked: boolean;
}

export class Daemon extends EventEmitter {
  private config: DaemonConfig;
  private options: DaemonOptions;
  private wsServer: AgentapWebSocketServer | null = null;
  private tunnel: TunnelManager | null = null;
  private sessions: Map<string, DaemonSession> = new Map();
  private machineId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private adapters: ACPAdapter[] = [];
  private acpSessions: Map<string, ACPSession> = new Map();
  private sessionCleanups: Map<string, () => void> = new Map();
  private stopWatchers: (() => void)[] = [];
  private adapterCapabilities: Map<string, ACPCapabilities> = new Map();
  private attachRetries: Map<string, number> = new Map();

  constructor(options: DaemonOptions = {}) {
    super();
    this.config = loadConfig();
    this.options = options;

    if (this.config.machine.id) {
      this.machineId = this.config.machine.id;
    }
  }

  /**
   * Build authorization headers for daemon→API calls.
   * Uses the machine API secret stored during linking.
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.machine.apiSecret) {
      headers['Authorization'] = `Bearer ${this.config.machine.apiSecret}`;
    }
    return headers;
  }

  isLinked(): boolean {
    return this.config.machine.id !== null;
  }

  getMachineId(): string | null {
    return this.machineId;
  }

  async start(): Promise<DaemonStatus> {
    const port = this.options.port ?? this.config.daemon.port;

    console.log('Starting Agentap daemon...');

    this.wsServer = new AgentapWebSocketServer({
      port,
      onAuth: this.handleAuth.bind(this),
      approvals: {
        mobileThreshold: this.config.approvals.mobileThreshold,
        requireClient: this.config.approvals.requireClient,
      },
    });

    // Wire up push notifications for hook-based approvals
    this.wsServer.hookApprovals.setNotifier((event) => {
      this.forwardApprovalNotification(event);
    });

    this.wsServer.onCommand = this.handleCommand.bind(this);
    this.wsServer.onTerminateSession = this.handleTerminateSession.bind(this);
    this.wsServer.onStartSession = this.handleStartSession.bind(this);
    this.wsServer.getSessions = () => Promise.resolve(Array.from(this.sessions.values()));
    this.wsServer.getCapabilities = () => Array.from(this.adapterCapabilities.values());
    this.wsServer.getSessionHistory = async (sessionId: string) => {
      let acpSession = this.acpSessions.get(sessionId);

      // If the session isn't currently attached (e.g. completed/idle),
      // re-attach on demand so we can replay its history.
      if (!acpSession) {
        const daemonSession = this.sessions.get(sessionId);
        if (daemonSession) {
          const adapter = this.adapters.find(
            (a) => a.getCapabilities().agent.name === daemonSession.agent
          );
          if (adapter) {
            try {
              acpSession = await adapter.attachToSession(sessionId);
              this.acpSessions.set(sessionId, acpSession);
            } catch (err) {
              console.error(`Failed to re-attach to session ${sessionId} for history:`, err);
            }
          }
        }
      }

      if (!acpSession) return [];
      return acpSession.getHistory();
    };

    // Send a full heartbeat to the backend whenever a device authenticates
    this.wsServer.onClientAuthenticated = () => {
      this.sendHeartbeat();
    };

    // Write pidfile so hook scripts can discover the daemon port
    this.writePidfile(port);

    console.log(`WebSocket server running on localhost:${port}`);

    // Start tunnel only if already linked with a tunnel token.
    // For unlinked machines, the tunnel is established after linking.
    let tunnelUrl: string | null = null;

    if (this.options.noTunnel) {
      // In no-tunnel mode, advertise LAN IP so mobile devices on the
      // same network can reach the WebSocket server.
      const lanIp = getLanIp();
      tunnelUrl = `http://${lanIp}:${port}`;
      this.config.machine.tunnelUrl = tunnelUrl;
      console.log(`No-tunnel mode: advertising ${tunnelUrl}`);
    } else if (this.config.machine.tunnelToken) {
      // Already linked — start named tunnel with saved token
      tunnelUrl = await this.startTunnel(port, this.config.machine.tunnelToken);
    } else {
      console.log('No tunnel token — tunnel will be established after linking');
    }

    // Discover and load adapter plugins
    const loadedAdapters = await discoverAndLoadAdapters(this.config);
    for (const { adapter } of loadedAdapters) {
      const caps = adapter.getCapabilities();
      this.adapters.push(adapter);
      this.adapterCapabilities.set(caps.agent.name, caps);
    }

    const detectedAgents = this.getDetectedAgentNames();
    console.log(`Detected agents: ${detectedAgents.join(', ') || 'none'}`);

    // Auto-install Claude Code hooks plugin if Claude Code is detected
    if (detectedAgents.includes('claude-code')) {
      this.ensureHooksInstalled();
    }

    // Auto-install OpenCode plugin if OpenCode is detected
    if (detectedAgents.includes('opencode')) {
      this.ensureOpenCodePluginInstalled();
    }

    await this.initializeSessions();
    this.startSessionWatchers();

    if (this.machineId) {
      this.startHeartbeat();
    }

    return {
      running: true,
      port,
      tunnelUrl,
      tunnelId: null,
      connectedClients: 0,
      activeSessions: this.sessions.size,
      detectedAgents,
      machineId: this.machineId,
      linked: this.isLinked(),
    };
  }

  async stop(): Promise<void> {
    console.log('Stopping daemon...');

    this.stopHeartbeat();
    this.removePidfile();

    for (const stopWatcher of this.stopWatchers) {
      try {
        stopWatcher();
      } catch (err) {
        console.error('Error stopping watcher:', err);
      }
    }
    this.stopWatchers = [];

    for (const sessionId of this.acpSessions.keys()) {
      this.detachSession(sessionId);
    }
    this.adapters = [];
    this.sessions.clear();

    if (this.tunnel) {
      this.tunnel.stop();
      this.tunnel = null;
    }

    if (this.wsServer) {
      await this.wsServer.close();
      this.wsServer = null;
    }

    console.log('Daemon stopped');
  }

  getStatus(): DaemonStatus {
    return {
      running: this.wsServer !== null,
      port: this.options.port ?? this.config.daemon.port,
      tunnelUrl: this.config.machine.tunnelUrl ?? this.tunnel?.getTunnelUrl() ?? null,
      tunnelId: this.tunnel?.getTunnelId() ?? null,
      connectedClients: this.wsServer?.getClientCount() ?? 0,
      activeSessions: this.sessions.size,
      detectedAgents: this.getDetectedAgentNames(),
      machineId: this.machineId,
      linked: this.isLinked(),
    };
  }

  async createLinkRequest(): Promise<{
    code: string;
    qrData: string;
  }> {
    const apiUrl = this.options.apiUrl ?? this.config.api.url;
    const host = getHostInfo();

    const response = await fetch(`${apiUrl}/api/machines/link-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machineName: host.hostname,
        os: host.platform,
        arch: host.arch,
        agentsDetected: this.getDetectedAgentNames(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create link request: ${response.statusText}`);
    }

    const { code } = (await response.json()) as { code: string };

    const qrData = JSON.stringify({
      code,
      name: host.hostname,
      v: 1,
    });

    return { code, qrData };
  }

  async waitForLink(
    code: string,
    onPoll?: () => void
  ): Promise<{
    machineId: string;
    tunnelToken: string | null;
    tunnelUrl: string | null;
    userId: string;
  }> {
    const apiUrl = this.options.apiUrl ?? this.config.api.url;
    const pollInterval = 2000;
    const timeout = 10 * 60 * 1000;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const poll = async () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error('Link code expired'));
          return;
        }

        try {
          onPoll?.();

          const response = await fetch(
            `${apiUrl}/api/machines/link-status/${encodeURIComponent(code)}`
          );

          if (!response.ok) {
            reject(new Error('Link request not found or expired'));
            return;
          }

          const data = (await response.json()) as
            | { linked: false }
            | {
                linked: true;
                machineId: string;
                tunnelToken: string | null;
                tunnelUrl: string | null;
                userId: string;
                apiSecret: string | null;
              };

          if (data.linked) {
            this.machineId = data.machineId;
            this.config.machine = {
              id: data.machineId,
              userId: data.userId,
              apiSecret: data.apiSecret ?? null,
              tunnelToken: data.tunnelToken,
              tunnelUrl: data.tunnelUrl,
            };
            saveConfig(this.config);

            this.startHeartbeat();

            // Start tunnel with the token received from the backend
            if (data.tunnelToken && !this.options.noTunnel) {
              const port = this.options.port ?? this.config.daemon.port;
              try {
                await this.startTunnel(port, data.tunnelToken);
              } catch (error) {
                console.error('Failed to start tunnel after linking:', error);
              }
            }

            resolve({
              machineId: data.machineId,
              tunnelToken: data.tunnelToken,
              tunnelUrl: data.tunnelUrl,
              userId: data.userId,
            });
            return;
          }

          setTimeout(poll, pollInterval);
        } catch {
          setTimeout(poll, pollInterval);
        }
      };

      poll();
    });
  }

  // ── Tunnel management ─────────────────────────────────

  /**
   * Create a TunnelManager, wire up events, and start with the given token.
   * Returns the tunnel URL from config on success, or null on failure.
   */
  private async startTunnel(port: number, token: string): Promise<string | null> {
    this.tunnel = new TunnelManager({ localPort: port });

    this.tunnel.on('connected', (url: string, id: string) => {
      console.log(`Tunnel connected: ${url}`);
      this.emit('tunnel:connected', url, id);
    });

    this.tunnel.on('disconnected', () => {
      console.log('Tunnel disconnected');
      this.emit('tunnel:disconnected');
    });

    this.tunnel.on('error', (error: Error) => {
      console.error('Tunnel error:', error);
      this.emit('tunnel:error', error);
    });

    console.log('Starting tunnel...');
    try {
      await this.tunnel.startWithToken(token);
      return this.config.machine.tunnelUrl;
    } catch (error) {
      console.error('Failed to start tunnel:', error);
      return null;
    }
  }

  // ── Session management ─────────────────────────────────

  private async initializeSessions(): Promise<void> {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const adapter of this.adapters) {
      try {
        const discovered = await adapter.discoverSessions();
        const caps = adapter.getCapabilities();

        // Only track sessions from the last 24 hours
        const recent = discovered.filter((ds) => ds.lastActivity.getTime() > oneDayAgo);
        const activeCount = recent.filter(
          (ds) => Date.now() - ds.lastActivity.getTime() < 5 * 60 * 1000
        ).length;

        console.log(
          `Discovered ${recent.length} recent ${caps.agent.name} sessions (${activeCount} active, ${discovered.length} total)`
        );

        for (const ds of recent) {
          const session = this.discoveredToSession(ds);
          this.sessions.set(session.id, session);

          // Only attach to sessions that appear to be actively running
          if (session.status === 'running') {
            try {
              await this.attachToSession(adapter, ds.id);
            } catch (err) {
              console.error(`Failed to attach to session ${ds.id}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to discover sessions:`, err);
      }
    }

    if (this.sessions.size > 0) {
      const running = Array.from(this.sessions.values()).filter(
        (s) => s.status === 'running'
      ).length;
      console.log(`Tracking ${this.sessions.size} sessions (${running} running)`);
    }
  }

  private startSessionWatchers(): void {
    for (const adapter of this.adapters) {
      const stop = adapter.watchSessions(async (event) => {
        dbg(`watcher event: ${event.type} session=${event.sessionId}`);
        try {
          if (event.type === 'session_created') {
            const discovered = await adapter.discoverSessions();
            const ds = discovered.find((s) => s.id === event.sessionId);
            dbg(
              `session_created: found=${!!ds}, alreadyTracked=${this.sessions.has(event.sessionId)}`
            );
            if (ds && !this.sessions.has(ds.id)) {
              const session = this.discoveredToSession(ds);
              this.sessions.set(session.id, session);

              console.log(`New session detected: ${ds.projectName} (${ds.id})`);

              // Broadcast immediately so mobile sees the new session
              this.broadcastSessionsList();

              // Attach in background with retry — failure shouldn't block broadcast
              this.attachRetries.delete(ds.id);
              this.attachWithRetry(adapter, ds.id);
            }
          } else if (event.type === 'session_removed') {
            this.sessions.delete(event.sessionId);
            this.detachSession(event.sessionId);
            console.log(`Session removed: ${event.sessionId}`);

            // Notify connected clients about the removal
            this.broadcastSessionsList();
          } else if (event.type === 'session_updated') {
            const existing = this.sessions.get(event.sessionId);
            const attached = this.acpSessions.has(event.sessionId);
            dbg(
              `session_updated: exists=${!!existing}, status=${existing?.status}, attached=${attached}`
            );
            if (existing) {
              existing.lastActivity = new Date();

              // Re-discover project info if it was Unknown at creation
              // (race condition: file had no user message with cwd yet)
              if (existing.projectName === 'Unknown' || existing.projectPath === 'Unknown') {
                const discovered = await adapter.discoverSessions();
                const ds = discovered.find((s) => s.id === event.sessionId);
                if (ds && ds.projectName !== 'Unknown') {
                  existing.projectPath = ds.projectPath;
                  existing.projectName = ds.projectName;
                  dbg(`updated project info for ${event.sessionId}: ${ds.projectName}`);
                  this.broadcastSessionsList();
                }
              }

              // Trigger read on attached sessions (the per-file
              // watcher in ClaudeCodeSession may not fire reliably,
              // so we piggyback on the adapter-level directory watcher)
              if (attached) {
                const acpSession = this.acpSessions.get(event.sessionId);
                acpSession?.refresh?.();
              }

              // Reactivate idle sessions when file changes
              if (existing.status === 'idle' && !attached) {
                existing.status = 'running';
                dbg(`reactivating idle session ${event.sessionId}`);
                const matchAdapter = this.adapters.find(
                  (a) => a.getCapabilities().agent.name === existing.agent
                );
                if (matchAdapter) {
                  this.attachRetries.delete(event.sessionId);
                  this.attachWithRetry(matchAdapter, event.sessionId);
                }
                // Notify clients about the reactivated session
                this.broadcastSessionsList();
              }
            }
          }
        } catch (err) {
          console.error(`Error handling session event:`, err);
        }
      });

      this.stopWatchers.push(stop);
    }
  }

  /**
   * Attach to a session using ACP's single event stream
   */
  private async attachToSession(adapter: ACPAdapter, sessionId: string): Promise<void> {
    if (this.acpSessions.has(sessionId)) {
      dbg(`already attached to ${sessionId}`);
      return;
    }

    dbg(`attaching to ${sessionId}`);
    const acpSession = await adapter.attachToSession(sessionId);
    this.acpSessions.set(sessionId, acpSession);

    const cleanup = acpSession.onEvent((event: ACPEvent) => {
      dbg(
        `ACP event: ${event.type} session=${sessionId} clients=${this.wsServer?.getClientCount() ?? 0}`
      );
      this.handleACPEvent(sessionId, event);
      this.wsServer?.broadcastACPEvent(event);

      // Forward approval requests as push notifications
      if (event.type === 'approval:requested' && this.machineId) {
        this.forwardApprovalNotification(event);
      }
    });

    this.sessionCleanups.set(sessionId, cleanup);
    dbg(`attached to ${sessionId}, listening for events`);
  }

  /**
   * Attempt to attach to a session with up to 2 retries (3 attempts total)
   * on failure, with 2-second delays between attempts.
   */
  private attachWithRetry(adapter: ACPAdapter, sessionId: string): void {
    this.attachToSession(adapter, sessionId).catch((err) => {
      const retries = this.attachRetries.get(sessionId) ?? 0;
      if (retries < 2) {
        this.attachRetries.set(sessionId, retries + 1);
        console.error(
          `Failed to attach to session ${sessionId} (attempt ${retries + 1}/3), retrying in 2s:`,
          err
        );
        setTimeout(() => {
          this.attachWithRetry(adapter, sessionId);
        }, 2000);
      } else {
        this.attachRetries.delete(sessionId);
        console.error(`Failed to attach to session ${sessionId} after 3 attempts:`, err);
      }
    });
  }

  private async forwardApprovalNotification(
    event: Extract<ACPEvent, { type: 'approval:requested' }>
  ): Promise<void> {
    const apiUrl = this.options.apiUrl ?? this.config.api.url;

    try {
      await fetch(`${apiUrl}/api/notifications/approval`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          machineId: this.machineId,
          sessionId: event.sessionId,
          requestId: event.requestId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          description: event.description,
          riskLevel: event.riskLevel,
        }),
      });
    } catch (error) {
      console.error('Failed to forward approval notification:', error);
    }
  }

  private handleACPEvent(sessionId: string, event: ACPEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (event.type) {
      case 'session:status_changed':
        session.status = event.to;
        session.lastActivity = new Date();
        break;

      case 'session:completed':
        session.status = 'completed';
        this.detachSession(sessionId);
        break;

      case 'session:error':
        session.status = 'error';
        this.detachSession(sessionId);
        break;

      case 'message:complete':
        if (event.role === 'user' && !session.sessionName) {
          // Collect ALL text blocks (user text may be in a later block after system tags)
          const allUserText = event.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          if (allUserText) {
            const cleaned = allUserText
              .replace(PAIRED_TAG_RE, '')
              .replace(ORPHAN_TAG_RE, '')
              .trim();
            if (cleaned) {
              session.sessionName = cleaned.length > 100 ? cleaned.slice(0, 100) + '...' : cleaned;
            }
          }
        }
        if (event.role === 'assistant') {
          const textContent = event.content.find((c) => c.type === 'text');
          if (textContent && textContent.type === 'text') {
            session.lastMessage = textContent.text;
          }
        }
        session.lastActivity = new Date();
        break;

      case 'message:delta':
        session.lastActivity = new Date();
        break;

      case 'environment:info':
        session.model = event.context.model.id;
        break;

      default:
        break;
    }
  }

  private broadcastSessionsList(): void {
    this.wsServer?.broadcastSessionsList(Array.from(this.sessions.values()));
  }

  private detachSession(sessionId: string): void {
    const cleanup = this.sessionCleanups.get(sessionId);
    if (cleanup) {
      cleanup();
      this.sessionCleanups.delete(sessionId);
    }
    this.acpSessions.delete(sessionId);
  }

  private discoveredToSession(ds: {
    id: string;
    agent: string;
    projectPath: string;
    projectName: string;
    createdAt: Date;
    lastActivity: Date;
    lastMessage?: string | null;
    sessionName?: string | null;
  }): DaemonSession {
    // Determine status from file recency
    const ageMs = Date.now() - ds.lastActivity.getTime();
    const fiveMinMs = 5 * 60 * 1000;
    const status = ageMs < fiveMinMs ? 'running' : 'idle';

    return {
      id: ds.id,
      agent: ds.agent,
      machineId: this.machineId || 'local',
      projectPath: ds.projectPath,
      projectName: ds.projectName,
      status,
      lastMessage: ds.lastMessage ?? null,
      lastActivity: ds.lastActivity,
      createdAt: ds.createdAt,
      sessionName: ds.sessionName ?? null,
      model: null,
      agentMode: null,
    };
  }

  // ── Hooks auto-install ──────────────────────────────

  /**
   * Installs the PreToolUse hook into Claude Code:
   *  1. Copies the hook script to ~/.agentap/hooks/pre-tool-use.sh
   *  2. Merges our hook entry into ~/.claude/settings.json
   */
  private ensureHooksInstalled(): void {
    const hookScriptDir = join(getConfigDir(), 'hooks');
    const hookScriptDest = join(hookScriptDir, 'pre-tool-use.sh');

    // Hook script source is bundled in the adapter-claude-code package
    const hookScriptSrc = join(
      __dirname,
      '..',
      '..',
      'adapter-claude-code',
      'plugin',
      'scripts',
      'pre-tool-use.sh'
    );

    // 1. Copy hook script (always overwrite to keep up to date)
    if (!existsSync(hookScriptSrc)) {
      return; // Source not available
    }

    try {
      mkdirSync(hookScriptDir, { recursive: true });
      cpSync(hookScriptSrc, hookScriptDest);
      chmodSync(hookScriptDest, 0o755);
    } catch (error) {
      console.error('Failed to install hook script:', error);
      return;
    }

    // 2. Merge hook entry into ~/.claude/settings.json
    const claudeDir = join(process.env.HOME || homedir(), '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    const hookCommand = hookScriptDest;

    try {
      let settings: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } else {
        mkdirSync(claudeDir, { recursive: true });
      }

      // Check if our hook is already registered
      const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
      const preToolUse = (hooks.PreToolUse ?? []) as Array<{
        matcher?: string;
        hooks?: Array<{ type?: string; command?: string }>;
      }>;

      const alreadyInstalled = preToolUse.some((entry) =>
        entry.hooks?.some((h) => h.command === hookCommand)
      );

      if (alreadyInstalled) {
        // Repair: fix any ".*" matchers pointing to our hook
        let repaired = false;
        for (const entry of preToolUse) {
          const isOurHook = entry.hooks?.some((h) => h.command === hookCommand);
          if (isOurHook && entry.matcher === '.*') {
            entry.matcher = 'Bash|Write|Edit|NotebookEdit';
            repaired = true;
          }
        }
        if (repaired) {
          hooks.PreToolUse = preToolUse;
          settings.hooks = hooks;
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
          console.log('Repaired hook matcher in ~/.claude/settings.json');
        }
        return;
      }

      // Add our hook entry
      preToolUse.push({
        matcher: 'Bash|Write|Edit|NotebookEdit',
        hooks: [
          {
            type: 'command',
            command: hookCommand,
            timeout: 300,
          } as { type: string; command: string },
        ],
      });

      hooks.PreToolUse = preToolUse;
      settings.hooks = hooks;

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      console.log('Agentap hooks registered in ~/.claude/settings.json');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'EROFS' || code === 'EACCES') {
        // Read-only filesystem (e.g. Docker with :ro mount) — skip silently
        console.log('Skipping hooks registration (Claude settings read-only)');
      } else {
        console.error('Failed to register hooks in Claude settings:', error);
      }
    }
  }

  // ── OpenCode plugin auto-install ─────────────────────

  /**
   * Installs the Agentap plugin into OpenCode's global plugins directory.
   * The plugin routes permission requests to the daemon for mobile approval.
   */
  private ensureOpenCodePluginInstalled(): void {
    const pluginDir = join(homedir(), '.config', 'opencode', 'plugins');
    const pluginDest = join(pluginDir, 'agentap.js');

    // Plugin source is bundled in the adapter-opencode package
    const pluginSrc = join(
      __dirname,
      '..',
      '..',
      'adapter-opencode',
      'scripts',
      'agentap-plugin.js'
    );

    if (!existsSync(pluginSrc)) {
      return; // Source not available
    }

    try {
      mkdirSync(pluginDir, { recursive: true });

      // Always overwrite to keep plugin up to date
      cpSync(pluginSrc, pluginDest);
      console.log(`OpenCode plugin installed to ${pluginDest}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'EROFS' || code === 'EACCES') {
        console.log('Skipping OpenCode plugin installation (read-only filesystem)');
      } else {
        console.error('Failed to install OpenCode plugin:', error);
      }
    }
  }

  // ── Pidfile management ───────────────────────────────

  private writePidfile(port: number): void {
    try {
      writeFileSync(getPidfilePath(), String(port), { encoding: 'utf-8', mode: 0o600 });
    } catch (error) {
      console.error('Failed to write pidfile:', error);
    }
  }

  private removePidfile(): void {
    try {
      unlinkSync(getPidfilePath());
    } catch {
      // Ignore — file may not exist
    }
  }

  // ── Command handlers ───────────────────────────────────

  private async handleCommand(sessionId: string, command: ACPCommand): Promise<void> {
    let acpSession = this.acpSessions.get(sessionId);

    // Re-attach to idle/detached sessions on demand (e.g. mobile
    // sending a message to a session that was previously detached).
    if (!acpSession) {
      const daemonSession = this.sessions.get(sessionId);
      if (daemonSession) {
        const adapter = this.adapters.find(
          (a) => a.getCapabilities().agent.name === daemonSession.agent
        );
        if (adapter) {
          await this.attachToSession(adapter, sessionId);
          acpSession = this.acpSessions.get(sessionId);
        }
      }
    }

    if (!acpSession) {
      throw new Error('Session not found');
    }

    await acpSession.execute(command);
  }

  private async handleTerminateSession(sessionId: string): Promise<void> {
    const acpSession = this.acpSessions.get(sessionId);
    if (!acpSession) {
      throw new Error('Session not found');
    }

    console.log(`Terminating session ${sessionId}`);
    await acpSession.execute({ command: 'terminate' });

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'completed';
    }
    this.detachSession(sessionId);
  }

  private async handleStartSession(
    agent: string,
    projectPath: string,
    prompt: string
  ): Promise<DaemonSession> {
    const adapter = this.adapters.find((a) => a.getCapabilities().agent.name === agent);
    if (!adapter) {
      throw new Error(`No adapter for agent: ${agent}`);
    }

    const acpSession = await adapter.startSession({
      projectPath,
      prompt,
    });
    const session: DaemonSession = {
      id: acpSession.sessionId,
      agent,
      machineId: this.machineId || 'local',
      projectPath,
      projectName: projectPath.split('/').pop() || projectPath,
      status: 'running',
      lastMessage: null,
      lastActivity: new Date(),
      createdAt: new Date(),
      sessionName: null,
      model: null,
      agentMode: null,
    };

    this.sessions.set(session.id, session);
    this.acpSessions.set(session.id, acpSession);

    const cleanup = acpSession.onEvent((event: ACPEvent) => {
      this.handleACPEvent(session.id, event);
      this.wsServer?.broadcastACPEvent(event);

      if (event.type === 'approval:requested' && this.machineId) {
        this.forwardApprovalNotification(event);
      }
    });
    this.sessionCleanups.set(session.id, cleanup);

    return session;
  }

  // ── Auth & detection ───────────────────────────────────

  private getDetectedAgentNames(): string[] {
    return this.adapters.map((a) => a.getCapabilities().agent.name);
  }

  private async handleAuth(token: string): Promise<{ valid: boolean; userId?: string }> {
    if (!this.machineId) {
      return { valid: true, userId: 'local-user' };
    }

    const apiUrl = this.options.apiUrl ?? this.config.api.url;

    try {
      const response = await fetch(`${apiUrl}/api/daemon/validate-token`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          token,
          machineId: this.machineId,
        }),
      });

      if (!response.ok) {
        return { valid: false };
      }

      const data = (await response.json()) as {
        valid: boolean;
        userId?: string;
      };
      return data;
    } catch {
      return { valid: true, userId: 'local-user' };
    }
  }

  // ── Heartbeat ──────────────────────────────────────────

  private async sendHeartbeat(): Promise<void> {
    if (!this.machineId) return;

    const apiUrl = this.options.apiUrl ?? this.config.api.url;

    try {
      const response = await fetch(`${apiUrl}/api/machines/${this.machineId}/heartbeat`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          tunnelUrl: this.config.machine.tunnelUrl ?? this.tunnel?.getTunnelUrl(),
          agentsDetected: this.getDetectedAgentNames(),
          sessions: Array.from(this.sessions.values()).map((s) => ({
            id: s.id,
            agent: s.agent,
            projectPath: s.projectPath,
            projectName: s.projectName,
            status: s.status,
            lastMessage: s.lastMessage,
            lastActivityAt: s.lastActivity.toISOString(),
            startedAt: s.createdAt.toISOString(),
          })),
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('Heartbeat returned 401 — machine may need re-linking');
        } else {
          console.warn(`Heartbeat returned ${response.status}: ${response.statusText}`);
        }
      }
    } catch (error) {
      console.error('Heartbeat failed:', error);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      try {
        this.sendHeartbeat();
      } catch (error) {
        console.error('Heartbeat error:', error);
      }
    }, 60000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

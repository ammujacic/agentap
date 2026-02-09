import type { ACPEvent } from './envelope';
import type { ACPCommand } from './commands';
import type { ACPCapabilities } from './capabilities';

/**
 * Paths where agent stores data on disk
 */
export interface AgentDataPaths {
  sessions?: string;
  config?: string;
  logs?: string;
}

/**
 * Discovered session (before attaching)
 */
export interface DiscoveredSession {
  id: string;
  agent: string;
  projectPath: string;
  projectName: string;
  createdAt: Date;
  lastActivity: Date;
  lastMessage?: string | null;
  sessionName?: string | null;
}

/**
 * Session discovery event
 */
export interface SessionDiscoveryEvent {
  type: 'session_created' | 'session_removed' | 'session_updated';
  sessionId: string;
  agent: string;
}

/**
 * Options for starting a new session
 */
export interface StartSessionOptions {
  projectPath: string;
  prompt: string;
  model?: string;
  agentOptions?: Record<string, unknown>;
}

/**
 * The ACP Adapter interface — what every agent adapter must implement.
 */
export interface ACPAdapter {
  /** Capabilities this adapter supports */
  getCapabilities(): ACPCapabilities;

  // ── Detection ──────────────────────────────
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getDataPaths(): AgentDataPaths;

  // ── Session Discovery ──────────────────────
  discoverSessions(): Promise<DiscoveredSession[]>;
  watchSessions(callback: (event: SessionDiscoveryEvent) => void): () => void;

  // ── Session Control ────────────────────────
  attachToSession(sessionId: string): Promise<ACPSession>;
  startSession(options: StartSessionOptions): Promise<ACPSession>;
}

/**
 * An active session connection.
 * Uses a single unified event stream instead of individual callbacks.
 */
export interface ACPSession {
  readonly sessionId: string;
  readonly capabilities: ACPCapabilities;

  /**
   * Subscribe to ALL events from this session.
   * Single event stream — consumers filter by type.
   * Returns unsubscribe function.
   */
  onEvent(callback: (event: ACPEvent) => void): () => void;

  /**
   * Send a command to the agent.
   * Throws if the command is not supported by this adapter.
   */
  execute(command: ACPCommand): Promise<void>;

  /**
   * Get full event history (for replaying on attach).
   * Returns events since session start, in order.
   */
  getHistory(): Promise<ACPEvent[]>;

  /**
   * Hint the session to check for new data (e.g. file changes).
   * Optional — adapters that use file-based watching can implement this
   * so the daemon can trigger reads from an external watcher.
   */
  refresh?(): void;

  /**
   * Disconnect from this session (does not terminate the agent).
   */
  detach(): Promise<void>;
}

/**
 * HookApprovalManager — handles approval requests from Claude Code PreToolUse hooks.
 *
 * The hook script POSTs tool-call data here. We hold the HTTP connection open
 * (long-poll) while broadcasting an approval:requested ACP event to mobile
 * clients. When the user approves/denies, we resolve the HTTP response so the
 * hook can return the decision to Claude Code.
 */

import { randomUUID } from 'crypto';
import {
  assessRisk,
  describeToolCall,
  createEvent,
  type ACPEvent,
  type RiskLevel,
} from '@agentap-dev/acp';

// ── Types ────────────────────────────────────────────────

/** JSON sent to hook script stdin by Claude Code */
export interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  cwd: string;
  transcript_path?: string;
  permission_mode?: string;
  hook_event_name?: string;
}

export interface PendingHookApproval {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  cwd: string;
  riskLevel: RiskLevel;
  description: string;
  resolve: (decision: 'allow' | 'deny' | 'ask') => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  resolved: boolean;
}

type ApprovalBroadcaster = (event: ACPEvent) => void;
type ApprovalNotifier = (event: Extract<ACPEvent, { type: 'approval:requested' }>) => void;

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface HookApprovalManagerOptions {
  /** Broadcast ACP events to WebSocket clients */
  broadcast: ApprovalBroadcaster;
  /** Forward approval as push notification to API */
  notify?: ApprovalNotifier;
  /** Default timeout in ms before falling back to "ask" (default: 290_000) */
  defaultTimeoutMs?: number;
  /** Get number of connected mobile/web clients */
  getClientCount?: () => number;
  /** Minimum risk level to route to mobile (default: 'medium') */
  mobileThreshold?: RiskLevel;
  /** If true, fall through to local prompt when no client connected (default: true) */
  requireClient?: boolean;
}

// ── Manager ──────────────────────────────────────────────

export class HookApprovalManager {
  private pending: Map<string, PendingHookApproval> = new Map();
  private broadcast: ApprovalBroadcaster;
  private notify?: ApprovalNotifier;
  private defaultTimeoutMs: number;
  private getClientCount: () => number;
  private mobileThreshold: RiskLevel;
  private requireClient: boolean;

  constructor(options: HookApprovalManagerOptions) {
    this.broadcast = options.broadcast;
    this.notify = options.notify;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 290_000;
    this.getClientCount = options.getClientCount ?? (() => 0);
    this.mobileThreshold = options.mobileThreshold ?? 'medium';
    this.requireClient = options.requireClient ?? true;
  }

  /**
   * Set the push notification callback (called after construction,
   * once the daemon is ready to forward notifications to the API).
   */
  setNotifier(notifier: ApprovalNotifier): void {
    this.notify = notifier;
  }

  /**
   * Handle an incoming approval request from a hook script.
   * Returns a promise that resolves with the permission decision.
   */
  requestApproval(input: HookInput): Promise<'allow' | 'deny' | 'ask'> {
    // ── Permission mode fast paths (defense-in-depth) ──
    // The hook script should have already short-circuited these,
    // but we validate here as a safety net.
    const mode = input.permission_mode;

    if (mode === 'bypassPermissions' || mode === 'plan') {
      return Promise.resolve('allow');
    }

    if (mode === 'acceptEdits') {
      const editTools = ['Write', 'Edit', 'NotebookEdit'];
      if (editTools.includes(input.tool_name)) {
        return Promise.resolve('allow');
      }
      // Bash and other tools fall through to normal risk-based routing
    }

    const riskLevel = assessRisk(input.tool_name, input.tool_input);

    // Auto-approve actions below the mobile threshold
    if (RISK_ORDER[riskLevel] < RISK_ORDER[this.mobileThreshold]) {
      return Promise.resolve('allow');
    }

    // Fall through to local VS Code prompt when no mobile client is connected
    if (this.requireClient && this.getClientCount() === 0) {
      return Promise.resolve('ask');
    }

    const requestId = randomUUID();
    const description = describeToolCall(input.tool_name, input.tool_input);

    return new Promise<'allow' | 'deny' | 'ask'>((resolve) => {
      // Set timeout — resolve with "ask" to fall back to terminal
      const timeoutHandle = setTimeout(() => {
        this.resolveApproval(requestId, 'ask', 'timeout');
      }, this.defaultTimeoutMs);

      const entry: PendingHookApproval = {
        requestId,
        sessionId: input.session_id,
        toolName: input.tool_name,
        toolInput: input.tool_input,
        toolUseId: input.tool_use_id,
        cwd: input.cwd,
        riskLevel,
        description,
        resolve,
        timeoutHandle,
        resolved: false,
      };

      this.pending.set(requestId, entry);

      // Build and broadcast approval:requested event
      const expiresAt = new Date(Date.now() + this.defaultTimeoutMs).toISOString();

      const event = createEvent(input.session_id, {
        type: 'approval:requested',
        requestId,
        toolCallId: input.tool_use_id,
        toolName: input.tool_name,
        toolInput: input.tool_input,
        description,
        riskLevel,
        expiresAt,
        preview: this.buildPreview(input),
      });

      this.broadcast(event);

      // Forward as push notification
      if (this.notify) {
        this.notify(event as Extract<ACPEvent, { type: 'approval:requested' }>);
      }
    });
  }

  /**
   * Resolve a pending approval (called from WebSocket command handler).
   * Returns true if the approval was found and resolved.
   */
  resolveApproval(
    requestId: string,
    decision: 'allow' | 'deny' | 'ask',
    resolvedBy: 'user' | 'policy' | 'timeout' = 'user',
    reason?: string
  ): boolean {
    const entry = this.pending.get(requestId);
    if (!entry || entry.resolved) return false;

    entry.resolved = true;
    clearTimeout(entry.timeoutHandle);
    entry.resolve(decision);
    this.pending.delete(requestId);

    // Broadcast resolution event
    this.broadcast(
      createEvent(entry.sessionId, {
        type: 'approval:resolved',
        requestId,
        toolCallId: entry.toolUseId,
        approved: decision === 'allow',
        resolvedBy,
        ...(reason && { reason }),
      })
    );

    return true;
  }

  /**
   * Try to handle an approve/deny command. Returns true if handled.
   */
  handleCommand(
    command:
      | { command: 'approve_tool_call'; requestId: string; toolCallId: string }
      | { command: 'deny_tool_call'; requestId: string; toolCallId: string; reason?: string }
  ): boolean {
    if (command.command === 'approve_tool_call') {
      return this.resolveApproval(command.requestId, 'allow', 'user');
    }
    if (command.command === 'deny_tool_call') {
      return this.resolveApproval(command.requestId, 'deny', 'user', command.reason);
    }
    return false;
  }

  /**
   * Clean up all pending approvals (e.g., on daemon shutdown).
   */
  cleanup(): void {
    for (const [requestId] of this.pending) {
      this.resolveApproval(requestId, 'ask', 'timeout');
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private buildPreview(
    input: HookInput
  ):
    | { type: 'command'; command: string; workingDir: string }
    | { type: 'description'; text: string }
    | undefined {
    if (input.tool_name === 'Bash' && typeof input.tool_input.command === 'string') {
      return {
        type: 'command',
        command: input.tool_input.command,
        workingDir: input.cwd,
      };
    }

    if (
      (input.tool_name === 'Write' || input.tool_name === 'Edit') &&
      typeof input.tool_input.file_path === 'string'
    ) {
      return {
        type: 'description',
        text: `${input.tool_name} ${input.tool_input.file_path}`,
      };
    }

    return undefined;
  }
}

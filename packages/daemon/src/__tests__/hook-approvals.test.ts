import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookApprovalManager, type HookInput } from '../services/hook-approvals';

vi.mock('@agentap-dev/acp', () => ({
  assessRisk: vi.fn((toolName: string, input: unknown) => {
    if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') return 'low';
    if (toolName === 'Bash') {
      const cmd = String((input as Record<string, unknown>)?.command || '');
      if (['rm', 'sudo', 'chmod', 'chown', 'kill'].some((c) => cmd.includes(c))) return 'high';
      if (['npm', 'pip', 'brew', 'apt', 'yarn', 'pnpm'].some((c) => cmd.includes(c)))
        return 'medium';
      return 'low';
    }
    if (toolName === 'Write' || toolName === 'Edit') return 'medium';
    return 'low';
  }),
  describeToolCall: vi.fn((name: string, input: unknown) => `${name} operation`),
  createEvent: vi.fn((sessionId: string, payload: any) => ({
    sessionId,
    ...payload,
    seq: 0,
    timestamp: new Date().toISOString(),
  })),
}));

function makeInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: 'test-session',
    tool_name: 'Bash',
    tool_input: { command: 'echo hello' },
    tool_use_id: 'tu-1',
    cwd: '/tmp',
    ...overrides,
  };
}

function createManager(clientCount = 1) {
  return new HookApprovalManager({
    broadcast: vi.fn(),
    getClientCount: () => clientCount,
    mobileThreshold: 'medium',
    requireClient: true,
  });
}

describe('HookApprovalManager permission_mode handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-approves Bash in bypassPermissions mode', async () => {
    const mgr = createManager();
    const decision = await mgr.requestApproval(
      makeInput({ permission_mode: 'bypassPermissions', tool_name: 'Bash' })
    );
    expect(decision).toBe('allow');
  });

  it('auto-approves Write in bypassPermissions mode', async () => {
    const mgr = createManager();
    const decision = await mgr.requestApproval(
      makeInput({
        permission_mode: 'bypassPermissions',
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(decision).toBe('allow');
  });

  it('auto-approves Write in plan mode', async () => {
    const mgr = createManager();
    const decision = await mgr.requestApproval(
      makeInput({
        permission_mode: 'plan',
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(decision).toBe('allow');
  });

  it('auto-approves Edit in acceptEdits mode', async () => {
    const mgr = createManager();
    const decision = await mgr.requestApproval(
      makeInput({
        permission_mode: 'acceptEdits',
        tool_name: 'Edit',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(decision).toBe('allow');
  });

  it('auto-approves Write in acceptEdits mode', async () => {
    const mgr = createManager();
    const decision = await mgr.requestApproval(
      makeInput({
        permission_mode: 'acceptEdits',
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(decision).toBe('allow');
  });

  it('auto-approves NotebookEdit in acceptEdits mode', async () => {
    const mgr = createManager();
    const decision = await mgr.requestApproval(
      makeInput({
        permission_mode: 'acceptEdits',
        tool_name: 'NotebookEdit',
        tool_input: {},
      })
    );
    expect(decision).toBe('allow');
  });

  it('routes medium-risk Bash to mobile in acceptEdits mode', async () => {
    const mgr = createManager();
    // npm install is medium risk — should NOT be auto-approved in acceptEdits
    const promise = mgr.requestApproval(
      makeInput({
        permission_mode: 'acceptEdits',
        tool_name: 'Bash',
        tool_input: { command: 'npm install foo' },
      })
    );
    expect(mgr.pendingCount).toBe(1);
    mgr.cleanup();
    await promise; // resolve cleanup
  });

  it('routes Write to mobile in default mode', async () => {
    const mgr = createManager();
    // Write is medium risk — should be routed to mobile in default mode
    const promise = mgr.requestApproval(
      makeInput({
        permission_mode: 'default',
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(mgr.pendingCount).toBe(1);
    mgr.cleanup();
    await promise;
  });

  it('routes Write to mobile when permission_mode is absent', async () => {
    const mgr = createManager();
    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(mgr.pendingCount).toBe(1);
    mgr.cleanup();
    await promise;
  });
});

// ── New test suites ──────────────────────────────────────

describe('resolveApproval()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves pending approval with allow and broadcasts approval:resolved', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/foo.ts' },
      })
    );

    // Extract the requestId from the broadcast call
    expect(broadcast).toHaveBeenCalledTimes(1);
    const requestedEvent = broadcast.mock.calls[0][0];
    const requestId = requestedEvent.requestId;

    const result = mgr.resolveApproval(requestId, 'allow', 'user');
    expect(result).toBe(true);

    const decision = await promise;
    expect(decision).toBe('allow');

    // Second broadcast call should be approval:resolved
    expect(broadcast).toHaveBeenCalledTimes(2);
    const resolvedEvent = broadcast.mock.calls[1][0];
    expect(resolvedEvent.type).toBe('approval:resolved');
    expect(resolvedEvent.approved).toBe(true);
    expect(resolvedEvent.resolvedBy).toBe('user');
  });

  it('resolves pending approval with deny', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/foo.ts' },
      })
    );

    const requestedEvent = broadcast.mock.calls[0][0];
    const requestId = requestedEvent.requestId;

    const result = mgr.resolveApproval(requestId, 'deny', 'user', 'not safe');
    expect(result).toBe(true);

    const decision = await promise;
    expect(decision).toBe('deny');

    const resolvedEvent = broadcast.mock.calls[1][0];
    expect(resolvedEvent.type).toBe('approval:resolved');
    expect(resolvedEvent.approved).toBe(false);
    expect(resolvedEvent.reason).toBe('not safe');
  });

  it('returns false for nonexistent requestId', () => {
    const mgr = createManager();
    const result = mgr.resolveApproval('nonexistent-id', 'allow');
    expect(result).toBe(false);
  });

  it('returns false for already-resolved approval', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/foo.ts' },
      })
    );

    const requestedEvent = broadcast.mock.calls[0][0];
    const requestId = requestedEvent.requestId;

    // First resolve succeeds
    mgr.resolveApproval(requestId, 'allow');
    await promise;

    // Second resolve on same requestId returns false
    const result = mgr.resolveApproval(requestId, 'deny');
    expect(result).toBe(false);
  });

  it('clears timeout on resolve', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/foo.ts' },
      })
    );

    const requestedEvent = broadcast.mock.calls[0][0];
    const requestId = requestedEvent.requestId;

    mgr.resolveApproval(requestId, 'allow');
    await promise;

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('handleCommand()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles approve_tool_call command', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/foo.ts' },
      })
    );

    const requestedEvent = broadcast.mock.calls[0][0];
    const requestId = requestedEvent.requestId;

    const handled = mgr.handleCommand({
      command: 'approve_tool_call',
      requestId,
      toolCallId: 'tu-1',
    });
    expect(handled).toBe(true);

    const decision = await promise;
    expect(decision).toBe('allow');
  });

  it('handles deny_tool_call command with reason', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/foo.ts' },
      })
    );

    const requestedEvent = broadcast.mock.calls[0][0];
    const requestId = requestedEvent.requestId;

    const handled = mgr.handleCommand({
      command: 'deny_tool_call',
      requestId,
      toolCallId: 'tu-1',
      reason: 'dangerous operation',
    });
    expect(handled).toBe(true);

    const decision = await promise;
    expect(decision).toBe('deny');

    // Check that the resolved event includes the reason
    const resolvedEvent = broadcast.mock.calls[1][0];
    expect(resolvedEvent.reason).toBe('dangerous operation');
  });

  it('returns false for unknown command', () => {
    const mgr = createManager();
    const handled = mgr.handleCommand({
      command: 'unknown_command' as any,
      requestId: 'some-id',
      toolCallId: 'tu-1',
    });
    expect(handled).toBe(false);
  });

  it('returns false for nonexistent requestId', () => {
    const mgr = createManager();
    const handled = mgr.handleCommand({
      command: 'approve_tool_call',
      requestId: 'nonexistent-id',
      toolCallId: 'tu-1',
    });
    expect(handled).toBe(false);
  });
});

describe('cleanup()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves all pending approvals with ask', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise1 = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/a.ts' },
        tool_use_id: 'tu-1',
      })
    );
    const promise2 = mgr.requestApproval(
      makeInput({
        tool_name: 'Edit',
        tool_input: { file_path: '/tmp/b.ts' },
        tool_use_id: 'tu-2',
      })
    );

    expect(mgr.pendingCount).toBe(2);

    mgr.cleanup();

    const [d1, d2] = await Promise.all([promise1, promise2]);
    expect(d1).toBe('ask');
    expect(d2).toBe('ask');
  });

  it('sets pendingCount to 0', async () => {
    const mgr = createManager();

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/a.ts' },
      })
    );

    expect(mgr.pendingCount).toBe(1);

    mgr.cleanup();
    await promise;

    expect(mgr.pendingCount).toBe(0);
  });
});

describe('pendingCount', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 initially', () => {
    const mgr = createManager();
    expect(mgr.pendingCount).toBe(0);
  });

  it('increases when approval is pending', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise1 = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/a.ts' },
        tool_use_id: 'tu-1',
      })
    );
    expect(mgr.pendingCount).toBe(1);

    const promise2 = mgr.requestApproval(
      makeInput({
        tool_name: 'Edit',
        tool_input: { file_path: '/tmp/b.ts' },
        tool_use_id: 'tu-2',
      })
    );
    expect(mgr.pendingCount).toBe(2);

    mgr.cleanup();
    await Promise.all([promise1, promise2]);
  });

  it('decreases when resolved', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise1 = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/a.ts' },
        tool_use_id: 'tu-1',
      })
    );
    const promise2 = mgr.requestApproval(
      makeInput({
        tool_name: 'Edit',
        tool_input: { file_path: '/tmp/b.ts' },
        tool_use_id: 'tu-2',
      })
    );

    expect(mgr.pendingCount).toBe(2);

    // Resolve the first one
    const requestId1 = broadcast.mock.calls[0][0].requestId;
    mgr.resolveApproval(requestId1, 'allow');
    await promise1;
    expect(mgr.pendingCount).toBe(1);

    // Resolve the second one
    const requestId2 = broadcast.mock.calls[1][0].requestId;
    mgr.resolveApproval(requestId2, 'deny');
    await promise2;
    expect(mgr.pendingCount).toBe(0);
  });
});

describe('requestApproval() - risk routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-approves actions below mobileThreshold', async () => {
    const mgr = new HookApprovalManager({
      broadcast: vi.fn(),
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    // Read tool returns 'low' risk, threshold is 'medium' => auto-approve
    const decision = await mgr.requestApproval(
      makeInput({
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(decision).toBe('allow');
  });

  it('routes actions at/above mobileThreshold to mobile', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    // Write tool returns 'medium' risk, threshold is 'medium' => route to mobile
    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(mgr.pendingCount).toBe(1);
    expect(broadcast).toHaveBeenCalledTimes(1);

    mgr.cleanup();
    await promise;
  });

  it('falls through to ask when no clients connected and requireClient=true', async () => {
    const mgr = new HookApprovalManager({
      broadcast: vi.fn(),
      getClientCount: () => 0,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    // Write is medium risk, but no clients connected => 'ask'
    const decision = await mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(decision).toBe('ask');
  });

  it('routes to mobile when clients connected regardless of requireClient', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 2,
      mobileThreshold: 'medium',
      requireClient: false,
    });

    // Write is medium risk, clients connected => route to mobile
    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );
    expect(mgr.pendingCount).toBe(1);
    expect(broadcast).toHaveBeenCalled();

    mgr.cleanup();
    await promise;
  });
});

describe('requestApproval() - timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with ask after default timeout', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );

    expect(mgr.pendingCount).toBe(1);

    // Advance past the default 290_000ms timeout
    vi.advanceTimersByTime(290_001);

    const decision = await promise;
    expect(decision).toBe('ask');
    expect(mgr.pendingCount).toBe(0);
  });

  it('uses custom timeout from defaultTimeoutMs option', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
      defaultTimeoutMs: 5_000,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );

    expect(mgr.pendingCount).toBe(1);

    // Should NOT have timed out yet at 4999ms
    vi.advanceTimersByTime(4_999);
    expect(mgr.pendingCount).toBe(1);

    // Should timeout at 5000ms
    vi.advanceTimersByTime(2);

    const decision = await promise;
    expect(decision).toBe('ask');
    expect(mgr.pendingCount).toBe(0);
  });
});

describe('requestApproval() - broadcast', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('broadcasts approval:requested event on creation', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );

    expect(broadcast).toHaveBeenCalledTimes(1);
    const event = broadcast.mock.calls[0][0];
    expect(event.type).toBe('approval:requested');
    expect(event.sessionId).toBe('test-session');
    expect(event.toolName).toBe('Write');
    expect(event.riskLevel).toBeDefined();
    expect(event.requestId).toBeDefined();
    expect(event.expiresAt).toBeDefined();

    mgr.cleanup();
    await promise;
  });

  it('event includes command preview for Bash commands', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Bash',
        tool_input: { command: 'npm install foo' },
        cwd: '/home/user/project',
      })
    );

    const event = broadcast.mock.calls[0][0];
    expect(event.preview).toEqual({
      type: 'command',
      command: 'npm install foo',
      workingDir: '/home/user/project',
    });

    mgr.cleanup();
    await promise;
  });

  it('event includes description preview for Write/Edit commands', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );

    const event = broadcast.mock.calls[0][0];
    expect(event.preview).toEqual({
      type: 'description',
      text: 'Write /tmp/test.ts',
    });

    mgr.cleanup();
    await promise;
  });

  it('no preview for other tool types', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'low', // set low so even low-risk tools get routed to mobile
      requireClient: true,
    });

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.ts' },
      })
    );

    const event = broadcast.mock.calls[0][0];
    expect(event.preview).toBeUndefined();

    mgr.cleanup();
    await promise;
  });
});

describe('setNotifier()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls notifier on approval request', async () => {
    const notifier = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast: vi.fn(),
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    mgr.setNotifier(notifier);

    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );

    expect(notifier).toHaveBeenCalledTimes(1);
    const event = notifier.mock.calls[0][0];
    expect(event.type).toBe('approval:requested');
    expect(event.toolName).toBe('Write');

    mgr.cleanup();
    await promise;
  });

  it('notify not called when not set', async () => {
    const broadcast = vi.fn();
    const mgr = new HookApprovalManager({
      broadcast,
      getClientCount: () => 1,
      mobileThreshold: 'medium',
      requireClient: true,
    });

    // Don't call setNotifier — notify should not be called
    const promise = mgr.requestApproval(
      makeInput({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      })
    );

    // Only broadcast should be called, not notify
    expect(broadcast).toHaveBeenCalledTimes(1);

    mgr.cleanup();
    await promise;
  });
});

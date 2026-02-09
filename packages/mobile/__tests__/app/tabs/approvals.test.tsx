/**
 * Tests for app/(tabs)/approvals.tsx
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const { mockSessionsStore, mockMachinesStore, mockApiClient } = require('../../setup');

// Mock WebSocketProvider
const mockApproveToolCall = jest.fn();
const mockDenyToolCall = jest.fn();
const mockRefreshAll = jest.fn();

jest.mock('../../../components/WebSocketProvider', () => ({
  useWebSocketContext: jest.fn(() => ({
    subscribeToSession: jest.fn(),
    sendMessage: jest.fn(),
    approveToolCall: mockApproveToolCall,
    denyToolCall: mockDenyToolCall,
    cancelSession: jest.fn(),
    refreshAll: mockRefreshAll,
  })),
}));

import ApprovalsScreen from '../../../app/(tabs)/approvals';
import type { ApprovalRequest } from '@agentap-dev/shared';

// ── Helpers ──────────────────────────────────────────────────────────

function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'approval-1',
    sessionId: 'session-1',
    requestId: 'request-1',
    machineId: 'machine-1',
    toolName: 'Bash',
    toolInput: { command: 'ls -la' },
    description: 'List directory contents',
    riskLevel: 'low',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    status: 'pending',
    ...overrides,
  } as ApprovalRequest;
}

describe('ApprovalsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockSessionsStore._state = {
      sessions: [],
      pendingApprovals: [],
      setSessionsForMachine: jest.fn(),
      handleACPEvent: jest.fn(),
      completeHistoryLoading: jest.fn(),
      startHistoryLoading: jest.fn(),
    };

    mockMachinesStore._state = {
      machines: [],
      setMachines: jest.fn(),
      addMachine: jest.fn(),
      removeMachine: jest.fn(),
      updateMachine: jest.fn(),
    };

    mockApiClient.getMachines.mockResolvedValue({ machines: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Empty state ────────────────────────────────────────────────────

  it('renders the empty state when there are no pending approvals', () => {
    const { getByText } = render(<ApprovalsScreen />);

    expect(getByText('No pending approvals')).toBeTruthy();
    expect(
      getByText('When an agent needs permission to run a command, it will appear here')
    ).toBeTruthy();
  });

  // ── Filter chips ───────────────────────────────────────────────────

  it('renders all filter chips', () => {
    const { getByText } = render(<ApprovalsScreen />);

    expect(getByText('All')).toBeTruthy();
    expect(getByText('High Risk')).toBeTruthy();
    expect(getByText('Medium')).toBeTruthy();
    expect(getByText('Low')).toBeTruthy();
  });

  it('renders sort chips', () => {
    const { getByText } = render(<ApprovalsScreen />);

    expect(getByText('Newest')).toBeTruthy();
    expect(getByText('Expiring Soon')).toBeTruthy();
    expect(getByText('Risk Level')).toBeTruthy();
  });

  it('filters approvals by risk level when a filter chip is pressed', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({ id: '1', riskLevel: 'low', toolName: 'Read', description: 'Low risk task' }),
      makeApproval({ id: '2', riskLevel: 'high', toolName: 'Bash', description: 'High risk task' }),
      makeApproval({
        id: '3',
        riskLevel: 'medium',
        toolName: 'Write',
        description: 'Medium risk task',
      }),
    ];

    const { getByText, queryByText } = render(<ApprovalsScreen />);

    // Initially "All" is selected; all should be visible
    expect(getByText('Low risk task')).toBeTruthy();
    expect(getByText('High risk task')).toBeTruthy();
    expect(getByText('Medium risk task')).toBeTruthy();

    // Filter to "High Risk"
    fireEvent.press(getByText('High Risk'));

    expect(getByText('High risk task')).toBeTruthy();
    expect(queryByText('Low risk task')).toBeNull();
    expect(queryByText('Medium risk task')).toBeNull();
  });

  it('filters to medium risk', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({ id: '1', riskLevel: 'low', description: 'Low task' }),
      makeApproval({ id: '2', riskLevel: 'medium', description: 'Medium task' }),
    ];

    const { getByText, queryByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Medium'));

    expect(getByText('Medium task')).toBeTruthy();
    expect(queryByText('Low task')).toBeNull();
  });

  it('filters to low risk', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({ id: '1', riskLevel: 'low', description: 'Low task' }),
      makeApproval({ id: '2', riskLevel: 'high', description: 'High task' }),
    ];

    const { getByText, queryByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Low'));

    expect(getByText('Low task')).toBeTruthy();
    expect(queryByText('High task')).toBeNull();
  });

  it('returns to all when All filter is re-selected', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({ id: '1', riskLevel: 'low', description: 'Low task' }),
      makeApproval({ id: '2', riskLevel: 'high', description: 'High task' }),
    ];

    const { getByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('High Risk'));
    fireEvent.press(getByText('All'));

    expect(getByText('Low task')).toBeTruthy();
    expect(getByText('High task')).toBeTruthy();
  });

  // ── Sort ───────────────────────────────────────────────────────────

  it('sorts by risk level when "Risk Level" sort chip is pressed', () => {
    const now = Date.now();
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        id: '1',
        riskLevel: 'low',
        description: 'Low task',
        createdAt: new Date(now).toISOString(),
      }),
      makeApproval({
        id: '2',
        riskLevel: 'high',
        description: 'High task',
        createdAt: new Date(now - 1000).toISOString(),
      }),
      makeApproval({
        id: '3',
        riskLevel: 'medium',
        description: 'Medium task',
        createdAt: new Date(now - 2000).toISOString(),
      }),
    ];

    const { getByText, getAllByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Risk Level'));

    // After sorting by risk: high, medium, low
    // Verify all items are still rendered
    expect(getByText('High task')).toBeTruthy();
    expect(getByText('Medium task')).toBeTruthy();
    expect(getByText('Low task')).toBeTruthy();
  });

  // ── Approval card rendering ────────────────────────────────────────

  it('renders an approval card with tool name, risk badge, and description', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'Bash',
        riskLevel: 'high',
        description: 'Run a dangerous command',
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);

    expect(getByText('HIGH')).toBeTruthy();
    expect(getByText('Bash')).toBeTruthy();
    expect(getByText('Run a dangerous command')).toBeTruthy();
  });

  it('renders the risk badge text in uppercase', () => {
    mockSessionsStore._state.pendingApprovals = [makeApproval({ riskLevel: 'medium' })];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('MEDIUM')).toBeTruthy();
  });

  it('renders critical risk badge', () => {
    mockSessionsStore._state.pendingApprovals = [makeApproval({ riskLevel: 'critical' as any })];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('CRITICAL')).toBeTruthy();
  });

  it('renders the expires time', () => {
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    mockSessionsStore._state.pendingApprovals = [makeApproval({ expiresAt })];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText(/Expires:/)).toBeTruthy();
  });

  // ── Context row (agent + machine) ─────────────────────────────────

  it('renders context row with agent name and machine name', () => {
    mockSessionsStore._state.sessions = [
      { id: 'session-1', machineId: 'machine-1', agent: 'claude-code' },
    ];
    mockMachinesStore._state.machines = [{ id: 'machine-1', name: 'Dev Laptop', isOnline: true }];
    mockSessionsStore._state.pendingApprovals = [makeApproval({ sessionId: 'session-1' })];

    const { getByText } = render(<ApprovalsScreen />);

    expect(getByText('Claude Code')).toBeTruthy();
    expect(getByText('Dev Laptop')).toBeTruthy();
    expect(getByText('on')).toBeTruthy();
  });

  it('renders agent name as-is for non-claude-code agents', () => {
    mockSessionsStore._state.sessions = [
      { id: 'session-1', machineId: 'machine-1', agent: 'aider' },
    ];
    mockMachinesStore._state.machines = [{ id: 'machine-1', name: 'Server' }];
    mockSessionsStore._state.pendingApprovals = [makeApproval({ sessionId: 'session-1' })];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('aider')).toBeTruthy();
  });

  it('renders without context row when session info is not found', () => {
    mockSessionsStore._state.sessions = [];
    mockSessionsStore._state.pendingApprovals = [makeApproval({ sessionId: 'unknown-session' })];

    const { queryByText, getByText } = render(<ApprovalsScreen />);
    // The description should still render
    expect(getByText('List directory contents')).toBeTruthy();
    // But "on" separator should not appear
    expect(queryByText('on')).toBeNull();
  });

  // ── Tool preview: Bash command (via preview field) ─────────────────

  it('renders command preview from preview.type=command', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        preview: { type: 'command', content: 'npm install' },
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('Terminal')).toBeTruthy();
    expect(getByText('$ ')).toBeTruthy();
    expect(getByText('npm install')).toBeTruthy();
  });

  // ── Tool preview: description ──────────────────────────────────────

  it('renders description preview from preview.type=description', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        preview: { type: 'description', content: '/path/to/file.ts' },
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('/path/to/file.ts')).toBeTruthy();
  });

  // ── Tool preview: diff ─────────────────────────────────────────────

  it('renders diff preview from preview.type=diff', () => {
    const diffContent = '+added line\n-removed line';
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        preview: { type: 'diff', content: diffContent },
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText(diffContent)).toBeTruthy();
  });

  it('truncates diff preview to 500 characters', () => {
    const longDiff = 'x'.repeat(600);
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        preview: { type: 'diff', content: longDiff },
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('x'.repeat(500))).toBeTruthy();
  });

  // ── Tool preview: Bash fallback (via toolInput) ────────────────────

  it('renders Bash command fallback from toolInput when no preview', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'Bash',
        toolInput: { command: 'git status' },
        preview: undefined,
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('Terminal')).toBeTruthy();
    expect(getByText('git status')).toBeTruthy();
  });

  // ── Tool preview: Write file fallback ──────────────────────────────

  it('renders Write file fallback from toolInput', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'Write',
        toolInput: { file_path: '/src/index.ts' },
        preview: undefined,
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('/src/index.ts')).toBeTruthy();
  });

  // ── Tool preview: Edit file fallback ───────────────────────────────

  it('renders Edit file fallback from toolInput', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'Edit',
        toolInput: { file_path: '/src/utils.ts' },
        preview: undefined,
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('/src/utils.ts')).toBeTruthy();
  });

  // ── Tool preview: generic key-value fallback ───────────────────────

  it('renders generic key-value fallback for unknown tools', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'WebFetch',
        toolInput: { url: 'https://example.com', prompt: 'Get data' },
        preview: undefined,
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('url')).toBeTruthy();
    expect(getByText('https://example.com')).toBeTruthy();
    expect(getByText('prompt')).toBeTruthy();
    expect(getByText('Get data')).toBeTruthy();
  });

  it('limits generic key-value to 3 entries', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'Custom',
        toolInput: { a: '1', b: '2', c: '3', d: '4' },
        preview: undefined,
      }),
    ];

    const { getByText, queryByText } = render(<ApprovalsScreen />);
    expect(getByText('a')).toBeTruthy();
    expect(getByText('b')).toBeTruthy();
    expect(getByText('c')).toBeTruthy();
    expect(queryByText('d')).toBeNull();
  });

  it('JSON stringifies non-string values in key-value fallback', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'Custom',
        toolInput: { data: { nested: true } },
        preview: undefined,
      }),
    ];

    const { getByText } = render(<ApprovalsScreen />);
    expect(getByText('data')).toBeTruthy();
    expect(getByText('{"nested":true}')).toBeTruthy();
  });

  it('renders nothing for tool preview when toolInput is empty and no preview', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({
        toolName: 'Unknown',
        toolInput: {},
        preview: undefined,
      }),
    ];

    const { queryByText, getByText } = render(<ApprovalsScreen />);
    // The description should still render but no Terminal or file block
    expect(getByText('List directory contents')).toBeTruthy();
    expect(queryByText('Terminal')).toBeNull();
  });

  // ── Approve action ─────────────────────────────────────────────────

  it('calls approveToolCall when the Approve button is pressed', () => {
    const approval = makeApproval();
    mockSessionsStore._state.pendingApprovals = [approval];

    const { getByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Approve'));

    expect(mockApproveToolCall).toHaveBeenCalledWith(
      approval.sessionId,
      approval.requestId,
      approval.id
    );
  });

  // ── Deny action ────────────────────────────────────────────────────

  it('calls denyToolCall when the Deny button is pressed', () => {
    const approval = makeApproval();
    mockSessionsStore._state.pendingApprovals = [approval];

    const { getByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Deny'));

    expect(mockDenyToolCall).toHaveBeenCalledWith(
      approval.sessionId,
      approval.requestId,
      approval.id
    );
  });

  // ── Processing state ───────────────────────────────────────────────

  it('adds the approval id to processingIds after pressing Approve', () => {
    const approval = makeApproval();
    mockSessionsStore._state.pendingApprovals = [approval];

    const { getByText, queryByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Approve'));

    // After pressing, the text "Approve" and "Deny" should be replaced by ActivityIndicators
    // because isProcessing becomes true. The text should no longer appear.
    expect(queryByText('Approve')).toBeNull();
    expect(queryByText('Deny')).toBeNull();
  });

  it('clears processing state after timeout', () => {
    const approval = makeApproval();
    mockSessionsStore._state.pendingApprovals = [approval];

    const { getByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Approve'));

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // After the timeout clears, the text should reappear
    expect(getByText('Approve')).toBeTruthy();
    expect(getByText('Deny')).toBeTruthy();
  });

  it('marks as processing on deny too', () => {
    const approval = makeApproval();
    mockSessionsStore._state.pendingApprovals = [approval];

    const { getByText, queryByText } = render(<ApprovalsScreen />);

    fireEvent.press(getByText('Deny'));

    expect(queryByText('Approve')).toBeNull();
    expect(queryByText('Deny')).toBeNull();
  });

  // ── Multiple approvals ─────────────────────────────────────────────

  it('renders multiple approval cards', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({ id: '1', toolName: 'Bash', description: 'First task' }),
      makeApproval({ id: '2', toolName: 'Write', description: 'Second task' }),
      makeApproval({ id: '3', toolName: 'Edit', description: 'Third task' }),
    ];

    const { getByText } = render(<ApprovalsScreen />);

    expect(getByText('First task')).toBeTruthy();
    expect(getByText('Second task')).toBeTruthy();
    expect(getByText('Third task')).toBeTruthy();
  });

  it('only processes the pressed card, leaving others interactive', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({ id: '1', sessionId: 's1', requestId: 'r1', description: 'Task A' }),
      makeApproval({ id: '2', sessionId: 's2', requestId: 'r2', description: 'Task B' }),
    ];

    const { getAllByText } = render(<ApprovalsScreen />);

    const approveButtons = getAllByText('Approve');
    expect(approveButtons).toHaveLength(2);

    // Press the first approve button
    fireEvent.press(approveButtons[0]);

    // The first card's approve disappears but the second should still be visible
    const remaining = getAllByText('Approve');
    expect(remaining).toHaveLength(1);
  });

  // ── Refresh ────────────────────────────────────────────────────────

  it('shows the refreshing bar text during pull-to-refresh', async () => {
    // We cannot easily simulate RefreshControl, but we can verify
    // that the component renders without errors
    const { queryByText } = render(<ApprovalsScreen />);
    // refreshing starts as false
    expect(queryByText('Refreshing\u2026')).toBeNull();
  });

  // ── Tool icons mapping ────────────────────────────────────────────

  it('renders the correct tool icon for known tools', () => {
    mockSessionsStore._state.pendingApprovals = [makeApproval({ toolName: 'Bash' })];

    const { getByTestId } = render(<ApprovalsScreen />);
    expect(getByTestId('icon-terminal-outline')).toBeTruthy();
  });

  it('renders build-outline icon for unknown tools', () => {
    mockSessionsStore._state.pendingApprovals = [makeApproval({ toolName: 'UnknownTool' })];

    const { getByTestId } = render(<ApprovalsScreen />);
    expect(getByTestId('icon-build-outline')).toBeTruthy();
  });

  it('renders correct icons for Write and Read tools', () => {
    mockSessionsStore._state.pendingApprovals = [
      makeApproval({ id: '1', toolName: 'Write', description: 'Write file' }),
      makeApproval({ id: '2', toolName: 'Read', description: 'Read file' }),
    ];

    const { getByTestId } = render(<ApprovalsScreen />);
    expect(getByTestId('icon-document-text-outline')).toBeTruthy();
    expect(getByTestId('icon-eye-outline')).toBeTruthy();
  });
});

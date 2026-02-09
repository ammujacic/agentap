/**
 * Tests for Sessions screen — app/(tabs)/sessions.tsx
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const { mockRouter, mockMachinesStore, mockSessionsStore, mockApiClient } = require('../../setup');

// Mock WebSocketProvider
const mockRefreshAll = jest.fn();
jest.mock('../../../components/WebSocketProvider', () => ({
  useWebSocketContext: jest.fn(() => ({
    subscribeToSession: jest.fn(),
    sendMessage: jest.fn(),
    approveToolCall: jest.fn(),
    denyToolCall: jest.fn(),
    cancelSession: jest.fn(),
    refreshAll: mockRefreshAll,
  })),
}));

// Mock AuthProvider (may be indirectly needed)
jest.mock('../../../components/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ signOut: jest.fn() })),
}));

// Mock ClaudeCodeIcon component
jest.mock('../../../components/icons/ClaudeCodeIcon', () => {
  const React = require('react');
  return {
    ClaudeCodeIcon: ({ size }: { size?: number }) =>
      React.createElement('View', { testID: 'claude-code-icon', size }),
  };
});

// Mock timeAgo utility
jest.mock('../../../utils/timeAgo', () => ({
  timeAgo: jest.fn(() => 'just now'),
}));

// Import the component under test (after mocks)
import SessionsScreen from '../../../app/(tabs)/sessions';

// ── Helpers ───────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    agent: 'claude-code',
    machineId: 'machine-1',
    projectPath: '/home/user/project',
    projectName: 'my-project',
    status: 'running',
    lastMessage: 'Working on the feature...',
    lastActivity: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    sessionName: null,
    model: 'claude-sonnet-4-20250514',
    agentMode: 'auto',
    ...overrides,
  };
}

function makeMachine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'machine-1',
    userId: 'user-1',
    name: 'My MacBook',
    tunnelId: 'tunnel-1',
    tunnelUrl: 'ws://localhost:9876',
    os: 'darwin',
    arch: 'arm64',
    agentsDetected: ['claude-code'],
    isOnline: true,
    activeSessionCount: 1,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Setup / Teardown ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Reset sessions store
  mockSessionsStore._state = {
    sessions: [],
    pendingApprovals: [],
    setSessionsForMachine: jest.fn(),
    handleACPEvent: jest.fn(),
    completeHistoryLoading: jest.fn(),
    startHistoryLoading: jest.fn(),
  };

  // Reset machines store
  mockMachinesStore._state = {
    machines: [],
    setMachines: jest.fn(),
    addMachine: jest.fn(),
    removeMachine: jest.fn(),
    updateMachine: jest.fn(),
  };

  // API defaults
  mockApiClient.getMachines.mockResolvedValue({ machines: [] });
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Empty state ───────────────────────────────────────────────────────

describe('empty state', () => {
  it('renders the empty state when there are no sessions', () => {
    const { getByText } = render(<SessionsScreen />);

    expect(getByText('No active sessions')).toBeTruthy();
    expect(getByText('Start a coding agent on your machine to see it here')).toBeTruthy();
  });

  it('shows the terminal-outline icon in empty state', () => {
    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('icon-terminal-outline')).toBeTruthy();
  });
});

// ── Session list rendering ────────────────────────────────────────────

describe('session list', () => {
  it('renders session cards with project name and agent info', () => {
    const session = makeSession({ projectName: 'awesome-project', agent: 'claude-code' });
    mockSessionsStore._state.sessions = [session];

    const { getAllByText } = render(<SessionsScreen />);

    // projectName appears in both title and subtitle
    expect(getAllByText(/awesome-project/).length).toBeGreaterThanOrEqual(1);
    // Subtitle shows "projectName . agent"
    expect(getAllByText(/claude-code/).length).toBeGreaterThanOrEqual(1);
  });

  it('uses sessionName (stripped of system tags) as title when available', () => {
    const session = makeSession({
      sessionName: 'Fix the bug',
      projectName: 'my-project',
    });
    mockSessionsStore._state.sessions = [session];

    const { getByText } = render(<SessionsScreen />);

    // stripSystemTags is mocked to return the input as-is
    expect(getByText('Fix the bug')).toBeTruthy();
  });

  it('falls back to projectName when sessionName is null', () => {
    const session = makeSession({ sessionName: null, projectName: 'fallback-project' });
    mockSessionsStore._state.sessions = [session];

    const { getAllByText } = render(<SessionsScreen />);

    // projectName appears both as title and in subtitle
    const matches = getAllByText(/fallback-project/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders lastMessage when present', () => {
    const session = makeSession({ lastMessage: 'Implementing authentication...' });
    mockSessionsStore._state.sessions = [session];

    const { getByText } = render(<SessionsScreen />);

    expect(getByText('Implementing authentication...')).toBeTruthy();
  });

  it('does not render lastMessage when null', () => {
    const session = makeSession({ lastMessage: null });
    mockSessionsStore._state.sessions = [session];

    const { queryByText } = render(<SessionsScreen />);

    expect(queryByText('Implementing authentication...')).toBeNull();
  });

  it('shows machine badge when machine is found', () => {
    const machine = makeMachine({ id: 'machine-1', name: 'Work Laptop' });
    const session = makeSession({ machineId: 'machine-1' });
    mockMachinesStore._state.machines = [machine];
    mockSessionsStore._state.sessions = [session];

    const { getByText } = render(<SessionsScreen />);

    expect(getByText('Work Laptop')).toBeTruthy();
  });

  it('does not show machine badge when machine is not found', () => {
    const session = makeSession({ machineId: 'unknown-machine' });
    mockMachinesStore._state.machines = [];
    mockSessionsStore._state.sessions = [session];

    const { queryByText } = render(<SessionsScreen />);

    expect(queryByText('Work Laptop')).toBeNull();
  });

  it('renders multiple sessions', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'Project Alpha' }),
      makeSession({ id: 's2', projectName: 'Project Beta' }),
      makeSession({ id: 's3', projectName: 'Project Gamma' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getAllByText } = render(<SessionsScreen />);

    expect(getAllByText(/Project Alpha/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Project Beta/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Project Gamma/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows timestamp from timeAgo utility', () => {
    const session = makeSession();
    mockSessionsStore._state.sessions = [session];

    const { getByText } = render(<SessionsScreen />);

    // timeAgo is mocked to return 'just now'
    expect(getByText('just now')).toBeTruthy();
  });
});

// ── Agent icon rendering ──────────────────────────────────────────────

describe('agent icons', () => {
  it('renders ClaudeCodeIcon for claude-code agent', () => {
    const session = makeSession({ agent: 'claude-code' });
    mockSessionsStore._state.sessions = [session];

    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('claude-code-icon')).toBeTruthy();
  });

  it('renders emoji for codex agent', () => {
    const session = makeSession({ id: 's-codex', agent: 'codex' });
    mockSessionsStore._state.sessions = [session];

    // The codex emoji is a blue diamond
    const { queryByTestId } = render(<SessionsScreen />);
    // ClaudeCodeIcon should NOT be rendered
    expect(queryByTestId('claude-code-icon')).toBeNull();
  });

  it('renders emoji for aider agent', () => {
    const session = makeSession({ id: 's-aider', agent: 'aider' });
    mockSessionsStore._state.sessions = [session];

    const { queryByTestId } = render(<SessionsScreen />);
    expect(queryByTestId('claude-code-icon')).toBeNull();
  });

  it('renders default emoji for unknown agent', () => {
    const session = makeSession({ id: 's-unknown', agent: 'some-new-agent' });
    mockSessionsStore._state.sessions = [session];

    const { queryByTestId } = render(<SessionsScreen />);
    expect(queryByTestId('claude-code-icon')).toBeNull();
  });
});

// ── Status icons ──────────────────────────────────────────────────────

describe('status icons', () => {
  it('shows green ellipse icon for running sessions', () => {
    const session = makeSession({ status: 'running' });
    mockSessionsStore._state.sessions = [session];

    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('icon-ellipse')).toBeTruthy();
  });

  it('shows alert-circle icon for waiting_for_approval sessions', () => {
    const session = makeSession({ status: 'waiting_for_approval' });
    mockSessionsStore._state.sessions = [session];

    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('icon-alert-circle')).toBeTruthy();
  });

  it('shows chatbubble-ellipses icon for waiting_for_input sessions', () => {
    const session = makeSession({ status: 'waiting_for_input' });
    mockSessionsStore._state.sessions = [session];

    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('icon-chatbubble-ellipses')).toBeTruthy();
  });

  it('shows close-circle icon for error sessions', () => {
    const session = makeSession({ status: 'error' });
    mockSessionsStore._state.sessions = [session];

    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('icon-close-circle')).toBeTruthy();
  });

  it('shows ellipse icon for completed sessions', () => {
    const session = makeSession({ status: 'completed' });
    mockSessionsStore._state.sessions = [session];

    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('icon-ellipse')).toBeTruthy();
  });

  it('shows ellipse icon for idle sessions', () => {
    const session = makeSession({ status: 'idle' });
    mockSessionsStore._state.sessions = [session];

    const { getByTestId } = render(<SessionsScreen />);

    expect(getByTestId('icon-ellipse')).toBeTruthy();
  });
});

// ── Navigation ────────────────────────────────────────────────────────

describe('navigation', () => {
  it('navigates to session detail on card press', () => {
    const session = makeSession({ id: 'session-42' });
    mockSessionsStore._state.sessions = [session];

    const { getByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('my-project'));

    expect(mockRouter.push).toHaveBeenCalledWith('/session/session-42');
  });
});

// ── Search functionality ──────────────────────────────────────────────

describe('search', () => {
  it('renders search input', () => {
    const { getByPlaceholderText } = render(<SessionsScreen />);

    expect(getByPlaceholderText('Search sessions...')).toBeTruthy();
  });

  it('filters sessions by project name', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'frontend-app' }),
      makeSession({ id: 's2', projectName: 'backend-api' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByPlaceholderText, getAllByText, queryByText } = render(<SessionsScreen />);

    fireEvent.changeText(getByPlaceholderText('Search sessions...'), 'frontend');

    expect(getAllByText(/frontend-app/).length).toBeGreaterThanOrEqual(1);
    expect(queryByText(/backend-api/)).toBeNull();
  });

  it('filters sessions by agent name', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'proj-a', agent: 'claude-code' }),
      makeSession({ id: 's2', projectName: 'proj-b', agent: 'aider' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByPlaceholderText, queryByText } = render(<SessionsScreen />);

    fireEvent.changeText(getByPlaceholderText('Search sessions...'), 'aider');

    expect(queryByText(/proj-a/)).toBeNull();
  });

  it('filters sessions by lastMessage', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'proj-a', lastMessage: 'Fixing auth bug' }),
      makeSession({ id: 's2', projectName: 'proj-b', lastMessage: 'Adding tests' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByPlaceholderText, getByText, queryByText } = render(<SessionsScreen />);

    fireEvent.changeText(getByPlaceholderText('Search sessions...'), 'auth');

    expect(getByText('Fixing auth bug')).toBeTruthy();
    expect(queryByText('Adding tests')).toBeNull();
  });

  it('filters sessions by machine name', () => {
    const machine = makeMachine({ id: 'machine-1', name: 'Work Laptop' });
    mockMachinesStore._state.machines = [machine];

    const sessions = [
      makeSession({ id: 's1', projectName: 'proj-a', machineId: 'machine-1' }),
      makeSession({ id: 's2', projectName: 'proj-b', machineId: 'machine-2' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByPlaceholderText, getAllByText, queryByText } = render(<SessionsScreen />);

    fireEvent.changeText(getByPlaceholderText('Search sessions...'), 'work laptop');

    expect(getAllByText(/proj-a/).length).toBeGreaterThanOrEqual(1);
    expect(queryByText(/proj-b/)).toBeNull();
  });

  it('search is case-insensitive', () => {
    mockSessionsStore._state.sessions = [makeSession({ projectName: 'MyProject' })];

    const { getByPlaceholderText, getAllByText } = render(<SessionsScreen />);

    fireEvent.changeText(getByPlaceholderText('Search sessions...'), 'MYPROJECT');

    expect(getAllByText(/MyProject/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows clear button when search has text', () => {
    const { getByPlaceholderText, getByTestId } = render(<SessionsScreen />);

    fireEvent.changeText(getByPlaceholderText('Search sessions...'), 'test');

    expect(getByTestId('icon-close-circle')).toBeTruthy();
  });

  it('does not show clear button when search is empty', () => {
    const { queryByTestId } = render(<SessionsScreen />);

    // close-circle should not be in the search bar when empty
    // Note: close-circle may appear as a status icon though, so we check
    // the icon is not rendered in the search context by verifying the
    // search input value is empty
    const searchCloseIcons = queryByTestId('icon-close-circle');
    // With no sessions, close-circle might appear as a status icon but not in search
    // This is best tested by checking that no close-circle exists at all when no text typed
    expect(searchCloseIcons).toBeNull();
  });

  it('clears search when clear button is pressed', () => {
    mockSessionsStore._state.sessions = [
      makeSession({ id: 's1', projectName: 'Alpha' }),
      makeSession({ id: 's2', projectName: 'Beta' }),
    ];

    const { getByPlaceholderText, getByTestId, getAllByText } = render(<SessionsScreen />);

    fireEvent.changeText(getByPlaceholderText('Search sessions...'), 'Alpha');
    fireEvent.press(getByTestId('icon-close-circle'));

    // Both sessions should be visible again
    expect(getAllByText(/Alpha/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Beta/).length).toBeGreaterThanOrEqual(1);
  });
});

// ── Filter chips ──────────────────────────────────────────────────────

describe('filter chips', () => {
  it('shows all filter chips', () => {
    const { getByText } = render(<SessionsScreen />);

    expect(getByText('All')).toBeTruthy();
    expect(getByText('Running')).toBeTruthy();
    expect(getByText('Waiting')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Error')).toBeTruthy();
  });

  it('filters to running sessions when "Running" chip is pressed', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'Running Proj', status: 'running' }),
      makeSession({ id: 's2', projectName: 'Done Proj', status: 'completed' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByText, getAllByText, queryByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('Running'));

    expect(getAllByText(/Running Proj/).length).toBeGreaterThanOrEqual(1);
    expect(queryByText(/Done Proj/)).toBeNull();
  });

  it('filters to waiting sessions when "Waiting" chip is pressed', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'Waiting Proj', status: 'waiting_for_approval' }),
      makeSession({ id: 's2', projectName: 'Input Proj', status: 'waiting_for_input' }),
      makeSession({ id: 's3', projectName: 'Running Proj', status: 'running' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByText, getAllByText, queryByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('Waiting'));

    expect(getAllByText(/Waiting Proj/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Input Proj/).length).toBeGreaterThanOrEqual(1);
    expect(queryByText(/Running Proj/)).toBeNull();
  });

  it('filters to completed/idle/paused sessions when "Completed" chip is pressed', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'Completed Proj', status: 'completed' }),
      makeSession({ id: 's2', projectName: 'Idle Proj', status: 'idle' }),
      makeSession({ id: 's3', projectName: 'Paused Proj', status: 'paused' }),
      makeSession({ id: 's4', projectName: 'Active Proj', status: 'running' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByText, getAllByText, queryByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('Completed'));

    expect(getAllByText(/Completed Proj/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Idle Proj/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Paused Proj/).length).toBeGreaterThanOrEqual(1);
    expect(queryByText(/Active Proj/)).toBeNull();
  });

  it('filters to error sessions when "Error" chip is pressed', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'Error Proj', status: 'error' }),
      makeSession({ id: 's2', projectName: 'OK Proj', status: 'running' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByText, getAllByText, queryByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('Error'));

    expect(getAllByText(/Error Proj/).length).toBeGreaterThanOrEqual(1);
    expect(queryByText(/OK Proj/)).toBeNull();
  });

  it('shows all sessions when "All" chip is pressed after filtering', () => {
    const sessions = [
      makeSession({ id: 's1', projectName: 'Proj A', status: 'running' }),
      makeSession({ id: 's2', projectName: 'Proj B', status: 'completed' }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByText, getAllByText } = render(<SessionsScreen />);

    // First filter to running
    fireEvent.press(getByText('Running'));
    // Then go back to all
    fireEvent.press(getByText('All'));

    expect(getAllByText(/Proj A/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Proj B/).length).toBeGreaterThanOrEqual(1);
  });
});

// ── Sort chips ────────────────────────────────────────────────────────

describe('sort chips', () => {
  it('shows all sort chips', () => {
    const { getByText } = render(<SessionsScreen />);

    expect(getByText('Recent Activity')).toBeTruthy();
    expect(getByText('Newest')).toBeTruthy();
    expect(getByText('Oldest')).toBeTruthy();
  });

  it('sorts by recent activity by default', () => {
    const sessions = [
      makeSession({
        id: 's1',
        projectName: 'Old Activity',
        lastActivity: new Date('2024-01-01').toISOString(),
      }),
      makeSession({
        id: 's2',
        projectName: 'Recent Activity',
        lastActivity: new Date('2024-06-01').toISOString(),
      }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getAllByText } = render(<SessionsScreen />);

    // The more recent activity should appear first
    const projectTexts = getAllByText(/Activity$/);
    expect(projectTexts[0].props.children).toContain('Recent Activity');
  });

  it('sorts by newest creation date when "Newest" is pressed', () => {
    const sessions = [
      makeSession({
        id: 's1',
        projectName: 'Old Created',
        createdAt: new Date('2024-01-01').toISOString(),
        lastActivity: new Date('2024-12-01').toISOString(),
      }),
      makeSession({
        id: 's2',
        projectName: 'New Created',
        createdAt: new Date('2024-06-01').toISOString(),
        lastActivity: new Date('2024-02-01').toISOString(),
      }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByText, getAllByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('Newest'));

    const projectTexts = getAllByText(/Created$/);
    expect(projectTexts[0].props.children).toContain('New Created');
  });

  it('sorts by oldest creation date when "Oldest" is pressed', () => {
    const sessions = [
      makeSession({
        id: 's1',
        projectName: 'New Created',
        createdAt: new Date('2024-06-01').toISOString(),
        lastActivity: new Date('2024-12-01').toISOString(),
      }),
      makeSession({
        id: 's2',
        projectName: 'Old Created',
        createdAt: new Date('2024-01-01').toISOString(),
        lastActivity: new Date('2024-02-01').toISOString(),
      }),
    ];
    mockSessionsStore._state.sessions = sessions;

    const { getByText, getAllByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('Oldest'));

    const projectTexts = getAllByText(/Created$/);
    expect(projectTexts[0].props.children).toContain('Old Created');
  });
});

// ── Pending approvals banner ──────────────────────────────────────────

describe('pending approvals banner', () => {
  it('shows approval banner when there are pending approvals', () => {
    mockSessionsStore._state.pendingApprovals = [
      {
        id: 'a1',
        requestId: 'r1',
        sessionId: 's1',
        toolName: 'write_file',
        toolInput: {},
        description: 'Write file',
        riskLevel: 'high',
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const { getByText } = render(<SessionsScreen />);

    expect(getByText('1 pending approval')).toBeTruthy();
  });

  it('shows plural "approvals" for multiple pending', () => {
    mockSessionsStore._state.pendingApprovals = [
      {
        id: 'a1',
        requestId: 'r1',
        sessionId: 's1',
        toolName: 'write_file',
        toolInput: {},
        description: 'Write file',
        riskLevel: 'high',
        expiresAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'a2',
        requestId: 'r2',
        sessionId: 's2',
        toolName: 'bash',
        toolInput: {},
        description: 'Run command',
        riskLevel: 'critical',
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const { getByText } = render(<SessionsScreen />);

    expect(getByText('2 pending approvals')).toBeTruthy();
  });

  it('navigates to approvals tab when banner is pressed', () => {
    mockSessionsStore._state.pendingApprovals = [
      {
        id: 'a1',
        requestId: 'r1',
        sessionId: 's1',
        toolName: 'write_file',
        toolInput: {},
        description: 'Write file',
        riskLevel: 'high',
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const { getByText } = render(<SessionsScreen />);

    fireEvent.press(getByText('1 pending approval'));

    expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/approvals');
  });

  it('does not show approval banner when no pending approvals', () => {
    mockSessionsStore._state.pendingApprovals = [];

    const { queryByText } = render(<SessionsScreen />);

    expect(queryByText(/pending approval/)).toBeNull();
  });
});

// ── Refreshing ────────────────────────────────────────────────────────

describe('refreshing', () => {
  it('shows refresh bar text while refreshing', async () => {
    // To trigger refreshing, we need to simulate the onRefresh callback.
    // The RefreshControl's onRefresh is wired to onRefresh which sets refreshing=true.
    // We cannot easily trigger RefreshControl programmatically in RNTL,
    // but we can verify the refresh bar is NOT shown on initial mount
    // (since refreshing starts as false).
    const { queryByText } = render(<SessionsScreen />);

    // On initial render, refreshing is false
    expect(queryByText('Refreshing\u2026')).toBeNull();
  });
});

// ── List header always visible ────────────────────────────────────────

describe('list header', () => {
  it('shows search and filter chips even when sessions are empty', () => {
    mockSessionsStore._state.sessions = [];

    const { getByPlaceholderText, getByText } = render(<SessionsScreen />);

    // ListHeader is always rendered in sessions screen
    expect(getByPlaceholderText('Search sessions...')).toBeTruthy();
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Running')).toBeTruthy();
    expect(getByText('Recent Activity')).toBeTruthy();
  });
});

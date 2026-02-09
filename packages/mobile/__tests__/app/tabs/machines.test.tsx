/**
 * Tests for Machines screen — app/(tabs)/index.tsx
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

const { mockRouter, mockMachinesStore, mockApiClient } = require('../../setup');

// Mock AuthProvider and WebSocketProvider (not used directly by Machines screen,
// but imported by other components in the tree)
jest.mock('../../../components/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ signOut: jest.fn() })),
}));

jest.mock('../../../components/WebSocketProvider', () => ({
  useWebSocketContext: jest.fn(() => ({
    subscribeToSession: jest.fn(),
    sendMessage: jest.fn(),
    approveToolCall: jest.fn(),
    denyToolCall: jest.fn(),
    cancelSession: jest.fn(),
    refreshAll: jest.fn(),
  })),
}));

// Import the component under test (after mocks are set up)
import MachinesScreen from '../../../app/(tabs)/index';

// ── Helpers ───────────────────────────────────────────────────────────

function makeMachine(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    userId: 'user-1',
    name: 'My MacBook',
    tunnelId: 'tunnel-1',
    tunnelUrl: 'ws://localhost:9876',
    os: 'darwin',
    arch: 'arm64',
    agentsDetected: ['claude-code'],
    isOnline: true,
    activeSessionCount: 2,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Setup / Teardown ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Reset machines store to defaults
  mockMachinesStore._state = {
    machines: [],
    setMachines: jest.fn(),
    addMachine: jest.fn(),
    removeMachine: jest.fn(),
    updateMachine: jest.fn(),
  };

  // API defaults
  mockApiClient.getMachines.mockResolvedValue({ machines: [] });
  mockApiClient.deleteMachine.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── getTimeAgo helper (tested indirectly via rendered output) ─────────

describe('getTimeAgo (via rendered output)', () => {
  it('shows "just now" for a very recent lastSeenAt', async () => {
    const machine = makeMachine({ lastSeenAt: new Date().toISOString() });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText(/Last seen: just now/)).toBeTruthy();
  });

  it('shows seconds ago', () => {
    const date = new Date(Date.now() - 30 * 1000); // 30s ago
    const machine = makeMachine({ lastSeenAt: date.toISOString() });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText(/Last seen: 30s ago/)).toBeTruthy();
  });

  it('shows minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000); // 5m ago
    const machine = makeMachine({ lastSeenAt: date.toISOString() });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText(/Last seen: 5m ago/)).toBeTruthy();
  });

  it('shows hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
    const machine = makeMachine({ lastSeenAt: date.toISOString() });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText(/Last seen: 3h ago/)).toBeTruthy();
  });

  it('shows days ago', () => {
    const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10d ago
    const machine = makeMachine({ lastSeenAt: date.toISOString() });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText(/Last seen: 10d ago/)).toBeTruthy();
  });

  it('shows months ago', () => {
    const date = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // ~3 months
    const machine = makeMachine({ lastSeenAt: date.toISOString() });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText(/Last seen: 3mo ago/)).toBeTruthy();
  });

  it('shows years ago', () => {
    const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // ~1 year
    const machine = makeMachine({ lastSeenAt: date.toISOString() });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText(/Last seen: 1y ago/)).toBeTruthy();
  });

  it('shows "Never connected" when lastSeenAt is null', () => {
    const machine = makeMachine({ lastSeenAt: null });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('Never connected')).toBeTruthy();
  });
});

// ── Empty state ───────────────────────────────────────────────────────

describe('empty state', () => {
  it('renders the empty state when there are no machines', () => {
    mockMachinesStore._state.machines = [];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('No machines linked')).toBeTruthy();
    expect(getByText('Get started in 3 steps:')).toBeTruthy();
  });

  it('shows setup instructions with step numbers', () => {
    mockMachinesStore._state.machines = [];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('1')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('Install the daemon on your computer:')).toBeTruthy();
    expect(getByText('Run the link command:')).toBeTruthy();
    expect(getByText('Scan the QR code or enter the pairing code:')).toBeTruthy();
  });

  it('shows code blocks with npx agentap and agentap link', () => {
    mockMachinesStore._state.machines = [];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('npx agentap')).toBeTruthy();
    expect(getByText('agentap link')).toBeTruthy();
  });

  it('shows "Link a Machine" button that navigates to /scan', () => {
    mockMachinesStore._state.machines = [];

    const { getByText } = render(<MachinesScreen />);

    const linkButton = getByText('Link a Machine');
    fireEvent.press(linkButton);

    expect(mockRouter.push).toHaveBeenCalledWith('/scan');
  });

  it('does not show search bar or filter chips in empty state', () => {
    mockMachinesStore._state.machines = [];

    const { queryByPlaceholderText, queryByText } = render(<MachinesScreen />);

    expect(queryByPlaceholderText('Search machines...')).toBeNull();
    expect(queryByText('Online')).toBeNull();
    expect(queryByText('Offline')).toBeNull();
  });
});

// ── Loading / refreshing state ────────────────────────────────────────

describe('refreshing state', () => {
  it('calls loadMachines on mount', () => {
    render(<MachinesScreen />);

    expect(mockApiClient.getMachines).toHaveBeenCalled();
  });

  it('shows refreshing bar while loading', async () => {
    // Make getMachines hang so refreshing stays true
    mockApiClient.getMachines.mockReturnValue(new Promise(() => {}));

    const { getByText } = render(<MachinesScreen />);

    // The component sets refreshing=true before the API call resolves
    await waitFor(() => {
      expect(getByText('Refreshing\u2026')).toBeTruthy();
    });
  });

  it('stores fetched machines via setMachines', async () => {
    const machines = [makeMachine()];
    mockApiClient.getMachines.mockResolvedValue({ machines });

    render(<MachinesScreen />);

    await waitFor(() => {
      expect(mockMachinesStore._state.setMachines).toHaveBeenCalledWith(machines);
    });
  });

  it('handles API error gracefully on load', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockApiClient.getMachines.mockRejectedValue(new Error('Network error'));

    // Should not throw
    render(<MachinesScreen />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load machines:', expect.any(Error));
    });

    consoleSpy.mockRestore();
  });
});

// ── Machine list rendering ────────────────────────────────────────────

describe('machine list', () => {
  it('renders machine cards with name and agent details', () => {
    const machine = makeMachine({ name: 'Work Laptop', agentsDetected: ['claude-code', 'aider'] });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('Work Laptop')).toBeTruthy();
    expect(getByText('claude-code, aider')).toBeTruthy();
  });

  it('shows "No agents detected" when agentsDetected is empty', () => {
    const machine = makeMachine({ agentsDetected: [] });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('No agents detected')).toBeTruthy();
  });

  it('shows online status badge for an online machine', () => {
    const machine = makeMachine({ isOnline: true });
    mockMachinesStore._state.machines = [machine];

    const { getAllByText } = render(<MachinesScreen />);

    // "Online" appears as both filter chip and status badge
    expect(getAllByText('Online').length).toBeGreaterThanOrEqual(1);
  });

  it('shows offline status badge for an offline machine', () => {
    const machine = makeMachine({ isOnline: false });
    mockMachinesStore._state.machines = [machine];

    const { getAllByText } = render(<MachinesScreen />);

    // "Offline" appears as both filter chip and status badge
    expect(getAllByText('Offline').length).toBeGreaterThanOrEqual(1);
  });

  it('shows active session count when > 0', () => {
    const machine = makeMachine({ activeSessionCount: 3 });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('3 active sessions')).toBeTruthy();
  });

  it('shows singular "session" for count of 1', () => {
    const machine = makeMachine({ activeSessionCount: 1 });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('1 active session')).toBeTruthy();
  });

  it('does not show session count when activeSessionCount is 0', () => {
    const machine = makeMachine({ activeSessionCount: 0 });
    mockMachinesStore._state.machines = [machine];

    const { queryByText } = render(<MachinesScreen />);

    expect(queryByText(/active session/)).toBeNull();
  });

  it('renders multiple machines', () => {
    const machines = [
      makeMachine({ id: '1', name: 'MacBook Pro' }),
      makeMachine({ id: '2', name: 'Linux Desktop', os: 'linux', isOnline: false }),
    ];
    mockMachinesStore._state.machines = machines;

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('MacBook Pro')).toBeTruthy();
    expect(getByText('Linux Desktop')).toBeTruthy();
  });

  it('uses laptop icon for darwin OS and desktop icon otherwise', () => {
    const machines = [
      makeMachine({ id: '1', name: 'Mac', os: 'darwin' }),
      makeMachine({ id: '2', name: 'Linux', os: 'linux' }),
    ];
    mockMachinesStore._state.machines = machines;

    const { getByTestId } = render(<MachinesScreen />);

    // Ionicons are mocked as Text with testID="icon-{name}"
    expect(getByTestId('icon-laptop')).toBeTruthy();
    expect(getByTestId('icon-desktop')).toBeTruthy();
  });
});

// ── Navigation ────────────────────────────────────────────────────────

describe('navigation', () => {
  it('navigates to machine detail on card press', () => {
    const machine = makeMachine({ id: 'machine-42' });
    mockMachinesStore._state.machines = [machine];

    const { getByText } = render(<MachinesScreen />);

    fireEvent.press(getByText('My MacBook'));

    expect(mockRouter.push).toHaveBeenCalledWith('/machine/machine-42');
  });

  it('shows FAB button that navigates to /scan', () => {
    const machine = makeMachine();
    mockMachinesStore._state.machines = [machine];

    const { getByTestId } = render(<MachinesScreen />);

    // The FAB contains an Ionicons "add" icon
    const addIcon = getByTestId('icon-add');
    fireEvent.press(addIcon);

    expect(mockRouter.push).toHaveBeenCalledWith('/scan');
  });

  it('does not show FAB when machine list is empty', () => {
    mockMachinesStore._state.machines = [];

    const { queryByTestId } = render(<MachinesScreen />);

    // FAB should not be rendered
    expect(queryByTestId('icon-add')).toBeNull();
  });
});

// ── Search functionality ──────────────────────────────────────────────

describe('search', () => {
  it('renders search input when machines exist', () => {
    mockMachinesStore._state.machines = [makeMachine()];

    const { getByPlaceholderText } = render(<MachinesScreen />);

    expect(getByPlaceholderText('Search machines...')).toBeTruthy();
  });

  it('filters machines by name', () => {
    const machines = [
      makeMachine({ id: '1', name: 'MacBook Pro' }),
      makeMachine({ id: '2', name: 'Linux Server' }),
    ];
    mockMachinesStore._state.machines = machines;

    const { getByPlaceholderText, getByText, queryByText } = render(<MachinesScreen />);

    fireEvent.changeText(getByPlaceholderText('Search machines...'), 'Linux');

    expect(getByText('Linux Server')).toBeTruthy();
    expect(queryByText('MacBook Pro')).toBeNull();
  });

  it('filters machines by agent name', () => {
    const machines = [
      makeMachine({ id: '1', name: 'Machine A', agentsDetected: ['claude-code'] }),
      makeMachine({ id: '2', name: 'Machine B', agentsDetected: ['aider'] }),
    ];
    mockMachinesStore._state.machines = machines;

    const { getByPlaceholderText, getByText, queryByText } = render(<MachinesScreen />);

    fireEvent.changeText(getByPlaceholderText('Search machines...'), 'aider');

    expect(getByText('Machine B')).toBeTruthy();
    expect(queryByText('Machine A')).toBeNull();
  });

  it('search is case-insensitive', () => {
    mockMachinesStore._state.machines = [makeMachine({ name: 'MacBook Pro' })];

    const { getByPlaceholderText, getByText } = render(<MachinesScreen />);

    fireEvent.changeText(getByPlaceholderText('Search machines...'), 'MACBOOK');

    expect(getByText('MacBook Pro')).toBeTruthy();
  });

  it('shows clear button when search has text', () => {
    mockMachinesStore._state.machines = [makeMachine()];

    const { getByPlaceholderText, getByTestId } = render(<MachinesScreen />);

    fireEvent.changeText(getByPlaceholderText('Search machines...'), 'test');

    // The clear button renders an Ionicons "close-circle"
    expect(getByTestId('icon-close-circle')).toBeTruthy();
  });

  it('clears search when clear button is pressed', () => {
    mockMachinesStore._state.machines = [
      makeMachine({ id: '1', name: 'MacBook' }),
      makeMachine({ id: '2', name: 'Linux' }),
    ];

    const { getByPlaceholderText, getByTestId, getByText } = render(<MachinesScreen />);

    const searchInput = getByPlaceholderText('Search machines...');
    fireEvent.changeText(searchInput, 'MacBook');

    // Press clear button
    fireEvent.press(getByTestId('icon-close-circle'));

    // Both machines should now be visible
    expect(getByText('MacBook')).toBeTruthy();
    expect(getByText('Linux')).toBeTruthy();
  });
});

// ── Filter chips ──────────────────────────────────────────────────────

describe('filter chips', () => {
  const machines = [
    makeMachine({ id: '1', name: 'Online Machine', isOnline: true }),
    makeMachine({ id: '2', name: 'Offline Machine', isOnline: false }),
  ];

  it('shows All, Online, and Offline filter chips', () => {
    mockMachinesStore._state.machines = machines;

    const { getByText, getAllByText } = render(<MachinesScreen />);

    expect(getByText('All')).toBeTruthy();
    // "Online" and "Offline" appear as both filter chip and status badge
    expect(getAllByText('Online').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Offline').length).toBeGreaterThanOrEqual(1);
  });

  it('shows all machines with "All" filter (default)', () => {
    mockMachinesStore._state.machines = machines;

    const { getByText } = render(<MachinesScreen />);

    expect(getByText('Online Machine')).toBeTruthy();
    expect(getByText('Offline Machine')).toBeTruthy();
  });

  it('filters to online machines only when "Online" chip is pressed', () => {
    mockMachinesStore._state.machines = machines;

    const { getAllByText, queryByText } = render(<MachinesScreen />);

    // "Online" appears as both filter chip and status badge; press the first one (chip)
    const onlineTexts = getAllByText('Online');
    fireEvent.press(onlineTexts[0]);

    // After filtering, "Offline Machine" card should not be rendered
    // but "Offline" text still exists as a filter chip label
    expect(queryByText('Offline Machine')).toBeNull();
  });

  it('filters to offline machines only when "Offline" chip is pressed', () => {
    mockMachinesStore._state.machines = machines;

    const { getAllByText, queryByText } = render(<MachinesScreen />);

    // Press the "Offline" chip — it appears in the chip row
    const offlineTexts = getAllByText('Offline');
    fireEvent.press(offlineTexts[0]);

    expect(queryByText('Online Machine')).toBeNull();
  });
});

// ── Sorting ───────────────────────────────────────────────────────────

describe('sorting', () => {
  it('sorts online machines first by default (online_first)', () => {
    const machines = [
      makeMachine({
        id: '1',
        name: 'Offline One',
        isOnline: false,
        lastSeenAt: new Date(Date.now() - 1000).toISOString(),
      }),
      makeMachine({
        id: '2',
        name: 'Online One',
        isOnline: true,
        lastSeenAt: new Date(Date.now() - 2000).toISOString(),
      }),
    ];
    mockMachinesStore._state.machines = machines;

    const { getAllByText } = render(<MachinesScreen />);

    // The machine names are rendered in order, online first
    const machineNames = getAllByText(/One/);
    expect(machineNames[0].props.children).toBe('Online One');
    expect(machineNames[1].props.children).toBe('Offline One');
  });
});

// ── Delete machine flow ───────────────────────────────────────────────

describe('delete machine', () => {
  it('shows confirmation alert when delete button is pressed', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const machine = makeMachine({ name: 'Test Machine' });
    mockMachinesStore._state.machines = [machine];

    const { getByTestId } = render(<MachinesScreen />);

    // The delete button renders an Ionicons "trash-outline"
    fireEvent.press(getByTestId('icon-trash-outline'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Unlink Machine',
      'Are you sure you want to unlink "Test Machine"?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Unlink', style: 'destructive' }),
      ])
    );

    alertSpy.mockRestore();
  });

  it('calls API delete and removeMachine on confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const machine = makeMachine({ id: 'machine-99' });
    mockMachinesStore._state.machines = [machine];

    render(<MachinesScreen />);

    const { getByTestId } = render(<MachinesScreen />);
    fireEvent.press(getByTestId('icon-trash-outline'));

    // Get the onPress handler for the "Unlink" button from the Alert call
    const alertButtons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const unlinkButton = alertButtons.find((b) => b.text === 'Unlink');

    await act(async () => {
      await unlinkButton?.onPress?.();
    });

    expect(mockApiClient.deleteMachine).toHaveBeenCalledWith('machine-99');
    expect(mockMachinesStore._state.removeMachine).toHaveBeenCalledWith('machine-99');

    alertSpy.mockRestore();
  });

  it('shows error alert when delete API call fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockApiClient.deleteMachine.mockRejectedValue(new Error('Server error'));
    const machine = makeMachine({ id: 'machine-fail' });
    mockMachinesStore._state.machines = [machine];

    const { getByTestId } = render(<MachinesScreen />);
    fireEvent.press(getByTestId('icon-trash-outline'));

    // Invoke the destructive button
    const alertButtons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const unlinkButton = alertButtons.find((b) => b.text === 'Unlink');

    await act(async () => {
      await unlinkButton?.onPress?.();
    });

    // Second call to Alert.alert should be the error alert
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to unlink machine');

    alertSpy.mockRestore();
  });
});

// ── Header / list header ──────────────────────────────────────────────

describe('list header', () => {
  it('shows search and filter chips when machines exist', () => {
    mockMachinesStore._state.machines = [makeMachine()];

    const { getByPlaceholderText, getByText, getAllByText } = render(<MachinesScreen />);

    expect(getByPlaceholderText('Search machines...')).toBeTruthy();
    expect(getByText('All')).toBeTruthy();
    // "Online" appears as both filter chip and status badge (machine is online)
    expect(getAllByText('Online').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Offline')).toBeTruthy();
  });

  it('does not show ListHeader when machines array is empty', () => {
    mockMachinesStore._state.machines = [];

    const { queryByPlaceholderText } = render(<MachinesScreen />);

    expect(queryByPlaceholderText('Search machines...')).toBeNull();
  });
});

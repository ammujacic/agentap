/**
 * Tests for app/settings/sessions.tsx — Active auth sessions management screen
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const { mockApiClient } = require('../../setup');

import SessionsScreen from '../../../app/settings/sessions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = Math.floor(Date.now() / 1000);

const makeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  ipAddress: '192.168.1.100',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  city: 'San Francisco',
  region: 'CA',
  country: 'US',
  createdAt: now - 3600,
  updatedAt: now - 300,
  expiresAt: now + 86400,
  isCurrent: false,
  ...overrides,
});

const currentSession = makeSession({
  id: 'sess-current',
  isCurrent: true,
  userAgent: 'Expo/1.0 (iOS; iPhone)',
});

const otherSession = makeSession({
  id: 'sess-other',
  isCurrent: false,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  city: 'New York',
  region: 'NY',
});

const sessionsData = [currentSession, otherSession];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockApiClient.getSessions = jest.fn(() => Promise.resolve({ sessions: sessionsData }));
  mockApiClient.revokeSession = jest.fn(() => Promise.resolve({ success: true }));
  mockApiClient.revokeOtherSessions = jest.fn(() => Promise.resolve({ success: true }));
});

describe('SessionsScreen', () => {
  // -- Loading state -------------------------------------------------------

  it('shows loading indicator initially', () => {
    mockApiClient.getSessions.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<SessionsScreen />);
    expect(getByText('Loading sessions...')).toBeTruthy();
  });

  // -- Header --------------------------------------------------------------

  it('renders header title and description', async () => {
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText('Active Sessions')).toBeTruthy();
    expect(await findByText(/Manage devices where you are currently signed in/)).toBeTruthy();
  });

  // -- Session list --------------------------------------------------------

  it('renders session cards after loading', async () => {
    const { findByText } = render(<SessionsScreen />);
    // Current session is Expo on iOS -> "Agentap on iOS"
    expect(await findByText(/Agentap on iOS/)).toBeTruthy();
    // Other session is Chrome on Windows
    expect(await findByText(/Chrome on Windows/)).toBeTruthy();
  });

  it('shows "This device" badge for current session', async () => {
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText('This device')).toBeTruthy();
  });

  it('displays IP address for sessions', async () => {
    const { findAllByText } = render(<SessionsScreen />);
    const ipTexts = await findAllByText('192.168.1.100');
    expect(ipTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('displays location for sessions', async () => {
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText('San Francisco, CA')).toBeTruthy();
    expect(await findByText('New York, NY')).toBeTruthy();
  });

  it('displays created and last active times', async () => {
    const { findAllByText } = render(<SessionsScreen />);
    // The times are relative ("1h ago", "5m ago", etc.) via formatTimeAgo
    const createdTexts = await findAllByText(/Created/);
    expect(createdTexts.length).toBeGreaterThanOrEqual(1);
    const activeTexts = await findAllByText(/Active/);
    expect(activeTexts.length).toBeGreaterThanOrEqual(1);
  });

  // -- Revoke single session -----------------------------------------------

  it('does not show revoke button for current session', async () => {
    // Render with only the current session
    mockApiClient.getSessions.mockResolvedValue({ sessions: [currentSession] });
    const { findByText, queryByTestId } = render(<SessionsScreen />);
    await findByText('This device');
    // No revoke button should be rendered for current session
    // The revoke button renders an icon, not text — we check that "Sign Out All"
    // button is also not shown since there are no other sessions
    expect(queryByTestId('icon-log-out-outline')).toBeNull();
  });

  it('shows confirmation alert when revoking a session', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findAllByTestId } = render(<SessionsScreen />);

    // The revoke button for non-current session renders an icon.
    // Multiple elements share the same testID (per-session revoke + "Sign Out All" button),
    // so we use findAllByTestId and pick the first one (the per-session revoke icon).
    const revokeIcons = await findAllByTestId('icon-log-out-outline');
    fireEvent.press(revokeIcons[0]);

    expect(alertSpy).toHaveBeenCalledWith(
      'Revoke Session',
      expect.stringContaining('Chrome on Windows'),
      expect.any(Array)
    );
  });

  it('calls revokeSession API when confirmed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findAllByTestId } = render(<SessionsScreen />);

    const revokeIcons = await findAllByTestId('icon-log-out-outline');
    fireEvent.press(revokeIcons[0]);

    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const signOutAction = buttons.find((b) => b.text === 'Sign Out');

    await waitFor(async () => {
      await signOutAction?.onPress?.();
    });

    expect(mockApiClient.revokeSession).toHaveBeenCalledWith('sess-other');
  });

  it('shows error alert when revoke fails', async () => {
    mockApiClient.revokeSession.mockRejectedValue(new Error('Server error'));
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findAllByTestId } = render(<SessionsScreen />);

    const revokeIcons = await findAllByTestId('icon-log-out-outline');
    fireEvent.press(revokeIcons[0]);

    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const signOutAction = buttons.find((b) => b.text === 'Sign Out');

    await waitFor(async () => {
      await signOutAction?.onPress?.();
    });

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Server error');
  });

  // -- Revoke all ----------------------------------------------------------

  it('shows "Sign Out All Other Devices" button when other sessions exist', async () => {
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText('Sign Out All Other Devices')).toBeTruthy();
  });

  it('does not show revoke-all button when only current session exists', async () => {
    mockApiClient.getSessions.mockResolvedValue({ sessions: [currentSession] });
    const { findByText, queryByText } = render(<SessionsScreen />);
    await findByText('This device');
    expect(queryByText('Sign Out All Other Devices')).toBeNull();
  });

  it('shows confirmation alert when revoking all sessions', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findByText } = render(<SessionsScreen />);

    const revokeAllButton = await findByText('Sign Out All Other Devices');
    fireEvent.press(revokeAllButton);

    expect(alertSpy).toHaveBeenCalledWith(
      'Sign Out All Other Devices',
      expect.stringContaining('all sessions except this device'),
      expect.any(Array)
    );
  });

  it('calls revokeOtherSessions API when confirmed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findByText } = render(<SessionsScreen />);

    const revokeAllButton = await findByText('Sign Out All Other Devices');
    fireEvent.press(revokeAllButton);

    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const signOutAllAction = buttons.find((b) => b.text === 'Sign Out All');

    await waitFor(async () => {
      await signOutAllAction?.onPress?.();
    });

    expect(mockApiClient.revokeOtherSessions).toHaveBeenCalled();
  });

  // -- Error state ---------------------------------------------------------

  it('shows error state when API fails', async () => {
    mockApiClient.getSessions.mockRejectedValue(new Error('Network error'));
    const { findByText } = render(<SessionsScreen />);

    expect(await findByText('Something went wrong')).toBeTruthy();
    expect(await findByText('Network error')).toBeTruthy();
  });

  it('shows Try Again button in error state', async () => {
    mockApiClient.getSessions.mockRejectedValue(new Error('Network error'));
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText('Try Again')).toBeTruthy();
  });

  it('retries loading when Try Again is pressed', async () => {
    mockApiClient.getSessions
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ sessions: sessionsData });

    const { findByText } = render(<SessionsScreen />);
    const retryButton = await findByText('Try Again');
    fireEvent.press(retryButton);

    await waitFor(() => {
      expect(mockApiClient.getSessions).toHaveBeenCalledTimes(2);
    });
  });

  // -- User agent parsing --------------------------------------------------

  it('parses Firefox user agent correctly', async () => {
    mockApiClient.getSessions.mockResolvedValue({
      sessions: [
        makeSession({
          id: 'ff-sess',
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/120.0',
          isCurrent: false,
        }),
      ],
    });
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText(/Firefox on Linux/)).toBeTruthy();
  });

  it('parses null user agent as Unknown', async () => {
    mockApiClient.getSessions.mockResolvedValue({
      sessions: [
        makeSession({
          id: 'unknown-sess',
          userAgent: null,
          isCurrent: false,
        }),
      ],
    });
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText(/Unknown on Unknown/)).toBeTruthy();
  });

  // -- Location formatting -------------------------------------------------

  it('shows country when city and region are null', async () => {
    mockApiClient.getSessions.mockResolvedValue({
      sessions: [
        makeSession({
          id: 'country-sess',
          city: null,
          region: null,
          country: 'DE',
          isCurrent: false,
        }),
      ],
    });
    const { findByText } = render(<SessionsScreen />);
    expect(await findByText('DE')).toBeTruthy();
  });
});

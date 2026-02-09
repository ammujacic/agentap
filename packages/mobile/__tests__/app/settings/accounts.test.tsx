/**
 * Tests for app/settings/accounts.tsx — Connected accounts management screen
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const { mockApiClient } = require('../../setup');

import AccountsScreen from '../../../app/settings/accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const connectedAccounts = [
  { provider: 'github' as const, connected: true, accountId: 'gh-123', createdAt: 1700000000 },
  { provider: 'google' as const, connected: false, accountId: null, createdAt: null },
  { provider: 'apple' as const, connected: true, accountId: 'apple-456', createdAt: 1705000000 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockApiClient.getConnectedAccounts = jest.fn(() =>
    Promise.resolve({ accounts: connectedAccounts })
  );
  mockApiClient.disconnectAccount = jest.fn(() => Promise.resolve({ success: true }));
});

describe('AccountsScreen', () => {
  // -- Loading state -------------------------------------------------------

  it('shows loading indicator initially', () => {
    // Make the API call hang so we stay in loading state
    mockApiClient.getConnectedAccounts.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<AccountsScreen />);
    expect(getByText('Loading accounts...')).toBeTruthy();
  });

  // -- Loaded state --------------------------------------------------------

  it('renders the header with title and description', async () => {
    const { findByText } = render(<AccountsScreen />);
    expect(await findByText('Connected Accounts')).toBeTruthy();
    expect(await findByText(/Link third-party accounts for faster sign-in/)).toBeTruthy();
  });

  it('renders all three provider cards', async () => {
    const { findByText } = render(<AccountsScreen />);
    expect(await findByText('GitHub')).toBeTruthy();
    expect(await findByText('Google')).toBeTruthy();
    expect(await findByText('Apple')).toBeTruthy();
  });

  it('shows "Connected" for linked accounts', async () => {
    const { findAllByText } = render(<AccountsScreen />);
    const connectedTexts = await findAllByText(/Connected/);
    // GitHub and Apple are connected
    expect(connectedTexts.length).toBeGreaterThanOrEqual(2);
  });

  it('shows "Not connected" for unlinked accounts', async () => {
    const { findByText } = render(<AccountsScreen />);
    expect(await findByText('Not connected')).toBeTruthy();
  });

  it('shows Disconnect button for connected accounts', async () => {
    const { findAllByText } = render(<AccountsScreen />);
    const disconnectButtons = await findAllByText('Disconnect');
    expect(disconnectButtons.length).toBe(2); // GitHub and Apple
  });

  it('shows Connect button for unconnected accounts', async () => {
    const { findByText } = render(<AccountsScreen />);
    expect(await findByText('Connect')).toBeTruthy();
  });

  // -- Connect action ------------------------------------------------------

  it('opens browser for OAuth when Connect is pressed', async () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
    const { findByText } = render(<AccountsScreen />);

    const connectButton = await findByText('Connect');
    fireEvent.press(connectButton);

    expect(openURLSpy).toHaveBeenCalledWith(expect.stringContaining('/auth/sign-in/social'));
    openURLSpy.mockRestore();
  });

  // -- Disconnect action ---------------------------------------------------

  it('shows confirmation alert when Disconnect is pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findAllByText } = render(<AccountsScreen />);

    const disconnectButtons = await findAllByText('Disconnect');
    fireEvent.press(disconnectButtons[0]); // Disconnect GitHub

    expect(alertSpy).toHaveBeenCalledWith(
      'Disconnect Account',
      expect.stringContaining('GitHub'),
      expect.any(Array)
    );
  });

  it('calls API to disconnect account on confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findAllByText } = render(<AccountsScreen />);

    const disconnectButtons = await findAllByText('Disconnect');
    fireEvent.press(disconnectButtons[0]);

    // Simulate pressing "Disconnect" in the alert
    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const disconnectAction = buttons.find((b) => b.text === 'Disconnect');

    await waitFor(async () => {
      await disconnectAction?.onPress?.();
    });

    expect(mockApiClient.disconnectAccount).toHaveBeenCalledWith('github');
  });

  it('shows error alert when disconnect fails', async () => {
    mockApiClient.disconnectAccount.mockRejectedValue({ error: 'Cannot remove last auth method' });
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findAllByText } = render(<AccountsScreen />);

    const disconnectButtons = await findAllByText('Disconnect');
    fireEvent.press(disconnectButtons[0]);

    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const disconnectAction = buttons.find((b) => b.text === 'Disconnect');

    await waitFor(async () => {
      await disconnectAction?.onPress?.();
    });

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Cannot remove last auth method');
  });

  // -- Error state ---------------------------------------------------------

  it('shows error state when API fails and no accounts loaded', async () => {
    mockApiClient.getConnectedAccounts.mockRejectedValue(new Error('Network error'));
    const { findByText } = render(<AccountsScreen />);

    expect(await findByText('Something went wrong')).toBeTruthy();
    expect(await findByText('Network error')).toBeTruthy();
  });

  it('shows Try Again button in error state', async () => {
    mockApiClient.getConnectedAccounts.mockRejectedValue(new Error('Network error'));
    const { findByText } = render(<AccountsScreen />);

    expect(await findByText('Try Again')).toBeTruthy();
  });

  it('retries loading when Try Again is pressed', async () => {
    mockApiClient.getConnectedAccounts
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ accounts: connectedAccounts });

    const { findByText } = render(<AccountsScreen />);
    const retryButton = await findByText('Try Again');

    fireEvent.press(retryButton);

    await waitFor(() => {
      expect(mockApiClient.getConnectedAccounts).toHaveBeenCalledTimes(2);
    });
  });

  // -- Date formatting -----------------------------------------------------

  it('formats linked date for connected accounts', async () => {
    const { findAllByText } = render(<AccountsScreen />);
    // The formatDate function renders dates with the timestamp treated as seconds.
    // The "Connected" and " · <date>" are separate JSX children in the same <Text>,
    // so we match children that contain the middot separator.
    // Both GitHub and Apple are connected with dates, so we expect 2 matches.
    const connectedTexts = await findAllByText(/\u00b7/);
    expect(connectedTexts.length).toBe(2);
  });

  // -- Cancel in disconnect alert ------------------------------------------

  it('does not disconnect when Cancel is pressed in alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findAllByText } = render(<AccountsScreen />);

    const disconnectButtons = await findAllByText('Disconnect');
    fireEvent.press(disconnectButtons[0]);

    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const cancelAction = buttons.find((b) => b.text === 'Cancel');
    cancelAction?.onPress?.();

    expect(mockApiClient.disconnectAccount).not.toHaveBeenCalled();
  });
});

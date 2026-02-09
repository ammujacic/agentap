/**
 * Tests for app/settings/two-factor.tsx — Two-factor authentication management
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

const { mockAuthStore, mockApiClient } = require('../../setup');

// Mock storage
jest.mock('../../../utils/storage', () => ({
  storage: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    deleteItem: jest.fn(() => Promise.resolve()),
  },
}));

import TwoFactorScreen from '../../../app/settings/two-factor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSetUser = jest.fn();

function setupAuthState(twoFactorEnabled: boolean) {
  const user = {
    id: 'user-1',
    email: 'test@test.com',
    name: 'Test User',
    avatarUrl: null,
    twoFactorEnabled,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  // useAuthStore is called without a selector: const { user, setUser } = useAuthStore()
  mockAuthStore.mockImplementation((selector?: (state: any) => any) => {
    const state = {
      ...mockAuthStore._state,
      user,
      setUser: mockSetUser,
    };
    return selector ? selector(state) : state;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  setupAuthState(false);

  mockApiClient.getTotpUri = jest.fn(() =>
    Promise.resolve({
      totpURI: 'otpauth://totp/Agentap:test@test.com?secret=ABCDEFGH&issuer=Agentap',
      secret: 'ABCDEFGH',
    })
  );
  mockApiClient.enableTwoFactor = jest.fn(() =>
    Promise.resolve({
      status: true,
      backupCodes: ['code-1', 'code-2', 'code-3', 'code-4', 'code-5', 'code-6'],
    })
  );
  mockApiClient.disableTwoFactor = jest.fn(() => Promise.resolve({ status: true }));
  mockApiClient.viewBackupCodes = jest.fn(() =>
    Promise.resolve({
      backupCodes: ['backup-1', 'backup-2', 'backup-3', 'backup-4'],
    })
  );
});

describe('TwoFactorScreen', () => {
  // -- Idle state (2FA disabled) -------------------------------------------

  it('shows "Two-Factor Authentication" title when 2FA is disabled', () => {
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText('Two-Factor Authentication')).toBeTruthy();
  });

  it('shows Enable 2FA button when disabled', () => {
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText('Enable 2FA')).toBeTruthy();
  });

  it('shows descriptive text about adding extra security when disabled', () => {
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText(/Add an extra layer of security/)).toBeTruthy();
  });

  // -- Idle state (2FA enabled) --------------------------------------------

  it('shows enabled title when 2FA is on', () => {
    setupAuthState(true);
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText('Two-Factor Authentication Enabled')).toBeTruthy();
  });

  it('shows protected message when 2FA is on', () => {
    setupAuthState(true);
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText(/Your account is protected with an authenticator app/)).toBeTruthy();
  });

  it('shows View Backup Codes button when 2FA is enabled', () => {
    setupAuthState(true);
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText('View Backup Codes')).toBeTruthy();
  });

  it('shows Regenerate Backup Codes button when 2FA is enabled', () => {
    setupAuthState(true);
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText('Regenerate Backup Codes')).toBeTruthy();
  });

  it('shows Disable 2FA button when 2FA is enabled', () => {
    setupAuthState(true);
    const { getByText } = render(<TwoFactorScreen />);
    expect(getByText('Disable 2FA')).toBeTruthy();
  });

  // -- Enable flow: password step ------------------------------------------

  it('navigates to password step when Enable 2FA is pressed', () => {
    const { getByText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    expect(getByText('Confirm Password')).toBeTruthy();
    expect(getByText('Enter your password to continue.')).toBeTruthy();
  });

  it('shows Continue button in password step (enable flow)', () => {
    const { getByText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    expect(getByText('Continue')).toBeTruthy();
  });

  it('shows error when password is empty and Continue is pressed', async () => {
    const { getByText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.press(getByText('Continue'));
    expect(getByText('Please enter your password')).toBeTruthy();
  });

  it('calls getTotpUri and navigates to QR code step on valid password', async () => {
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));

    fireEvent.changeText(getByPlaceholderText('Password'), 'mypassword');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(mockApiClient.getTotpUri).toHaveBeenCalledWith('mypassword');
    });

    expect(getByText('Set Up Authenticator')).toBeTruthy();
  });

  it('shows error when getTotpUri fails', async () => {
    mockApiClient.getTotpUri.mockRejectedValue(new Error('Invalid password'));
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));

    fireEvent.changeText(getByPlaceholderText('Password'), 'wrong');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByText('Invalid password')).toBeTruthy();
    });
  });

  // -- Enable flow: QR code / secret step ----------------------------------

  it('displays the secret key on QR code step', async () => {
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByText('ABCDEFGH')).toBeTruthy();
    });

    expect(getByText('Secret Key')).toBeTruthy();
    expect(getByText('Verify & Enable')).toBeTruthy();
  });

  it('copies secret key to clipboard when pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByText('ABCDEFGH')).toBeTruthy();
    });

    fireEvent.press(getByText('ABCDEFGH'));

    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABCDEFGH');
    });
    expect(alertSpy).toHaveBeenCalledWith('Copied', 'Secret key copied to clipboard.');
  });

  it('shows error when verification code is empty', async () => {
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByText('Verify & Enable')).toBeTruthy();
    });

    fireEvent.press(getByText('Verify & Enable'));
    expect(getByText('Please enter the verification code')).toBeTruthy();
  });

  it('calls enableTwoFactor and shows backup codes on successful verify', async () => {
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByText('Verify & Enable')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');
    fireEvent.press(getByText('Verify & Enable'));

    await waitFor(() => {
      expect(mockApiClient.enableTwoFactor).toHaveBeenCalledWith('pass', '123456');
    });

    // Should show backup codes step
    expect(getByText('Backup Codes')).toBeTruthy();
    expect(getByText('code-1')).toBeTruthy();
    expect(getByText('code-6')).toBeTruthy();
  });

  it('shows error when verification fails', async () => {
    mockApiClient.enableTwoFactor.mockRejectedValue(new Error('Invalid code'));
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(getByText('Verify & Enable')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('000000'), '999999');
    fireEvent.press(getByText('Verify & Enable'));

    await waitFor(() => {
      expect(getByText('Invalid code')).toBeTruthy();
    });
  });

  // -- Backup codes step ---------------------------------------------------

  it('shows "Copy All Codes" button on backup codes step', async () => {
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => expect(getByText('Verify & Enable')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');
    fireEvent.press(getByText('Verify & Enable'));

    await waitFor(() => expect(getByText('Backup Codes')).toBeTruthy());

    expect(getByText('Copy All Codes')).toBeTruthy();
    expect(getByText('Done')).toBeTruthy();
  });

  it('copies all backup codes to clipboard', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => expect(getByText('Verify & Enable')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');
    fireEvent.press(getByText('Verify & Enable'));

    await waitFor(() => expect(getByText('Copy All Codes')).toBeTruthy());

    fireEvent.press(getByText('Copy All Codes'));

    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        'code-1\ncode-2\ncode-3\ncode-4\ncode-5\ncode-6'
      );
    });
    expect(alertSpy).toHaveBeenCalledWith('Copied', 'Backup codes copied to clipboard.');
  });

  it('returns to idle state when Done is pressed', async () => {
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => expect(getByText('Verify & Enable')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');
    fireEvent.press(getByText('Verify & Enable'));

    await waitFor(() => expect(getByText('Done')).toBeTruthy());

    fireEvent.press(getByText('Done'));
    // Should return to idle showing the enable state
    // Since enableTwoFactor updated the user, check the button states
    expect(getByText(/Two-Factor Authentication/)).toBeTruthy();
  });

  // -- Disable flow --------------------------------------------------------

  it('shows confirmation alert when Disable 2FA is pressed', () => {
    setupAuthState(true);
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(<TwoFactorScreen />);

    fireEvent.press(getByText('Disable 2FA'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Disable 2FA',
      expect.stringContaining('make your account less secure'),
      expect.any(Array)
    );
  });

  it('navigates to password step when disable is confirmed', async () => {
    setupAuthState(true);
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, findByText } = render(<TwoFactorScreen />);

    fireEvent.press(getByText('Disable 2FA'));

    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const disableAction = buttons.find((b) => b.text === 'Disable');
    disableAction?.onPress?.();

    expect(await findByText('Confirm Password')).toBeTruthy();
    // Should show Disable 2FA and View Codes buttons
    expect(getByText('Disable 2FA')).toBeTruthy();
    expect(getByText('View Codes')).toBeTruthy();
  });

  it('calls disableTwoFactor API when Disable 2FA is pressed in password step', async () => {
    setupAuthState(true);
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, getByPlaceholderText, findByPlaceholderText } = render(<TwoFactorScreen />);

    // Trigger the disable flow
    fireEvent.press(getByText('Disable 2FA'));
    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'Disable')?.onPress?.();

    // Wait for the password step to render after state update
    await findByPlaceholderText('Password');

    // Enter password and press Disable 2FA
    fireEvent.changeText(getByPlaceholderText('Password'), 'mypass');

    // The "Disable 2FA" text appears as button text in password step
    // We need to find the button specifically in the password step
    const disable2FAButtons = getByText('Disable 2FA');
    fireEvent.press(disable2FAButtons);

    await waitFor(() => {
      expect(mockApiClient.disableTwoFactor).toHaveBeenCalledWith('mypass');
    });
  });

  // -- View backup codes flow ----------------------------------------------

  it('navigates to password step when View Backup Codes is pressed', () => {
    setupAuthState(true);
    const { getByText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('View Backup Codes'));
    expect(getByText('Confirm Password')).toBeTruthy();
  });

  it('calls viewBackupCodes API and shows codes', async () => {
    setupAuthState(true);
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, getByPlaceholderText, findByPlaceholderText } = render(<TwoFactorScreen />);

    // Navigate to password step via Disable flow to get both buttons
    fireEvent.press(getByText('Disable 2FA'));
    const alertArgs = alertSpy.mock.calls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'Disable')?.onPress?.();

    // Wait for the password step to render after state update
    await findByPlaceholderText('Password');

    fireEvent.changeText(getByPlaceholderText('Password'), 'mypass');
    fireEvent.press(getByText('View Codes'));

    await waitFor(() => {
      expect(mockApiClient.viewBackupCodes).toHaveBeenCalledWith('mypass');
    });

    expect(getByText('Backup Codes')).toBeTruthy();
    expect(getByText('backup-1')).toBeTruthy();
    expect(getByText('backup-4')).toBeTruthy();
  });

  // -- Cancel button -------------------------------------------------------

  it('returns to idle when Cancel is pressed in password step', () => {
    const { getByText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    expect(getByText('Confirm Password')).toBeTruthy();

    fireEvent.press(getByText('Cancel'));
    expect(getByText('Two-Factor Authentication')).toBeTruthy();
  });

  it('returns to idle when Cancel is pressed in QR code step', async () => {
    const { getByText, getByPlaceholderText } = render(<TwoFactorScreen />);
    fireEvent.press(getByText('Enable 2FA'));
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => expect(getByText('Set Up Authenticator')).toBeTruthy());

    fireEvent.press(getByText('Cancel'));
    expect(getByText('Two-Factor Authentication')).toBeTruthy();
  });

  // -- Regenerate backup codes ---------------------------------------------

  it('shows confirmation alert when Regenerate Backup Codes is pressed', () => {
    setupAuthState(true);
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(<TwoFactorScreen />);

    fireEvent.press(getByText('Regenerate Backup Codes'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Regenerate Backup Codes',
      expect.stringContaining('invalidate all existing backup codes'),
      expect.any(Array)
    );
  });
});

/**
 * Tests for the Verify 2FA screen — app/(auth)/verify-2fa.tsx
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';

const { mockRouter } = require('../../setup');

// ── Mock useAuth from AuthProvider ──────────────────────────────────
const mockVerifyTotp = jest.fn();
const mockVerifyBackupCode = jest.fn();

jest.mock('../../../components/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

import Verify2FAScreen from '../../../app/(auth)/verify-2fa';
import { useAuth } from '../../../components/AuthProvider';

// ── Helpers ─────────────────────────────────────────────────────────
function setupAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    signIn: jest.fn(),
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signOut: jest.fn(),
    verifyTotp: mockVerifyTotp,
    verifyBackupCode: mockVerifyBackupCode,
    ...overrides,
  });
}

describe('Verify2FAScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAuth();
  });

  // ── Rendering (TOTP mode — default) ─────────────────────────────

  it('renders the title and TOTP subtitle', () => {
    const { getByText } = render(<Verify2FAScreen />);

    expect(getByText('Two-Factor Authentication')).toBeTruthy();
    expect(getByText('Enter the 6-digit code from your authenticator app')).toBeTruthy();
  });

  it('renders the TOTP code input with numeric placeholder', () => {
    const { getByPlaceholderText } = render(<Verify2FAScreen />);

    expect(getByPlaceholderText('000000')).toBeTruthy();
  });

  it('renders the Verify button', () => {
    const { getByText } = render(<Verify2FAScreen />);

    expect(getByText('Verify')).toBeTruthy();
  });

  it('renders the "Use a backup code instead" toggle link', () => {
    const { getByText } = render(<Verify2FAScreen />);

    expect(getByText('Use a backup code instead')).toBeTruthy();
  });

  it('TOTP input has number-pad keyboard type', () => {
    const { getByPlaceholderText } = render(<Verify2FAScreen />);
    const input = getByPlaceholderText('000000');

    expect(input.props.keyboardType).toBe('number-pad');
  });

  it('TOTP input has maxLength of 6', () => {
    const { getByPlaceholderText } = render(<Verify2FAScreen />);
    const input = getByPlaceholderText('000000');

    expect(input.props.maxLength).toBe(6);
  });

  // ── Validation (TOTP mode) ──────────────────────────────────────

  it('shows error when submitting with empty code in TOTP mode', async () => {
    const { getByText } = render(<Verify2FAScreen />);

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(getByText('Please enter the 6-digit code')).toBeTruthy();
    expect(mockVerifyTotp).not.toHaveBeenCalled();
  });

  it('shows error when submitting with whitespace-only code', async () => {
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    fireEvent.changeText(getByPlaceholderText('000000'), '   ');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(getByText('Please enter the 6-digit code')).toBeTruthy();
    expect(mockVerifyTotp).not.toHaveBeenCalled();
  });

  // ── Successful TOTP verification ────────────────────────────────

  it('calls verifyTotp with trimmed code on valid TOTP submission', async () => {
    mockVerifyTotp.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(mockVerifyTotp).toHaveBeenCalledWith('123456');
  });

  it('trims whitespace from TOTP code before verifying', async () => {
    mockVerifyTotp.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    fireEvent.changeText(getByPlaceholderText('000000'), ' 123456');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(mockVerifyTotp).toHaveBeenCalledWith('123456');
  });

  it('clears error before attempting TOTP verification', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(<Verify2FAScreen />);

    // First trigger validation error
    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });
    expect(getByText('Please enter the 6-digit code')).toBeTruthy();

    // Enter code and submit
    mockVerifyTotp.mockResolvedValueOnce(undefined);
    fireEvent.changeText(getByPlaceholderText('000000'), '123456');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(queryByText('Please enter the 6-digit code')).toBeNull();
  });

  // ── TOTP error handling ─────────────────────────────────────────

  it('shows error message from API Error instance on TOTP failure', async () => {
    mockVerifyTotp.mockRejectedValueOnce(new Error('Invalid code'));
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    fireEvent.changeText(getByPlaceholderText('000000'), '999999');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(getByText('Invalid code')).toBeTruthy();
  });

  it('shows generic error for non-Error thrown values on TOTP failure', async () => {
    mockVerifyTotp.mockRejectedValueOnce('unexpected');
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    fireEvent.changeText(getByPlaceholderText('000000'), '999999');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(getByText('Verification failed')).toBeTruthy();
  });

  it('clears code field after a failed TOTP verification', async () => {
    mockVerifyTotp.mockRejectedValueOnce(new Error('Invalid code'));
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    const codeInput = getByPlaceholderText('000000');
    fireEvent.changeText(codeInput, '999999');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(codeInput.props.value).toBe('');
  });

  // ── Toggle to Backup Code mode ──────────────────────────────────

  it('switches to backup code mode when toggle is pressed', async () => {
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    expect(getByText('Enter one of your backup codes')).toBeTruthy();
    expect(getByPlaceholderText('Backup code')).toBeTruthy();
    expect(getByText('Use authenticator app instead')).toBeTruthy();
  });

  it('clears code and error when toggling to backup code mode', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(<Verify2FAScreen />);

    // Enter a TOTP code and trigger error
    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });
    expect(getByText('Please enter the 6-digit code')).toBeTruthy();

    // Toggle to backup code mode
    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    // Error and code should be cleared
    expect(queryByText('Please enter the 6-digit code')).toBeNull();
    expect(getByPlaceholderText('Backup code').props.value).toBe('');
  });

  it('backup code input has default keyboard type', () => {
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    fireEvent.press(getByText('Use a backup code instead'));

    const input = getByPlaceholderText('Backup code');
    expect(input.props.keyboardType).toBe('default');
  });

  it('backup code input has maxLength of 20', () => {
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    fireEvent.press(getByText('Use a backup code instead'));

    const input = getByPlaceholderText('Backup code');
    expect(input.props.maxLength).toBe(20);
  });

  // ── Validation (Backup Code mode) ───────────────────────────────

  it('shows backup code error when submitting empty in backup mode', async () => {
    const { getByText } = render(<Verify2FAScreen />);

    // Toggle to backup mode
    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(getByText('Please enter a backup code')).toBeTruthy();
    expect(mockVerifyBackupCode).not.toHaveBeenCalled();
  });

  // ── Successful Backup Code verification ─────────────────────────

  it('calls verifyBackupCode with trimmed code on backup code submission', async () => {
    mockVerifyBackupCode.mockResolvedValueOnce(undefined);
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    // Toggle to backup mode
    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    fireEvent.changeText(getByPlaceholderText('Backup code'), 'ABCD-1234-EFGH');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(mockVerifyBackupCode).toHaveBeenCalledWith('ABCD-1234-EFGH');
    expect(mockVerifyTotp).not.toHaveBeenCalled();
  });

  // ── Backup Code error handling ──────────────────────────────────

  it('shows error message from API on backup code failure', async () => {
    mockVerifyBackupCode.mockRejectedValueOnce(new Error('Invalid backup code'));
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    // Toggle to backup mode
    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    fireEvent.changeText(getByPlaceholderText('Backup code'), 'WRONG-CODE');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(getByText('Invalid backup code')).toBeTruthy();
  });

  it('shows generic error for non-Error thrown values on backup code failure', async () => {
    mockVerifyBackupCode.mockRejectedValueOnce(42);
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    fireEvent.changeText(getByPlaceholderText('Backup code'), 'SOME-CODE');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(getByText('Verification failed')).toBeTruthy();
  });

  it('clears code field after a failed backup code verification', async () => {
    mockVerifyBackupCode.mockRejectedValueOnce(new Error('Invalid'));
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    const input = getByPlaceholderText('Backup code');
    fireEvent.changeText(input, 'BAD-CODE');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(input.props.value).toBe('');
  });

  // ── Toggle back to TOTP mode ────────────────────────────────────

  it('switches back to TOTP mode when toggle is pressed again', async () => {
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    // Toggle to backup mode
    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });
    expect(getByPlaceholderText('Backup code')).toBeTruthy();

    // Toggle back to TOTP mode
    await act(async () => {
      fireEvent.press(getByText('Use authenticator app instead'));
    });
    expect(getByPlaceholderText('000000')).toBeTruthy();
    expect(getByText('Enter the 6-digit code from your authenticator app')).toBeTruthy();
    expect(getByText('Use a backup code instead')).toBeTruthy();
  });

  it('clears code and error when toggling back to TOTP mode', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<Verify2FAScreen />);

    // Toggle to backup mode
    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    // Trigger backup validation error
    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });
    expect(getByText('Please enter a backup code')).toBeTruthy();

    // Toggle back to TOTP mode
    await act(async () => {
      fireEvent.press(getByText('Use authenticator app instead'));
    });

    expect(queryByText('Please enter a backup code')).toBeNull();
    expect(getByPlaceholderText('000000').props.value).toBe('');
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows ActivityIndicator while loading (TOTP)', async () => {
    let resolveVerify!: () => void;
    mockVerifyTotp.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveVerify = resolve;
      })
    );

    const { getByPlaceholderText, getByText, queryByText, UNSAFE_queryByType } = render(
      <Verify2FAScreen />
    );

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    // Should show ActivityIndicator, not "Verify" text
    expect(UNSAFE_queryByType(ActivityIndicator)).toBeTruthy();
    expect(queryByText('Verify')).toBeNull();

    await act(async () => {
      resolveVerify();
    });
  });

  it('disables verify button while loading', async () => {
    let resolveVerify!: () => void;
    mockVerifyTotp.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveVerify = resolve;
      })
    );

    const { getByPlaceholderText, getByText, queryByText, UNSAFE_queryByType } = render(
      <Verify2FAScreen />
    );

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    // Loading state is active — spinner is shown and "Verify" text is gone
    expect(UNSAFE_queryByType(ActivityIndicator)).toBeTruthy();
    expect(queryByText('Verify')).toBeNull();

    // The button is disabled during loading, so the mock should only have been called once
    expect(mockVerifyTotp).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveVerify();
    });
  });

  it('restores Verify button text after loading finishes', async () => {
    mockVerifyTotp.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    fireEvent.changeText(getByPlaceholderText('000000'), '123456');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    await waitFor(() => {
      expect(getByText('Verify')).toBeTruthy();
    });
  });

  it('restores Verify button text after a failed verification', async () => {
    mockVerifyTotp.mockRejectedValueOnce(new Error('Bad code'));
    const { getByPlaceholderText, getByText } = render(<Verify2FAScreen />);

    fireEvent.changeText(getByPlaceholderText('000000'), '999999');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    await waitFor(() => {
      expect(getByText('Verify')).toBeTruthy();
    });
  });

  it('shows ActivityIndicator while loading in backup code mode', async () => {
    let resolveVerify!: () => void;
    mockVerifyBackupCode.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveVerify = resolve;
      })
    );

    const { getByText, getByPlaceholderText, queryByText, UNSAFE_queryByType } = render(
      <Verify2FAScreen />
    );

    // Toggle to backup mode
    await act(async () => {
      fireEvent.press(getByText('Use a backup code instead'));
    });

    fireEvent.changeText(getByPlaceholderText('Backup code'), 'ABCD-1234');

    await act(async () => {
      fireEvent.press(getByText('Verify'));
    });

    expect(UNSAFE_queryByType(ActivityIndicator)).toBeTruthy();
    expect(queryByText('Verify')).toBeNull();

    await act(async () => {
      resolveVerify();
    });
  });

  // ── Input behavior ──────────────────────────────────────────────

  it('updates code state when typing in TOTP mode', () => {
    const { getByPlaceholderText } = render(<Verify2FAScreen />);
    const input = getByPlaceholderText('000000');

    fireEvent.changeText(input, '654321');

    expect(input.props.value).toBe('654321');
  });

  it('updates code state when typing in backup code mode', () => {
    const { getByText, getByPlaceholderText } = render(<Verify2FAScreen />);

    fireEvent.press(getByText('Use a backup code instead'));
    const input = getByPlaceholderText('Backup code');

    fireEvent.changeText(input, 'MY-BACKUP-CODE');

    expect(input.props.value).toBe('MY-BACKUP-CODE');
  });

  it('TOTP input has centered text alignment', () => {
    const { getByPlaceholderText } = render(<Verify2FAScreen />);
    const input = getByPlaceholderText('000000');

    expect(input.props.textAlign).toBe('center');
  });

  it('code input has autoFocus enabled', () => {
    const { getByPlaceholderText } = render(<Verify2FAScreen />);
    const input = getByPlaceholderText('000000');

    expect(input.props.autoFocus).toBe(true);
  });
});

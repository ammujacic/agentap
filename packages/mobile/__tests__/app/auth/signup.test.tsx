/**
 * Tests for the Signup screen — app/(auth)/signup.tsx
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const { mockRouter } = require('../../setup');

// ── Mock useAuth from AuthProvider ──────────────────────────────────
const mockSignUpWithEmail = jest.fn();

jest.mock('../../../components/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

import SignupScreen from '../../../app/(auth)/signup';
import { useAuth } from '../../../components/AuthProvider';

// ── Helpers ─────────────────────────────────────────────────────────
function setupAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    signIn: jest.fn(),
    signInWithEmail: jest.fn(),
    signUpWithEmail: mockSignUpWithEmail,
    signOut: jest.fn(),
    verifyTotp: jest.fn(),
    verifyBackupCode: jest.fn(),
    ...overrides,
  });
}

describe('SignupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAuth();
  });

  // ── Rendering ───────────────────────────────────────────────────

  it('renders name, email, and password inputs', () => {
    const { getByPlaceholderText } = render(<SignupScreen />);

    expect(getByPlaceholderText('Name')).toBeTruthy();
    expect(getByPlaceholderText('Email')).toBeTruthy();
    expect(getByPlaceholderText('Password (min 8 characters)')).toBeTruthy();
  });

  it('renders the "Create account" button', () => {
    const { getByText } = render(<SignupScreen />);

    expect(getByText('Create account')).toBeTruthy();
  });

  it('renders the header text', () => {
    const { getByText } = render(<SignupScreen />);

    expect(getByText('Get started for free')).toBeTruthy();
    expect(getByText('No credit card required')).toBeTruthy();
  });

  it('renders the sign-in navigation link', () => {
    const { getByText } = render(<SignupScreen />);

    expect(getByText(/Already have an account/)).toBeTruthy();
    expect(getByText('Sign in')).toBeTruthy();
  });

  it('renders terms of service and privacy policy text', () => {
    const { getByText } = render(<SignupScreen />);

    expect(getByText(/Terms of Service/)).toBeTruthy();
    expect(getByText(/Privacy Policy/)).toBeTruthy();
  });

  // ── Validation: empty fields ────────────────────────────────────

  it('shows error when submitting with all fields empty', async () => {
    const { getByText } = render(<SignupScreen />);

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Please fill in all fields')).toBeTruthy();
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });

  it('shows error when name is empty', async () => {
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Please fill in all fields')).toBeTruthy();
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });

  it('shows error when email is empty', async () => {
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Please fill in all fields')).toBeTruthy();
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });

  it('shows error when password is empty', async () => {
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Please fill in all fields')).toBeTruthy();
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });

  // ── Validation: short password ──────────────────────────────────

  it('shows error when password is shorter than 8 characters', async () => {
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'short');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });

  it('shows error when password is exactly 7 characters', async () => {
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), '1234567');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });

  it('does not show password length error when password is exactly 8 characters', async () => {
    mockSignUpWithEmail.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText, queryByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), '12345678');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(queryByText('Password must be at least 8 characters')).toBeNull();
    expect(mockSignUpWithEmail).toHaveBeenCalled();
  });

  // ── Successful sign-up ──────────────────────────────────────────

  it('calls signUpWithEmail with email, password, and name on valid form', async () => {
    mockSignUpWithEmail.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(mockSignUpWithEmail).toHaveBeenCalledWith('user@test.com', 'password123', 'Test User');
  });

  it('clears previous error before attempting sign-up', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(<SignupScreen />);

    // First trigger validation error
    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });
    expect(getByText('Please fill in all fields')).toBeTruthy();

    // Fill all fields and try again
    mockSignUpWithEmail.mockResolvedValueOnce(undefined);
    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(queryByText('Please fill in all fields')).toBeNull();
  });

  // ── API error handling ──────────────────────────────────────────

  it('shows error message from API Error instance', async () => {
    mockSignUpWithEmail.mockRejectedValueOnce(new Error('Email already in use'));
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'existing@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Email already in use')).toBeTruthy();
  });

  it('shows generic error for non-Error thrown values', async () => {
    mockSignUpWithEmail.mockRejectedValueOnce('unexpected');
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Sign up failed')).toBeTruthy();
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows "Creating account..." text while loading', async () => {
    let resolveSignUp!: () => void;
    mockSignUpWithEmail.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSignUp = resolve;
      })
    );

    const { getByPlaceholderText, getByText, queryByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    expect(getByText('Creating account...')).toBeTruthy();
    expect(queryByText('Create account')).toBeNull();

    await act(async () => {
      resolveSignUp();
    });
  });

  it('disables the submit button while loading', async () => {
    let resolveSignUp!: () => void;
    mockSignUpWithEmail.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSignUp = resolve;
      })
    );

    const { getByPlaceholderText, getByText, queryByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    // Loading state is active — button shows loading text and original text is gone
    expect(getByText('Creating account...')).toBeTruthy();
    expect(queryByText('Create account')).toBeNull();

    // Pressing again during loading should not trigger another API call
    await act(async () => {
      fireEvent.press(getByText('Creating account...'));
    });
    expect(mockSignUpWithEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignUp();
    });
  });

  it('restores button text after loading finishes', async () => {
    mockSignUpWithEmail.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    await waitFor(() => {
      expect(getByText('Create account')).toBeTruthy();
    });
  });

  it('restores button text after a failed sign-up', async () => {
    mockSignUpWithEmail.mockRejectedValueOnce(new Error('Server error'));
    const { getByPlaceholderText, getByText } = render(<SignupScreen />);

    fireEvent.changeText(getByPlaceholderText('Name'), 'Test User');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password (min 8 characters)'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Create account'));
    });

    await waitFor(() => {
      expect(getByText('Create account')).toBeTruthy();
    });
  });

  // ── Input behavior ──────────────────────────────────────────────

  it('updates name state when typing', () => {
    const { getByPlaceholderText } = render(<SignupScreen />);
    const nameInput = getByPlaceholderText('Name');

    fireEvent.changeText(nameInput, 'Jane Doe');

    expect(nameInput.props.value).toBe('Jane Doe');
  });

  it('updates email state when typing', () => {
    const { getByPlaceholderText } = render(<SignupScreen />);
    const emailInput = getByPlaceholderText('Email');

    fireEvent.changeText(emailInput, 'jane@example.com');

    expect(emailInput.props.value).toBe('jane@example.com');
  });

  it('updates password state when typing', () => {
    const { getByPlaceholderText } = render(<SignupScreen />);
    const passwordInput = getByPlaceholderText('Password (min 8 characters)');

    fireEvent.changeText(passwordInput, 'mysecret');

    expect(passwordInput.props.value).toBe('mysecret');
  });

  it('password input has secureTextEntry enabled', () => {
    const { getByPlaceholderText } = render(<SignupScreen />);
    const passwordInput = getByPlaceholderText('Password (min 8 characters)');

    expect(passwordInput.props.secureTextEntry).toBe(true);
  });

  it('email input has email keyboard type', () => {
    const { getByPlaceholderText } = render(<SignupScreen />);
    const emailInput = getByPlaceholderText('Email');

    expect(emailInput.props.keyboardType).toBe('email-address');
  });

  it('name input has autoCapitalize set to words', () => {
    const { getByPlaceholderText } = render(<SignupScreen />);
    const nameInput = getByPlaceholderText('Name');

    expect(nameInput.props.autoCapitalize).toBe('words');
  });

  // ── Navigation ──────────────────────────────────────────────────

  it('renders sign-in link pointing to /(auth)/login', () => {
    const { getByText } = render(<SignupScreen />);
    const signInLink = getByText('Sign in');

    expect(signInLink.props.href).toBe('/(auth)/login');
  });
});

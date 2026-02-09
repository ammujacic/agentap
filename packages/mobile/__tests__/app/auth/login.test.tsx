/**
 * Tests for the Login screen — app/(auth)/login.tsx
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const { mockRouter } = require('../../setup');

// ── Mock useAuth from AuthProvider ──────────────────────────────────
const mockSignIn = jest.fn();
const mockSignInWithEmail = jest.fn();

jest.mock('../../../components/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

import LoginScreen from '../../../app/(auth)/login';
import { useAuth } from '../../../components/AuthProvider';

// ── Helpers ─────────────────────────────────────────────────────────
function setupAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    signIn: mockSignIn,
    signInWithEmail: mockSignInWithEmail,
    signUpWithEmail: jest.fn(),
    signOut: jest.fn(),
    verifyTotp: jest.fn(),
    verifyBackupCode: jest.fn(),
    ...overrides,
  });
}

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAuth();
  });

  // ── Rendering ───────────────────────────────────────────────────

  it('renders email and password inputs', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);

    expect(getByPlaceholderText('Email')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
  });

  it('renders the sign-in button with default text', () => {
    const { getByText } = render(<LoginScreen />);

    expect(getByText('Sign in')).toBeTruthy();
  });

  it('renders the logo text and tagline', () => {
    const { getByText } = render(<LoginScreen />);

    expect(getByText('agentap')).toBeTruthy();
    expect(getByText(/Control your coding agents/)).toBeTruthy();
  });

  it('renders OAuth buttons for GitHub, Google, and Apple', () => {
    const { getByText } = render(<LoginScreen />);

    expect(getByText('Continue with GitHub')).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
    expect(getByText('Continue with Apple')).toBeTruthy();
  });

  it('renders the "or continue with" divider', () => {
    const { getByText } = render(<LoginScreen />);

    expect(getByText('or continue with')).toBeTruthy();
  });

  it('renders the sign-up navigation link', () => {
    const { getByText } = render(<LoginScreen />);

    expect(getByText(/Don't have an account/)).toBeTruthy();
    expect(getByText('Sign up')).toBeTruthy();
  });

  it('renders terms of service and privacy policy text', () => {
    const { getByText } = render(<LoginScreen />);

    expect(getByText(/Terms of Service/)).toBeTruthy();
    expect(getByText(/Privacy Policy/)).toBeTruthy();
  });

  // ── Validation ──────────────────────────────────────────────────

  it('shows error when submitting with empty email and password', async () => {
    const { getByText } = render(<LoginScreen />);

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(getByText('Please enter email and password')).toBeTruthy();
    expect(mockSignInWithEmail).not.toHaveBeenCalled();
  });

  it('shows error when email is filled but password is empty', async () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(getByText('Please enter email and password')).toBeTruthy();
    expect(mockSignInWithEmail).not.toHaveBeenCalled();
  });

  it('shows error when password is filled but email is empty', async () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(getByText('Please enter email and password')).toBeTruthy();
    expect(mockSignInWithEmail).not.toHaveBeenCalled();
  });

  // ── Successful sign-in ──────────────────────────────────────────

  it('calls signInWithEmail with email and password on valid submission', async () => {
    mockSignInWithEmail.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(mockSignInWithEmail).toHaveBeenCalledWith('user@test.com', 'password123');
  });

  it('clears previous error before attempting sign-in', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(<LoginScreen />);

    // First trigger a validation error
    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });
    expect(getByText('Please enter email and password')).toBeTruthy();

    // Now fill in fields and submit again
    mockSignInWithEmail.mockResolvedValueOnce(undefined);
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(queryByText('Please enter email and password')).toBeNull();
  });

  // ── API error handling ──────────────────────────────────────────

  it('shows error message from API Error instance', async () => {
    mockSignInWithEmail.mockRejectedValueOnce(new Error('Account locked'));
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'wrong');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(getByText('Account locked')).toBeTruthy();
  });

  it('shows generic error for non-Error thrown values', async () => {
    mockSignInWithEmail.mockRejectedValueOnce('unexpected');
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'wrong');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(getByText('Invalid email or password')).toBeTruthy();
  });

  it('clears password field after a failed sign-in attempt', async () => {
    mockSignInWithEmail.mockRejectedValueOnce(new Error('Bad password'));
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    const passwordInput = getByPlaceholderText('Password');
    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(passwordInput, 'wrong');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    expect(passwordInput.props.value).toBe('');
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows "Signing in..." text while loading', async () => {
    // Make signInWithEmail hang so loading state persists
    let resolveSignIn!: () => void;
    mockSignInWithEmail.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSignIn = resolve;
      })
    );

    const { getByPlaceholderText, getByText, queryByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    // While loading
    expect(getByText('Signing in...')).toBeTruthy();
    expect(queryByText('Sign in')).toBeNull();

    // Resolve to clean up
    await act(async () => {
      resolveSignIn();
    });
  });

  it('disables the sign-in button while loading', async () => {
    let resolveSignIn!: () => void;
    mockSignInWithEmail.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSignIn = resolve;
      })
    );

    const { getByPlaceholderText, getByText, queryByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    // Loading state is active — button shows loading text and original text is gone
    expect(getByText('Signing in...')).toBeTruthy();
    expect(queryByText('Sign in')).toBeNull();

    // Pressing again during loading should not trigger another API call
    await act(async () => {
      fireEvent.press(getByText('Signing in...'));
    });
    expect(mockSignInWithEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignIn();
    });
  });

  it('restores sign-in button text after loading finishes', async () => {
    mockSignInWithEmail.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'user@test.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(getByText('Sign in')).toBeTruthy();
    });
  });

  // ── OAuth buttons ───────────────────────────────────────────────

  it('calls signIn with "github" when GitHub button is pressed', async () => {
    const { getByText } = render(<LoginScreen />);

    await act(async () => {
      fireEvent.press(getByText('Continue with GitHub'));
    });

    expect(mockSignIn).toHaveBeenCalledWith('github');
  });

  it('calls signIn with "google" when Google button is pressed', async () => {
    const { getByText } = render(<LoginScreen />);

    await act(async () => {
      fireEvent.press(getByText('Continue with Google'));
    });

    expect(mockSignIn).toHaveBeenCalledWith('google');
  });

  it('calls signIn with "apple" when Apple button is pressed', async () => {
    const { getByText } = render(<LoginScreen />);

    await act(async () => {
      fireEvent.press(getByText('Continue with Apple'));
    });

    expect(mockSignIn).toHaveBeenCalledWith('apple');
  });

  // ── Input behavior ──────────────────────────────────────────────

  it('updates email state when typing in email input', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);
    const emailInput = getByPlaceholderText('Email');

    fireEvent.changeText(emailInput, 'hello@world.com');

    expect(emailInput.props.value).toBe('hello@world.com');
  });

  it('updates password state when typing in password input', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);
    const passwordInput = getByPlaceholderText('Password');

    fireEvent.changeText(passwordInput, 'secret');

    expect(passwordInput.props.value).toBe('secret');
  });

  it('password input has secureTextEntry enabled', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);
    const passwordInput = getByPlaceholderText('Password');

    expect(passwordInput.props.secureTextEntry).toBe(true);
  });

  it('email input has email keyboard type', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);
    const emailInput = getByPlaceholderText('Email');

    expect(emailInput.props.keyboardType).toBe('email-address');
  });

  it('email input has autoCapitalize set to none', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);
    const emailInput = getByPlaceholderText('Email');

    expect(emailInput.props.autoCapitalize).toBe('none');
  });

  // ── Navigation ──────────────────────────────────────────────────

  it('renders sign-up link pointing to /(auth)/signup', () => {
    const { getByText } = render(<LoginScreen />);
    const signUpLink = getByText('Sign up');

    // The Link component in setup is rendered as a Text with href prop
    expect(signUpLink.props.href).toBe('/(auth)/signup');
  });
});

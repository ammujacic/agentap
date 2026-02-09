'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell,
  User,
  Shield,
  Trash2,
  Github,
  Monitor,
  Smartphone,
  LogOut,
  Link2,
  CheckCircle,
  XCircle,
  ShieldCheck,
  ShieldOff,
  Copy,
  Check,
  Download,
  Eye,
  RefreshCw,
  X,
  KeyRound,
  Loader2,
  Pencil,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { apiFetch } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

interface UserData {
  id: string;
  email: string;
  name: string | null;
  twoFactorEnabled?: boolean;
}

interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  expiresAt: number;
  isCurrent: boolean;
}

interface AccountInfo {
  provider: string;
  connected: boolean;
  accountId: string | null;
  createdAt: number | null;
}

// ============================================================================
// Utility functions
// ============================================================================

function parseUserAgent(ua: string | null): {
  device: string;
  type: 'web' | 'mobile';
} {
  if (!ua) return { device: 'Unknown device', type: 'web' };

  // React Native / Expo (mobile app)
  if (ua.includes('Expo') || ua.includes('ExpoClient') || ua.includes('ExponentConstants')) {
    const os =
      ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')
        ? 'iOS'
        : ua.includes('Android')
          ? 'Android'
          : 'Mobile';
    return { device: `Agentap on ${os}`, type: 'mobile' };
  }

  // curl (seed scripts, API calls)
  if (ua.startsWith('curl/')) {
    return { device: 'API (CLI)', type: 'web' };
  }

  let browser = 'Unknown Browser';
  let os = 'Unknown';
  let type: 'web' | 'mobile' = 'web';

  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Edg/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';

  if (ua.includes('iPhone')) {
    os = 'iPhone';
    type = 'mobile';
  } else if (ua.includes('iPad')) {
    os = 'iPad';
    type = 'mobile';
  } else if (ua.includes('Android')) {
    os = 'Android';
    type = 'mobile';
  } else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) {
    os = 'macOS';
  } else if (ua.includes('Windows')) {
    os = 'Windows';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
  }

  return { device: `${browser} on ${os}`, type };
}

function formatRelativeTime(timestampSeconds: number | null): string {
  if (!timestampSeconds) return 'Unknown';
  const now = Date.now();
  const diff = now - timestampSeconds * 1000;

  if (diff < 60_000) return 'Now';
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60_000);
    return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  }
  if (diff < 86_400_000) {
    const hrs = Math.floor(diff / 3_600_000);
    return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  }
  const days = Math.floor(diff / 86_400_000);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function formatLocation(
  city: string | null,
  region: string | null,
  country: string | null
): string {
  if (!city && !country) return '\u2014';
  if (city && region) return `${city}, ${region}`;
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  return country || '\u2014';
}

function formatDate(timestampSeconds: number | null): string {
  if (!timestampSeconds) return '\u2014';
  return new Date(timestampSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0].toUpperCase();
}

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
  apple: 'Apple',
};

// ============================================================================
// Shared components
// ============================================================================

function PasswordPrompt({
  onSubmit,
  onCancel,
  loading,
  error,
}: {
  onSubmit: (password: string) => void;
  onCancel: () => void;
  loading: boolean;
  error: string;
}) {
  const [password, setPassword] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-2xl border border-white/10 p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Confirm Password</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-4">Enter your password to continue</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(password);
          }}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className="w-full rounded-xl bg-gray-800 border border-white/10 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-3"
            placeholder="Your password"
          />
          {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-400 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-400 transition-colors disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// Two-Factor Authentication Section
// ============================================================================

function TwoFactorSection({ initialEnabled }: { initialEnabled: boolean }) {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(initialEnabled);
  const [setupStep, setSetupStep] = useState<
    'idle' | 'password' | 'qr' | 'verify' | 'backup' | 'done'
  >('idle');
  const [totpUri, setTotpUri] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [passwordAction, setPasswordAction] = useState<
    'enable' | 'disable' | 'view-codes' | 'regen-codes' | null
  >(null);

  useEffect(() => {
    setTwoFactorEnabled(initialEnabled);
  }, [initialEnabled]);

  const handlePasswordSubmit = async (password: string) => {
    setLoading(true);
    setError('');

    try {
      if (passwordAction === 'enable') {
        const res = await apiFetch('/auth/two-factor/get-totp-uri', {
          method: 'POST',
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to get TOTP URI');
        setTotpUri(data.totpURI);
        setTotpSecret(data.secret);
        setPasswordAction(null);
        setSetupStep('qr');
      } else if (passwordAction === 'disable') {
        const res = await apiFetch('/auth/two-factor/disable', {
          method: 'POST',
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to disable 2FA');
        setTwoFactorEnabled(false);
        setPasswordAction(null);
      } else if (passwordAction === 'view-codes') {
        const res = await apiFetch('/auth/two-factor/view-backup-codes', {
          method: 'POST',
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to view backup codes');
        setBackupCodes(data.backupCodes);
        setPasswordAction(null);
        setSetupStep('backup');
      } else if (passwordAction === 'regen-codes') {
        const res = await apiFetch('/auth/two-factor/generate-backup-codes', {
          method: 'POST',
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to generate backup codes');
        setBackupCodes(data.backupCodes);
        setPasswordAction(null);
        setSetupStep('backup');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await apiFetch('/auth/two-factor/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ code: verifyCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Invalid code');

      setTwoFactorEnabled(true);
      if (data.backupCodes) {
        setBackupCodes(data.backupCodes);
      }
      setSetupStep('backup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n')).catch(() => {
      setError('Failed to copy to clipboard');
    });
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const downloadBackupCodes = () => {
    const content = `Agentap Backup Codes\n${'='.repeat(30)}\n\nStore these codes in a safe place.\nEach code can only be used once.\n\n${backupCodes.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agentap-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {passwordAction && (
        <PasswordPrompt
          onSubmit={handlePasswordSubmit}
          onCancel={() => {
            setPasswordAction(null);
            setError('');
          }}
          loading={loading}
          error={error}
        />
      )}

      <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-white">Two-Factor Authentication</h2>
          </div>
          {twoFactorEnabled && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full">
              <ShieldCheck className="h-3.5 w-3.5" />
              Enabled
            </span>
          )}
        </div>

        {setupStep === 'idle' && !twoFactorEnabled && (
          <div>
            <p className="text-sm text-gray-400 mb-4">
              Add an extra layer of security to your account by requiring a code from your
              authenticator app when signing in.
            </p>
            <button
              onClick={() => {
                setPasswordAction('enable');
                setError('');
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-400 transition-colors"
            >
              <Shield className="h-4 w-4" />
              Enable Two-Factor Authentication
            </button>
          </div>
        )}

        {setupStep === 'qr' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password,
              etc.):
            </p>
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-xl">
                <QRCodeSVG value={totpUri} size={200} />
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Or enter this key manually:</p>
              <code className="block text-sm text-blue-400 font-mono bg-gray-800 rounded-xl px-4 py-3 break-all border border-white/5">
                {totpSecret}
              </code>
            </div>
            <div className="pt-2">
              <p className="text-sm text-gray-400 mb-2">
                Enter the 6-digit code from your app to verify:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  maxLength={6}
                  inputMode="numeric"
                  autoFocus
                  className="flex-1 rounded-xl bg-gray-800 border border-white/10 px-4 py-3 text-center text-lg font-mono tracking-[0.3em] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="000000"
                />
                <button
                  onClick={handleVerifyCode}
                  disabled={loading || verifyCode.length !== 6}
                  className="px-6 py-3 text-sm font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-400 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
              </div>
              {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
            </div>
            <button
              onClick={() => {
                setSetupStep('idle');
                setError('');
              }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel setup
            </button>
          </div>
        )}

        {setupStep === 'backup' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-5 w-5 text-green-400" />
              <p className="text-sm font-medium text-green-400">
                {twoFactorEnabled ? 'Your backup codes' : 'Two-factor authentication enabled!'}
              </p>
            </div>
            <p className="text-sm text-gray-400">
              Save these backup codes in a safe place. Each code can only be used once to sign in if
              you lose access to your authenticator app.
            </p>
            <div className="bg-gray-800 rounded-xl p-4 border border-white/5">
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, i) => (
                  <code key={i} className="text-sm font-mono text-white text-center py-1">
                    {code}
                  </code>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyBackupCodes}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-white/10 rounded-xl hover:bg-gray-700 transition-colors"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? 'Copied' : 'Copy Codes'}
              </button>
              <button
                onClick={downloadBackupCodes}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-white/10 rounded-xl hover:bg-gray-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
            <button
              onClick={() => setSetupStep('idle')}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-400 transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {setupStep === 'idle' && twoFactorEnabled && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Your account is protected with two-factor authentication. You will be asked for a code
              from your authenticator app when signing in.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setPasswordAction('view-codes');
                  setError('');
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-white/10 rounded-xl hover:bg-gray-700 transition-colors"
              >
                <Eye className="h-4 w-4" />
                View Backup Codes
              </button>
              <button
                onClick={() => {
                  setPasswordAction('regen-codes');
                  setError('');
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-white/10 rounded-xl hover:bg-gray-700 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate Codes
              </button>
              <button
                onClick={() => {
                  setPasswordAction('disable');
                  setError('');
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl hover:bg-red-500/20 transition-colors"
              >
                <ShieldOff className="h-4 w-4" />
                Disable 2FA
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// Connected Accounts Section
// ============================================================================

function ConnectedAccountsSection({
  accounts,
  onRefresh,
}: {
  accounts: AccountInfo[];
  onRefresh: () => void;
}) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleConnect = async (provider: string) => {
    try {
      const res = await apiFetch('/auth/sign-in/social', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          callbackURL: window.location.origin + '/settings',
        }),
      });
      const data = await res.json();
      if (data.url && typeof data.url === 'string') {
        try {
          const parsed = new URL(data.url);
          // Only allow HTTPS redirects to known OAuth provider domains
          const trustedPatterns = [
            'github.com',
            'google.com',
            'googleapis.com',
            'appleid.apple.com',
            window.location.hostname,
          ];
          const isTrusted =
            parsed.protocol === 'https:' &&
            trustedPatterns.some((d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
          if (isTrusted) {
            window.location.href = data.url;
          } else {
            setError('Untrusted redirect URL');
          }
        } catch {
          setError('Invalid redirect URL');
        }
      }
    } catch {
      setError('Failed to start connection');
    }
  };

  const handleDisconnect = async (providerId: string) => {
    setDisconnecting(providerId);
    setError('');
    try {
      const res = await apiFetch('/api/settings/accounts/disconnect', {
        method: 'POST',
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect account');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link2 className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-white">Connected Accounts</h2>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                Provider
              </th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                Status
              </th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                Connected
              </th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider pb-3">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {accounts.map((account) => (
              <tr key={account.provider}>
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-3">
                    {account.provider === 'github' ? (
                      <Github className="h-5 w-5 text-gray-400" />
                    ) : account.provider === 'google' ? (
                      <svg className="h-5 w-5" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-5 w-5 text-gray-400"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                      </svg>
                    )}
                    <span className="text-sm font-medium text-white">
                      {PROVIDER_LABELS[account.provider] || account.provider}
                    </span>
                  </div>
                </td>
                <td className="py-4 pr-4">
                  {account.connected ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-400">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
                      <XCircle className="h-3.5 w-3.5" />
                      Not connected
                    </span>
                  )}
                </td>
                <td className="py-4 pr-4">
                  <span className="text-sm text-gray-400">{formatDate(account.createdAt)}</span>
                </td>
                <td className="py-4 text-right">
                  {account.connected ? (
                    <button
                      onClick={() => handleDisconnect(account.provider)}
                      disabled={disconnecting === account.provider}
                      className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      {disconnecting === account.provider ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(account.provider)}
                      className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Active Sessions Section
// ============================================================================

function ActiveSessionsSection({
  sessions,
  onRefresh,
}: {
  sessions: SessionInfo[];
  onRefresh: () => void;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [error, setError] = useState('');

  const handleRevokeSession = async (sessionId: string) => {
    setRevoking(sessionId);
    setError('');
    try {
      const res = await apiFetch('/api/settings/sessions/revoke', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to revoke session');
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeOthers = async () => {
    setRevokingAll(true);
    setError('');
    try {
      const res = await apiFetch('/api/settings/sessions/revoke-others', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to revoke sessions');
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke sessions');
    } finally {
      setRevokingAll(false);
    }
  };

  const otherSessionsExist = sessions.some((s) => !s.isCurrent);

  return (
    <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">Active Sessions</h2>
        </div>
        {otherSessionsExist && (
          <button
            onClick={handleRevokeOthers}
            disabled={revokingAll}
            className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {revokingAll ? 'Signing out...' : 'Sign out all other devices'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-400">No active sessions found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                  Device
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                  Type
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                  IP Address
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                  Location
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                  Created
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3 pr-4">
                  Last Active
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider pb-3">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sessions.map((session) => {
                const { device, type } = parseUserAgent(session.userAgent);
                return (
                  <tr key={session.id}>
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-3">
                        {type === 'web' ? (
                          <Monitor className="h-4 w-4 text-gray-500" />
                        ) : (
                          <Smartphone className="h-4 w-4 text-gray-500" />
                        )}
                        <span className="text-sm font-medium text-white">{device}</span>
                        {session.isCurrent && (
                          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                            This device
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 bg-gray-800 px-2 py-1 rounded-lg capitalize">
                        {type}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <span className="text-sm text-gray-400 font-mono">
                        {session.ipAddress || '\u2014'}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <span className="text-sm text-gray-400">
                        {formatLocation(session.city, session.region, session.country)}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <span className="text-sm text-gray-400">
                        {formatRelativeTime(session.createdAt)}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <span className="text-sm text-gray-400">
                        {session.isCurrent ? 'Now' : formatRelativeTime(session.updatedAt)}
                      </span>
                    </td>
                    <td className="py-4 text-right">
                      {session.isCurrent ? (
                        <span className="text-sm text-gray-600">{'\u2014'}</span>
                      ) : (
                        <button
                          onClick={() => handleRevokeSession(session.id)}
                          disabled={revoking === session.id}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                        >
                          {revoking === session.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <LogOut className="h-3.5 w-3.5" />
                          )}
                          Sign out
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Danger Zone Section
// ============================================================================

function DangerZoneSection() {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError('');
    try {
      const res = await apiFetch('/api/settings/delete-account', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete account');
      }
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
    }
  };

  return (
    <div className="bg-gray-900/50 rounded-2xl border border-red-500/20 p-6">
      <div className="flex items-center gap-3 mb-6">
        <Trash2 className="h-5 w-5 text-red-400" />
        <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-white">Delete Account</p>
          <p className="text-sm text-gray-400">Permanently delete your account and all data</p>
        </div>
        {showDeleteConfirm ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-gray-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-400 hover:bg-red-300 rounded-xl transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Confirm Delete'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-red-400 hover:bg-red-300 rounded-xl transition-colors"
          >
            Delete Account
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Settings Page
// ============================================================================

export default function SettingsPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [userRes, sessionsRes, accountsRes] = await Promise.all([
        apiFetch('/auth/me'),
        apiFetch('/api/settings/sessions'),
        apiFetch('/api/settings/accounts'),
      ]);

      if (!userRes.ok) {
        window.location.href = '/login';
        return;
      }

      const [userData, sessionsData, accountsData] = await Promise.all([
        userRes.json(),
        sessionsRes.json(),
        accountsRes.json(),
      ]);

      setUser(userData.user);
      setSessions(sessionsData.sessions || []);
      setAccounts(accountsData.accounts || []);
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refreshSessions = useCallback(async () => {
    try {
      setRefreshError('');
      const res = await apiFetch('/api/settings/sessions');
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      setRefreshError('Failed to refresh sessions');
    }
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      setRefreshError('');
      const res = await apiFetch('/api/settings/accounts');
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch {
      setRefreshError('Failed to refresh accounts');
    }
  }, []);

  const handleSaveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty');
      return;
    }
    setSavingName(true);
    setNameError('');
    try {
      const res = await apiFetch('/auth/update-user', {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to update name');
      }
      setUser((prev) => (prev ? { ...prev, name: trimmed } : prev));
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to update name');
    } finally {
      setSavingName(false);
    }
  }, [nameInput]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">Manage your account and preferences</p>
      </div>

      {refreshError && (
        <div className="mb-6 flex items-center justify-between rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-sm text-red-400">{refreshError}</p>
          <button
            onClick={() => setRefreshError('')}
            className="text-red-400 hover:text-red-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* Profile */}
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
          <div className="flex items-center gap-3 mb-6">
            <User className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-white">Profile</h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
              <span className="text-xl font-semibold text-white">
                {user ? getInitials(user.name, user.email) : '?'}
              </span>
            </div>
            <div className="flex-1">
              {editingName ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveName();
                        if (e.key === 'Escape') {
                          setEditingName(false);
                          setNameError('');
                        }
                      }}
                      className="rounded-xl bg-gray-800 border border-white/10 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Your name"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={savingName}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-400 transition-colors disabled:opacity-50"
                    >
                      {savingName ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingName(false);
                        setNameError('');
                      }}
                      disabled={savingName}
                      className="px-3 py-1.5 text-sm font-medium text-gray-400 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  {nameError && <p className="text-sm text-red-400">{nameError}</p>}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-medium text-white">{user?.name || 'No name set'}</p>
                  <button
                    onClick={() => {
                      setNameInput(user?.name || '');
                      setEditingName(true);
                      setNameError('');
                    }}
                    className="text-gray-400 hover:text-white transition-colors"
                    title="Edit name"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <p className="text-sm text-gray-400">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
          </div>

          <div className="space-y-4">
            <label className="flex items-center justify-between opacity-60">
              <div>
                <p className="font-medium text-white">
                  Push Notifications{' '}
                  <span className="text-xs text-gray-500 font-normal">(Coming soon)</span>
                </p>
                <p className="text-sm text-gray-400">Get notified when agents need approval</p>
              </div>
              <input
                type="checkbox"
                defaultChecked
                disabled
                className="h-5 w-5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
              />
            </label>

            <label className="flex items-center justify-between opacity-60">
              <div>
                <p className="font-medium text-white">
                  Email Notifications{' '}
                  <span className="text-xs text-gray-500 font-normal">(Coming soon)</span>
                </p>
                <p className="text-sm text-gray-400">Receive session summaries via email</p>
              </div>
              <input
                type="checkbox"
                disabled
                className="h-5 w-5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
              />
            </label>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <TwoFactorSection initialEnabled={user?.twoFactorEnabled ?? false} />

        {/* Connected Accounts */}
        <ConnectedAccountsSection accounts={accounts} onRefresh={refreshAccounts} />

        {/* Active Sessions */}
        <ActiveSessionsSection sessions={sessions} onRefresh={refreshSessions} />

        {/* Danger Zone */}
        <DangerZoneSection />
      </div>
    </div>
  );
}

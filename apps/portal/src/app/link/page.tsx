'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Loader2, LinkIcon, AlertCircle, LogIn } from 'lucide-react';
import { apiFetch } from '@/lib/api';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

export default function LinkMachinePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
          <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
        </div>
      }
    >
      <LinkMachineContent />
    </Suspense>
  );
}

function LinkMachineContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const codeFromUrl = searchParams.get('code') || '';

  const [code, setCode] = useState(codeFromUrl);
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'linking' | 'success' | 'error' | 'unauthenticated'
  >('idle');
  const [error, setError] = useState('');
  const [machineName, setMachineName] = useState('');

  // Check auth status first, then auto-link if code came from URL
  useEffect(() => {
    if (codeFromUrl && status === 'idle') {
      checkAuthAndLink(codeFromUrl);
    }
  }, [codeFromUrl]);

  const checkAuthAndLink = async (linkCode: string) => {
    setStatus('checking');
    try {
      // Quick auth check
      const authRes = await fetch(`${apiUrl}/auth/get-session`, {
        credentials: 'include',
      });
      if (!authRes.ok || !(await authRes.json()).session) {
        setStatus('unauthenticated');
        return;
      }
      // User is authenticated, proceed to link
      await doLink(linkCode);
    } catch {
      // Network error or no session - show login prompt
      setStatus('unauthenticated');
    }
  };

  const doLink = async (linkCode: string) => {
    const trimmed = linkCode.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError('Please enter a valid pairing code.');
      setStatus('error');
      return;
    }

    setStatus('linking');
    setError('');

    try {
      const res = await apiFetch('/api/machines/link', {
        method: 'POST',
        body: JSON.stringify({ code: trimmed }),
      });

      if (res.status === 401) {
        setStatus('unauthenticated');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to link machine');
      }

      const data = await res.json();
      setMachineName(data.machine?.name || 'Machine');
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link machine');
      setStatus('error');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doLink(code);
  };

  const redirectToLogin = () => {
    const currentCode = code || codeFromUrl;
    // Only use code if it matches the valid format (uppercase alphanumeric + dash, max 9 chars)
    const isValidCode = /^[A-Z0-9-]{4,9}$/.test(currentCode);
    const safeCode = isValidCode ? currentCode : '';
    const returnUrl = safeCode ? `/link?code=${safeCode}` : '/link';
    router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Success state */}
        {status === 'success' && (
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20 mb-6">
              <Check className="h-8 w-8 text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Machine Linked!</h1>
            <p className="text-gray-400 mb-8">
              <span className="text-white font-medium">{machineName}</span> has been successfully
              linked to your account.
            </p>
            <Link
              href="/machines"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            >
              View Machines
            </Link>
          </div>
        )}

        {/* Checking auth / Linking state */}
        {(status === 'checking' || status === 'linking') && (
          <div className="text-center">
            <Loader2 className="h-12 w-12 text-blue-400 animate-spin mx-auto mb-6" />
            <h1 className="text-2xl font-bold text-white mb-2">
              {status === 'checking' ? 'Checking...' : 'Linking Machine...'}
            </h1>
            <p className="text-gray-400">
              {status === 'checking'
                ? 'Verifying your session.'
                : 'Connecting your machine to your account.'}
            </p>
          </div>
        )}

        {/* Unauthenticated - prompt login */}
        {status === 'unauthenticated' && (
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 mb-6">
              <LogIn className="h-8 w-8 text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Sign in to Continue</h1>
            <p className="text-gray-400 mb-2">
              You need to sign in to link a machine to your account.
            </p>
            {codeFromUrl && (
              <p className="text-sm text-gray-500 mb-6">
                Code <span className="font-mono text-blue-400 font-bold">{codeFromUrl}</span> is
                ready to link after you sign in.
              </p>
            )}
            <button
              onClick={redirectToLogin}
              className="w-full max-w-xs mx-auto flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 px-6 py-3.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </button>
            <p className="text-gray-500 text-xs mt-4">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-blue-400 hover:text-blue-300">
                Sign up
              </Link>
            </p>
          </div>
        )}

        {/* Idle or error state - show form */}
        {(status === 'idle' || status === 'error') && (
          <div>
            <div className="text-center mb-8">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 mb-6">
                <LinkIcon className="h-8 w-8 text-blue-400" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Link a Machine</h1>
              <p className="text-gray-400">
                Enter the pairing code from{' '}
                <code className="px-1.5 py-0.5 bg-gray-800 rounded text-blue-400 font-mono text-xs">
                  agentap link
                </code>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl opacity-20 group-focus-within:opacity-40 blur transition-opacity" />
                <input
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    if (status === 'error') setStatus('idle');
                  }}
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  className="relative w-full bg-gray-950 rounded-xl p-5 border border-white/10 text-center text-3xl font-mono font-bold tracking-[0.3em] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
                  autoFocus
                  autoComplete="off"
                />
              </div>

              {status === 'error' && error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={code.trim().length < 4}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 px-6 py-3.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <LinkIcon className="h-4 w-4" />
                Link Machine
              </button>
            </form>

            <p className="text-center text-gray-500 text-xs mt-6">
              Don&apos;t have the daemon?{' '}
              <Link href="/machines/add" className="text-blue-400 hover:text-blue-300">
                Install instructions
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

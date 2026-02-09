'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Copy,
  Check,
  Terminal,
  KeyRound,
  LinkIcon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

export default function AddMachinePage() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [linkStatus, setLinkStatus] = useState<'idle' | 'linking' | 'success' | 'error'>('idle');
  const [linkError, setLinkError] = useState('');
  const installCommand = 'npx agentap';
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCommand).catch(() => {});
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleLink = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) return;

    setLinkStatus('linking');
    setLinkError('');

    try {
      const res = await apiFetch('/api/machines/link', {
        method: 'POST',
        body: JSON.stringify({ code: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to link machine');
      }

      setLinkStatus('success');
      redirectTimeoutRef.current = setTimeout(() => router.push('/machines'), 2000);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link machine');
      setLinkStatus('error');
    }
  };

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/machines"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Machines
        </Link>
        <h1 className="text-2xl font-bold text-white">Add a Machine</h1>
        <p className="mt-1 text-sm text-gray-400">Connect a new development machine to agentap</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Option 1: Install Script */}
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-500">
              <Terminal className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Step 1: Install</h3>
              <p className="text-sm text-gray-400">Install the daemon on your machine</p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Run this command in your terminal to install the agentap daemon:
            </p>

            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl opacity-20 group-hover:opacity-40 blur transition-opacity" />
              <div className="relative bg-gray-950 rounded-xl p-4 pr-12 overflow-x-auto border border-white/10">
                <code className="text-sm text-blue-400 font-mono whitespace-nowrap">
                  {installCommand}
                </code>
              </div>
              <button
                onClick={copyToClipboard}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="h-5 w-5 text-green-400" />
                ) : (
                  <Copy className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>

            <p className="text-sm text-gray-400">
              Then run{' '}
              <code className="px-1.5 py-0.5 bg-gray-800 rounded text-blue-400 font-mono text-xs">
                agentap link
              </code>{' '}
              and enter the code below.
            </p>
          </div>
        </div>

        {/* Option 2: Enter Code */}
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-500">
              <KeyRound className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Step 2: Link</h3>
              <p className="text-sm text-gray-400">
                Enter the code from <code className="text-blue-400 font-mono">agentap link</code>
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {linkStatus === 'success' ? (
              <div className="text-center py-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 mb-4">
                  <Check className="h-6 w-6 text-green-400" />
                </div>
                <p className="text-white font-medium">Machine linked!</p>
                <p className="text-sm text-gray-400 mt-1">Redirecting to machines...</p>
              </div>
            ) : (
              <>
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl opacity-20 group-focus-within:opacity-40 blur transition-opacity" />
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      if (linkStatus === 'error') setLinkStatus('idle');
                    }}
                    placeholder="XXXX-XXXX"
                    maxLength={9}
                    className="relative w-full bg-gray-950 rounded-xl p-6 border border-white/10 text-center text-3xl font-mono font-bold tracking-[0.3em] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
                    autoComplete="off"
                  />
                </div>

                {linkStatus === 'error' && linkError && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{linkError}</span>
                  </div>
                )}

                <button
                  onClick={handleLink}
                  disabled={code.trim().length < 4 || linkStatus === 'linking'}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {linkStatus === 'linking' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LinkIcon className="h-4 w-4" />
                  )}
                  {linkStatus === 'linking' ? 'Linking...' : 'Link Machine'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Help section */}
      <div className="mt-8 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-2xl p-6 border border-white/10">
        <h3 className="text-sm font-semibold text-white mb-2">Need help?</h3>
        <p className="text-sm text-gray-400">
          Check out our{' '}
          <Link
            href="https://agentap.dev/docs/getting-started"
            className="text-blue-400 underline hover:text-blue-300"
          >
            getting started guide
          </Link>{' '}
          for detailed installation instructions and troubleshooting tips.
        </p>
      </div>
    </div>
  );
}

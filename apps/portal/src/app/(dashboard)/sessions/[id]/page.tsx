'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Terminal,
  Clock,
  Monitor,
  FolderOpen,
  MessageSquare,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { ClaudeCodeIcon } from '@/components/icons/ClaudeCodeIcon';
import { apiFetch } from '@/lib/api';

interface AgentSession {
  id: string;
  machineId: string;
  machineName: string;
  agent: string;
  projectPath: string | null;
  projectName: string | null;
  status: string;
  lastMessage: string | null;
  lastActivityAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

function formatDuration(startedAt?: string | null, endedAt?: string | null): string {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - start;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return '<1m';
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${hours}h ${mins}m`;
}

function formatTimestamp(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function agentDisplayName(agent: string): string {
  switch (agent) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex CLI';
    case 'aider':
      return 'Aider';
    case 'opencode':
      return 'OpenCode';
    default:
      return agent;
  }
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    completed: {
      bg: 'bg-green-500/10',
      text: 'text-green-400',
      border: 'border-green-500/20',
      label: 'Completed',
    },
    error: {
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      border: 'border-red-500/20',
      label: 'Error',
    },
    running: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/20',
      label: 'Running',
    },
    waiting_for_approval: {
      bg: 'bg-yellow-500/10',
      text: 'text-yellow-400',
      border: 'border-yellow-500/20',
      label: 'Waiting',
    },
  }[status] || {
    bg: 'bg-gray-500/10',
    text: 'text-gray-400',
    border: 'border-gray-500/20',
    label: status,
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.bg} ${config.text} ${config.border}`}
    >
      {config.label}
    </span>
  );
}

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [session, setSession] = useState<AgentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSession = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/sessions/${id}`);

      if (res.status === 404) {
        setError('Session not found');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch session');
      }

      const data = await res.json();
      setSession(data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (!session || (session.status !== 'running' && session.status !== 'waiting_for_approval')) {
      return;
    }

    const interval = setInterval(fetchSession, 5000);
    return () => clearInterval(interval);
  }, [session, fetchSession]);

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <Link
            href="/sessions"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sessions
          </Link>
          <h1 className="text-2xl font-bold text-white">Session Detail</h1>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div>
        <div className="mb-8">
          <Link
            href="/sessions"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sessions
          </Link>
          <h1 className="text-2xl font-bold text-white">Session Detail</h1>
        </div>
        <div className="bg-gray-900/50 rounded-2xl border border-red-500/20 p-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">
            {error === 'Session not found' ? 'Session not found' : 'Failed to load session'}
          </h3>
          <p className="mt-2 text-sm text-red-400">
            {error || 'This session does not exist or you do not have access.'}
          </p>
          <Link
            href="/sessions"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Return to sessions
          </Link>
        </div>
      </div>
    );
  }

  const duration = formatDuration(session.startedAt, session.endedAt);

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sessions
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">
            {session.projectName || 'Untitled Session'}
          </h1>
          <StatusBadge status={session.status} />
        </div>
        <p className="mt-1 text-sm text-gray-400">Session {session.id.slice(0, 8)}...</p>
      </div>

      <div className="bg-gray-900/50 rounded-2xl border border-white/10 overflow-hidden">
        <div className="px-6 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800">
              {session.agent === 'claude-code' ? (
                <ClaudeCodeIcon className="h-5 w-5 text-[#D97757]" />
              ) : (
                <Terminal className="h-5 w-5 text-gray-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{agentDisplayName(session.agent)}</p>
              <p className="text-xs text-gray-500">Agent</p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-white/5">
          {session.projectName && (
            <div className="flex items-center gap-3 px-6 py-4">
              <FolderOpen className="h-4 w-4 text-gray-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-gray-500">Project</p>
                <p className="text-sm text-white truncate">{session.projectName}</p>
                {session.projectPath && (
                  <p className="text-xs text-gray-600 truncate">{session.projectPath}</p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 px-6 py-4">
            <Monitor className="h-4 w-4 text-gray-500 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Machine</p>
              <p className="text-sm text-white">{session.machineName}</p>
            </div>
          </div>

          {duration && (
            <div className="flex items-center gap-3 px-6 py-4">
              <Clock className="h-4 w-4 text-gray-500 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Duration</p>
                <p className="text-sm text-white">{duration}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/5">
            <div className="px-6 py-4">
              <p className="text-xs text-gray-500">Started</p>
              <p className="text-sm text-white">{formatTimestamp(session.startedAt)}</p>
            </div>
            <div className="px-6 py-4">
              <p className="text-xs text-gray-500">Ended</p>
              <p className="text-sm text-white">{formatTimestamp(session.endedAt)}</p>
            </div>
          </div>

          {session.lastMessage && (
            <div className="flex items-start gap-3 px-6 py-4">
              <MessageSquare className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs text-gray-500">Last Message</p>
                <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">
                  {session.lastMessage}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

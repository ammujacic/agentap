'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  History,
  Terminal,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { ClaudeCodeIcon } from '@/components/icons/ClaudeCodeIcon';
import { apiFetch } from '@/lib/api';

interface AgentSession {
  id: string;
  machineId: string;
  machineName: string;
  agent: string;
  projectPath?: string;
  projectName?: string;
  status: string;
  lastMessage?: string;
  lastActivityAt?: string;
  startedAt?: string;
  endedAt?: string;
}

type StatusFilter = 'all' | 'running' | 'completed' | 'error';

function formatDuration(startedAt?: string, endedAt?: string): string {
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

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const hours = Math.floor(diffMins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'completed', label: 'Completed' },
  { key: 'error', label: 'Error' },
];

const SESSIONS_LIMIT = 50;

export default function SessionsPage() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const fetchSessions = useCallback(
    async (offset = 0, append = false) => {
      try {
        const params = new URLSearchParams({
          limit: String(SESSIONS_LIMIT),
          offset: String(offset),
        });
        if (filter !== 'all') {
          params.set('status', filter);
        }

        const res = await apiFetch(`/api/sessions?${params}`);

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch sessions');
        }

        const data = await res.json();
        if (append) {
          setSessions((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            const newSessions = (data.sessions || []).filter(
              (s: AgentSession) => !existingIds.has(s.id)
            );
            return [...prev, ...newSessions];
          });
        } else {
          setSessions(data.sessions || []);
        }
        setTotal(data.total ?? 0);
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter]
  );

  // Reset and fetch when filter changes
  useEffect(() => {
    setLoading(true);
    setSessions([]);
    fetchSessions(0, false);
  }, [filter, fetchSessions]);

  // Poll for updates on the current page
  const pollingRef = useRef(false);
  useEffect(() => {
    const interval = setInterval(() => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      fetchSessions(0, false).finally(() => {
        pollingRef.current = false;
      });
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const loadMore = () => {
    setLoadingMore(true);
    fetchSessions(sessions.length, true);
  };

  const hasMore = sessions.length < total;

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Sessions</h1>
          <p className="mt-1 text-sm text-gray-400">View your AI agent session history</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Sessions</h1>
        <p className="mt-1 text-sm text-gray-400">View your AI agent session history</p>
      </div>

      {/* Status filter tabs - always visible */}
      <div className="flex items-center gap-2 mb-4">
        <Filter className="h-4 w-4 text-gray-500" />
        {statusFilters.map((sf) => (
          <button
            key={sf.key}
            onClick={() => setFilter(sf.key)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
              filter === sf.key
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            {sf.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="bg-gray-900/50 rounded-2xl border border-red-500/20 p-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">Failed to load sessions</h3>
          <p className="mt-2 text-sm text-red-400">{error}</p>
        </div>
      ) : sessions.length === 0 && filter === 'all' ? (
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
            <History className="h-8 w-8 text-gray-500" />
          </div>
          <h3 className="text-lg font-semibold text-white">No sessions yet</h3>
          <p className="mt-2 text-sm text-gray-400 max-w-sm mx-auto">
            Sessions will appear here when you run Claude Code or other AI coding tools on your
            connected machines.
          </p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-6 py-8 text-center text-sm text-gray-500">
            No {filter} sessions found.
          </div>
        </div>
      ) : (
        <>
          <div className="bg-gray-900/50 rounded-2xl border border-white/10 overflow-hidden">
            <ul className="divide-y divide-white/5">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/sessions/${session.id}`}
                    className="block hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center px-6 py-4">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800">
                          {session.agent === 'claude-code' ? (
                            <ClaudeCodeIcon className="h-5 w-5 text-[#D97757]" />
                          ) : (
                            <Terminal className="h-5 w-5 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">
                            {session.projectName || session.lastMessage || 'Untitled session'}
                          </p>
                          <p className="text-sm text-gray-500">
                            {session.machineName} &bull; {agentDisplayName(session.agent)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <Clock className="h-4 w-4" />
                            {formatDuration(session.startedAt, session.endedAt)}
                          </div>
                          <p className="text-xs text-gray-600">
                            {formatTimeAgo(session.lastActivityAt)}
                          </p>
                        </div>
                        {session.status === 'completed' ? (
                          <CheckCircle className="h-5 w-5 text-green-400" />
                        ) : session.status === 'error' ? (
                          <XCircle className="h-5 w-5 text-red-400" />
                        ) : (
                          <div className="h-5 w-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                        )}
                        <ChevronRight className="h-4 w-4 text-gray-600" />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-xl bg-gray-800 border border-white/10 px-5 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-all disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? 'Loading...' : `Load more (${sessions.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

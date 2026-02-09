'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Monitor,
  Wifi,
  WifiOff,
  Trash2,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Cpu,
  HardDrive,
  Clock,
  Bot,
  Pencil,
  Check,
  X,
  Terminal,
  ShieldAlert,
  FolderOpen,
  CircleDot,
  Search,
} from 'lucide-react';
import { ClaudeCodeIcon } from '@/components/icons/ClaudeCodeIcon';
import { apiFetch } from '@/lib/api';

interface Machine {
  id: string;
  name: string;
  tunnelId: string;
  tunnelUrl: string | null;
  os: string | null;
  arch: string | null;
  agentsDetected: string[];
  isOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

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

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  running: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    dot: 'bg-green-400',
  },
  thinking: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
  waiting_for_approval: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
  },
  waiting_for_input: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    dot: 'bg-purple-400',
  },
  idle: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-400',
    dot: 'bg-gray-400',
  },
  completed: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-500',
    dot: 'bg-gray-500',
  },
  error: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
};

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function MachineDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const SESSIONS_LIMIT = 50;

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeCount, setActiveCount] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fetchMachine = async () => {
      try {
        const res = await apiFetch(`/api/machines/${params.id}`);

        if (!res.ok) {
          if (res.status === 404) {
            setError('Machine not found');
          } else {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to fetch machine');
          }
          return;
        }

        const data = await res.json();
        setMachine(data.machine);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch machine');
      } finally {
        setLoading(false);
      }
    };

    fetchMachine();
  }, [params.id]);

  const fetchSessions = useCallback(
    async (opts?: { search?: string; status?: string; append?: boolean; offset?: number }) => {
      const { search, status, append = false, offset = 0 } = opts ?? {};

      if (!append) {
        setSessionsLoading(true);
      }

      try {
        const queryParams = new URLSearchParams({
          machineId: params.id,
          limit: String(SESSIONS_LIMIT),
          offset: String(offset),
        });
        if (search) queryParams.set('search', search);
        if (status && status !== 'all') queryParams.set('status', status);

        const res = await apiFetch(`/api/sessions?${queryParams}`);

        if (!res.ok) return;

        const data = await res.json();
        if (append) {
          setSessions((prev) => [...prev, ...(data.sessions || [])]);
        } else {
          setSessions(data.sessions || []);
        }
        setSessionsTotal(data.total ?? 0);
        setActiveCount(data.activeCount ?? 0);
      } catch {
        // Sessions are supplementary — don't block the page
      } finally {
        setSessionsLoading(false);
        setLoadingMore(false);
      }
    },
    [params.id]
  );

  // Initial fetch
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Refetch on filter change (debounced for search)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      fetchSessions({ search: searchQuery, status: statusFilter });
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, statusFilter]);

  const loadMoreSessions = () => {
    setLoadingMore(true);
    fetchSessions({
      search: searchQuery,
      status: statusFilter,
      append: true,
      offset: sessions.length,
    });
  };

  const hasMoreSessions = sessions.length < sessionsTotal;

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const handleDelete = async () => {
    if (!machine) return;
    setDeleting(true);

    try {
      const res = await apiFetch(`/api/machines/${machine.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete machine');
      }

      router.push('/machines');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete machine');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const startRename = () => {
    if (!machine) return;
    setRenameValue(machine.name);
    setRenaming(true);
  };

  const submitRename = async () => {
    if (!machine || !renameValue.trim()) return;
    setRenameLoading(true);

    try {
      const res = await apiFetch(`/api/machines/${machine.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: renameValue.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to rename machine');
      }

      setMachine({ ...machine, name: renameValue.trim() });
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename machine');
    } finally {
      setRenameLoading(false);
    }
  };

  const pendingApprovals = sessions.filter((s) => s.status === 'waiting_for_approval');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error || !machine) {
    return (
      <div>
        <button
          onClick={() => router.push('/machines')}
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Machines
        </button>
        <div className="bg-gray-900/50 rounded-2xl border border-red-500/20 p-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">{error || 'Machine not found'}</h3>
          <p className="mt-2 text-sm text-gray-400">
            This machine may have been removed or you don&apos;t have access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => router.push('/machines')}
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Machines
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-800">
            <Monitor className="h-7 w-7 text-gray-400" />
          </div>
          <div>
            {renaming ? (
              <div className="flex items-center gap-2">
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  disabled={renameLoading}
                  className="bg-gray-800 border border-white/20 rounded-lg px-3 py-1.5 text-xl font-bold text-white focus:outline-none focus:border-blue-500 w-64"
                />
                <button
                  onClick={submitRename}
                  disabled={renameLoading}
                  className="p-1.5 text-green-400 hover:bg-green-500/10 rounded-lg"
                >
                  <Check className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setRenaming(false)}
                  className="p-1.5 text-gray-400 hover:bg-white/10 rounded-lg"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">{machine.name}</h1>
                <button
                  onClick={startRename}
                  className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  title="Rename machine"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 mt-1">
              {machine.isOnline ? (
                <span className="inline-flex items-center gap-1 text-sm text-green-400">
                  <Wifi className="h-4 w-4" />
                  Online
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm text-gray-500">
                  <WifiOff className="h-4 w-4" />
                  Offline
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Machine Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-5">
          <div className="flex items-center gap-3 mb-3">
            <Cpu className="h-5 w-5 text-gray-500" />
            <span className="text-sm font-medium text-gray-400">Platform</span>
          </div>
          <p className="text-white font-semibold">
            {machine.os || 'Unknown'} &bull; {machine.arch || 'Unknown'}
          </p>
        </div>

        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-5">
          <div className="flex items-center gap-3 mb-3">
            <Bot className="h-5 w-5 text-gray-500" />
            <span className="text-sm font-medium text-gray-400">Agents</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {machine.agentsDetected.length > 0 ? (
              machine.agentsDetected.map((agent) => (
                <span
                  key={agent}
                  className="inline-flex items-center rounded-lg bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400"
                >
                  {agent}
                </span>
              ))
            ) : (
              <span className="text-sm text-gray-500">None</span>
            )}
          </div>
        </div>

        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-5">
          <div className="flex items-center gap-3 mb-3">
            <Clock className="h-5 w-5 text-gray-500" />
            <span className="text-sm font-medium text-gray-400">Last Seen</span>
          </div>
          <p className="text-white font-semibold">
            {machine.lastSeenAt ? timeAgo(machine.lastSeenAt) : 'Never'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {machine.lastSeenAt ? new Date(machine.lastSeenAt).toLocaleString() : ''}
          </p>
        </div>

        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-5">
          <div className="flex items-center gap-3 mb-3">
            <HardDrive className="h-5 w-5 text-gray-500" />
            <span className="text-sm font-medium text-gray-400">Tunnel ID</span>
          </div>
          <p className="text-white font-mono text-xs truncate">{machine.tunnelId}</p>
        </div>
      </div>

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Pending Approvals</h2>
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
              {pendingApprovals.length}
            </span>
          </div>
          <div className="bg-gray-900/50 rounded-2xl border border-amber-500/20 overflow-hidden">
            <ul className="divide-y divide-white/5">
              {pendingApprovals.map((session) => (
                <li key={session.id}>
                  <div className="flex items-center px-6 py-4 gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 shrink-0">
                      <ShieldAlert className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {session.projectName || session.agent}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {session.lastMessage || 'Waiting for approval...'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Awaiting Approval
                      </span>
                      {session.lastActivityAt && (
                        <p className="text-xs text-gray-500 mt-1">
                          {timeAgo(session.lastActivityAt)}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Sessions Header + Search/Filter */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Agent Sessions</h2>
            <span className="inline-flex items-center rounded-full bg-gray-700/50 px-2.5 py-0.5 text-xs font-semibold text-gray-300">
              {sessionsTotal}
            </span>
            {activeCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-semibold text-green-400">
                {activeCount} active
              </span>
            )}
          </div>
        </div>

        {/* Search and Filter bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by project name, path, or message..."
              className="w-full bg-gray-900/50 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-gray-900/50 border border-white/10 rounded-xl px-4 pr-9 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors appearance-none cursor-pointer min-w-[140px]"
            >
              <option value="all">All statuses</option>
              <option value="running">Running</option>
              <option value="idle">Idle</option>
              <option value="thinking">Thinking</option>
              <option value="waiting_for_approval">Waiting for Approval</option>
              <option value="waiting_for_input">Waiting for Input</option>
              <option value="completed">Completed</option>
              <option value="error">Error</option>
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Sessions List */}
      <div className="mb-8">
        {sessionsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-blue-400 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-gray-800 flex items-center justify-center mb-3">
              <Terminal className="h-6 w-6 text-gray-500" />
            </div>
            <p className="text-sm text-gray-400">
              {searchQuery || statusFilter !== 'all'
                ? 'No sessions match your search'
                : 'No sessions on this machine'}
            </p>
          </div>
        ) : (
          <div className="bg-gray-900/50 rounded-2xl border border-white/10 overflow-hidden">
            <ul className="divide-y divide-white/5">
              {sessions.map((session) => {
                const isActive = session.status !== 'completed' && session.status !== 'error';
                const colors =
                  STATUS_COLORS[session.status] ||
                  (isActive ? STATUS_COLORS.idle : STATUS_COLORS.completed);
                return (
                  <li key={session.id}>
                    <div className={`flex items-center px-6 ${isActive ? 'py-4' : 'py-3'} gap-4`}>
                      <div
                        className={`flex ${isActive ? 'h-10 w-10 rounded-xl' : 'h-8 w-8 rounded-lg'} items-center justify-center ${isActive ? colors.bg : 'bg-gray-800'} shrink-0`}
                      >
                        {session.agent === 'claude-code' ? (
                          <ClaudeCodeIcon
                            className={`${isActive ? 'h-5 w-5' : 'h-4 w-4'} text-[#D97757]`}
                          />
                        ) : (
                          <Terminal
                            className={`${isActive ? 'h-5 w-5' : 'h-4 w-4'} ${isActive ? colors.text : 'text-gray-500'}`}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm ${isActive ? 'font-semibold text-white' : 'text-gray-300'} truncate`}
                          >
                            {session.projectName || session.agent}
                          </p>
                          {isActive && (
                            <span className="inline-flex items-center rounded-lg bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                              {session.agent}
                            </span>
                          )}
                        </div>
                        {isActive && session.projectPath && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <FolderOpen className="h-3 w-3 text-gray-600" />
                            <p className="text-xs text-gray-500 truncate font-mono">
                              {session.projectPath}
                            </p>
                          </div>
                        )}
                        {session.lastMessage && (
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            {session.lastMessage}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg ${colors.bg} px-2.5 py-1 text-xs font-medium ${colors.text}`}
                        >
                          {isActive ? (
                            <CircleDot className="h-3 w-3" />
                          ) : (
                            <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                          )}
                          {statusLabel(session.status)}
                        </span>
                        {session.lastActivityAt && (
                          <p className="text-xs text-gray-500 mt-1">
                            {timeAgo(session.lastActivityAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Load more sessions */}
      {hasMoreSessions && (
        <div className="flex justify-center mb-8">
          <button
            onClick={loadMoreSessions}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-800 border border-white/10 px-5 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-all disabled:opacity-50"
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loadingMore
              ? 'Loading...'
              : `Load more sessions (${sessions.length} of ${sessionsTotal})`}
          </button>
        </div>
      )}

      {/* Danger zone */}
      <div className="bg-gray-900/50 rounded-2xl border border-red-500/20 p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Danger Zone</h3>
        <p className="text-sm text-gray-400 mb-4">
          Removing this machine will disconnect it from your account. You can re-link it later using
          a new QR code.
        </p>

        {showDeleteConfirm ? (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-xl bg-red-500/20 border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/30 transition-all disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Yes, Remove Machine
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              className="rounded-xl bg-gray-800 px-4 py-2.5 text-sm font-semibold text-gray-400 hover:bg-gray-700 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/20 transition-all"
          >
            <Trash2 className="h-4 w-4" />
            Remove Machine
          </button>
        )}
      </div>
    </div>
  );
}

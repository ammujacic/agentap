'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Monitor,
  Plus,
  MoreVertical,
  Wifi,
  WifiOff,
  Loader2,
  AlertCircle,
  Pencil,
  Trash2,
  X,
  Check,
  Bot,
  MessageSquare,
  Clock,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface Machine {
  id: string;
  name: string;
  os?: string;
  arch?: string;
  isOnline: boolean;
  agentsDetected?: string[];
  activeSessionCount?: number;
  lastSeenAt?: string | null;
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingMachineName, setDeletingMachineName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchMachines = async () => {
      try {
        const res = await apiFetch('/api/machines');

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch machines');
        }

        const data = await res.json();
        setMachines(data.machines || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch machines');
      } finally {
        setLoading(false);
      }
    };

    fetchMachines();
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    if (openMenu) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [openMenu]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = (machine: Machine) => {
    setRenamingId(machine.id);
    setRenameValue(machine.name);
    setOpenMenu(null);
  };

  const submitRename = async () => {
    if (!renamingId || !renameValue.trim() || renameValue.trim().length > 100) return;

    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/machines/${renamingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: renameValue.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to rename machine');
      }

      setMachines((prev) =>
        prev.map((m) => (m.id === renamingId ? { ...m, name: renameValue.trim() } : m))
      );
      setRenamingId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to rename machine');
    } finally {
      setActionLoading(false);
    }
  };

  const confirmDelete = (machineId: string) => {
    const machine = machines.find((m) => m.id === machineId);
    setDeletingId(machineId);
    setDeletingMachineName(machine?.name || 'Unknown Machine');
    setOpenMenu(null);
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/machines/${deletingId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete machine');
      }

      setMachines((prev) => prev.filter((m) => m.id !== deletingId));
      setDeletingId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete machine');
      setDeletingId(null);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Machines</h1>
            <p className="mt-1 text-sm text-gray-400">Manage your connected development machines</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Machines</h1>
          <p className="mt-1 text-sm text-gray-400">Manage your connected development machines</p>
        </div>
        <Link
          href="/machines/add"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white hover:from-blue-400 hover:to-purple-400 transition-all"
        >
          <Plus className="h-5 w-5" />
          Add Machine
        </Link>
      </div>

      {actionError && (
        <div className="flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 mb-4">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 flex-1">{actionError}</p>
          <button
            onClick={() => setActionError('')}
            className="text-red-400/60 hover:text-red-400 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error ? (
        <div className="bg-gray-900/50 rounded-2xl border border-red-500/20 p-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">Failed to load machines</h3>
          <p className="mt-2 text-sm text-red-400">{error}</p>
        </div>
      ) : machines.length === 0 ? (
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
            <Monitor className="h-8 w-8 text-gray-500" />
          </div>
          <h3 className="text-lg font-semibold text-white">No machines yet</h3>
          <p className="mt-2 text-sm text-gray-400 max-w-sm mx-auto">
            Install the agentap daemon on your development machine to get started.
          </p>
          <div className="mt-6">
            <Link
              href="/machines/add"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white hover:from-blue-400 hover:to-purple-400 transition-all"
            >
              <Plus className="h-5 w-5" />
              Add Machine
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900/50 rounded-2xl border border-white/10">
          <ul className="divide-y divide-white/5">
            {machines.map((machine, index) => (
              <li key={machine.id} className="relative">
                <div
                  className={`flex items-center hover:bg-white/5 transition-colors ${index === 0 ? 'rounded-t-2xl' : ''} ${index === machines.length - 1 ? 'rounded-b-2xl' : ''}`}
                >
                  <Link
                    href={`/machines/${machine.id}`}
                    className="flex items-center px-6 py-4 flex-1 min-w-0"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800 shrink-0">
                        <Monitor className="h-5 w-5 text-gray-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {renamingId === machine.id ? (
                          <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.preventDefault()}
                          >
                            <input
                              ref={renameInputRef}
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !actionLoading) submitRename();
                                if (e.key === 'Escape') setRenamingId(null);
                              }}
                              disabled={actionLoading}
                              className="bg-gray-800 border border-white/20 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 w-48"
                            />
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                submitRename();
                              }}
                              disabled={actionLoading}
                              className="p-1 text-green-400 hover:bg-green-500/10 rounded"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                setRenamingId(null);
                              }}
                              className="p-1 text-gray-400 hover:bg-white/10 rounded"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-3">
                              <p className="text-sm font-semibold text-white truncate">
                                {machine.name}
                              </p>
                              <span className="text-xs text-gray-500 shrink-0">
                                {machine.os || 'Unknown'} &bull; {machine.arch || 'Unknown'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              {machine.agentsDetected && machine.agentsDetected.length > 0 ? (
                                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                  <Bot className="h-3 w-3" />
                                  {machine.agentsDetected.join(', ')}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                                  <Bot className="h-3 w-3" />
                                  No agents
                                </span>
                              )}
                              {(machine.activeSessionCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs text-green-400">
                                  <MessageSquare className="h-3 w-3" />
                                  {machine.activeSessionCount} active
                                </span>
                              )}
                              {machine.lastSeenAt && (
                                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                  <Clock className="h-3 w-3" />
                                  {timeAgo(machine.lastSeenAt)}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-4 px-6 shrink-0">
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
                    <div className="relative" ref={openMenu === machine.id ? menuRef : undefined}>
                      <button
                        onClick={() => setOpenMenu(openMenu === machine.id ? null : machine.id)}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <MoreVertical className="h-5 w-5 text-gray-500" />
                      </button>
                      {openMenu === machine.id && (
                        <div className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-white/10 rounded-xl shadow-xl z-20 overflow-hidden">
                          <button
                            onClick={() => startRename(machine)}
                            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                            Rename
                          </button>
                          <button
                            onClick={() => confirmDelete(machine.id)}
                            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-2">Remove Machine</h3>
            <p className="text-sm text-gray-400 mb-6">
              Are you sure you want to remove{' '}
              <span className="text-white font-medium">{deletingMachineName}</span>? This will
              disconnect it from your account. You can re-link it later using a new QR code.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setDeletingId(null)}
                disabled={actionLoading}
                className="rounded-xl bg-gray-800 px-4 py-2.5 text-sm font-semibold text-gray-400 hover:bg-gray-700 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500/20 border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/30 transition-all disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

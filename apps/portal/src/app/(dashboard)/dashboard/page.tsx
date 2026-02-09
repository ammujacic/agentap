'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Monitor, Zap, Clock, Plus, Loader2, Wifi, WifiOff } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface Machine {
  id: string;
  name: string;
  os?: string;
  arch?: string;
  isOnline: boolean;
}

export default function DashboardPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/machines');
        if (res.ok) {
          const data = await res.json();
          setMachines(data.machines || []);
        }
      } catch {
        // Dashboard stats are best-effort
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const onlineCount = machines.filter((m) => m.isOnline).length;

  const stats = [
    {
      name: 'Connected Machines',
      value: loading ? '...' : String(machines.length),
      icon: Monitor,
      gradient: 'from-blue-500 to-purple-500',
    },
    {
      name: 'Online Now',
      value: loading ? '...' : String(onlineCount),
      icon: Zap,
      gradient: 'from-blue-500 to-purple-500',
    },
    {
      name: 'Offline',
      value: loading ? '...' : String(machines.length - onlineCount),
      icon: Clock,
      gradient: 'from-purple-500 to-blue-500',
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">
          Monitor your AI coding agents across all machines
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-8">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-gray-900/50 rounded-2xl border border-white/10 p-6">
            <div className="flex items-center gap-4">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${stat.gradient}`}
              >
                <stat.icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">{stat.name}</p>
                <p className="text-2xl font-semibold text-white">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Machine list or empty state */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
        </div>
      ) : machines.length === 0 ? (
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 p-12 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
            <Monitor className="h-8 w-8 text-gray-500" />
          </div>
          <h3 className="text-lg font-semibold text-white">No machines connected</h3>
          <p className="mt-2 text-sm text-gray-400 max-w-sm mx-auto">
            Get started by installing the agentap daemon on your development machine.
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

          <div className="mt-8 p-4 bg-gray-950 rounded-xl max-w-md mx-auto border border-white/5">
            <p className="text-xs font-medium text-gray-500 mb-2">Quick install:</p>
            <code className="text-sm text-blue-400 font-mono">npx agentap</code>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900/50 rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5">
            <h2 className="text-sm font-semibold text-white">Your Machines</h2>
          </div>
          <ul className="divide-y divide-white/5">
            {machines.map((machine) => (
              <li key={machine.id}>
                <Link
                  href={`/machines/${machine.id}`}
                  className="block hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center px-6 py-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800">
                        <Monitor className="h-5 w-5 text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{machine.name}</p>
                        <p className="text-sm text-gray-500">
                          {machine.os || 'Unknown'} • {machine.arch || 'Unknown'}
                        </p>
                      </div>
                    </div>
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
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

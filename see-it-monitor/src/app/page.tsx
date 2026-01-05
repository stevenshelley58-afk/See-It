'use client';

import { usePolling } from '@/lib/hooks/usePolling';
import { formatTimeAgo, getStepLabel, getStatusColor, truncateShop } from '@/lib/utils';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';

interface LiveSession {
  id: string;
  sessionId: string;
  shopDomain: string;
  productTitle: string | null;
  status: string;
  currentStep: string | null;
  stepsCompleted: number;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  deviceType: string | null;
  browser: string | null;
}

interface LiveData {
  activeSessions: LiveSession[];
  recentCompletions: LiveSession[];
  recentErrors: Array<{
    id: string;
    sessionId: string | null;
    shopDomain: string | null;
    errorCode: string;
    errorMessage: string;
    severity: string;
    occurredAt: string;
  }>;
  latestTimestamp: string;
}

export default function ControlRoom() {
  const [stats, setStats] = useState({
    activeCount: 0,
    todayCount: 0,
    successRate: 0,
    activeShops: 0,
    todayErrors: 0,
    todayCost: 0,
  });

  const { data: liveData, isPolling, lastUpdate } = usePolling<LiveData>({
    url: '/api/sessions/live',
    interval: 3000,
    enabled: true,
  });

  // Fetch stats on mount and periodically
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Every 30s
    return () => clearInterval(interval);
  }, []);

  const activeSessions = liveData?.activeSessions || [];
  const recentSessions = liveData?.recentCompletions || [];

  return (
    <div className="space-y-8">
      {/* Header Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            <span className="font-semibold text-lg">{activeSessions.length} Active</span>
          </div>
          <div className="flex items-center gap-2 text-secondary">
            <span className="w-2 h-2 rounded-full bg-gray-400" />
            <span>{stats.todayCount} Today</span>
          </div>
          <div className="flex items-center gap-2 text-secondary">
            <span className="w-2 h-2 rounded-full bg-gray-400" />
            <span>{stats.successRate}% Success</span>
          </div>
        </div>
        <div className="text-sm text-secondary flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500' : 'bg-gray-400'}`} />
          {isPolling ? 'Live' : 'Paused'}
          {lastUpdate && (
            <span className="text-xs">• {formatTimeAgo(lastUpdate.toISOString())}</span>
          )}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-sm text-secondary mb-1">Active Shops</div>
          <div className="text-2xl font-semibold">{stats.activeShops}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-secondary mb-1">Success Rate</div>
          <div className="text-2xl font-semibold">{stats.successRate}%</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-secondary mb-1">AI Cost Today</div>
          <div className="text-2xl font-semibold">${stats.todayCost.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-secondary mb-1">Errors Today</div>
          <div className="text-2xl font-semibold">{stats.todayErrors}</div>
        </div>
      </div>

      {/* Active Sessions Grid */}
      {activeSessions.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold mb-4">Active Sessions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {activeSessions.map((session) => (
              <SessionCard key={session.sessionId} session={session} />
            ))}
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <p className="text-secondary">No active sessions right now</p>
          <p className="text-sm text-gray-400 mt-2">Sessions appear here when users are actively using See It</p>
        </div>
      )}

      {/* Recent Sessions */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Completions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {recentSessions.slice(0, 12).map((session) => (
            <SessionCard key={session.sessionId} session={session} />
          ))}
        </div>
        {recentSessions.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-secondary">No sessions yet</p>
            <p className="text-sm text-gray-400 mt-2">Sessions will appear here once users start using See It</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: LiveSession }) {
  const statusColors = getStatusColor(session.status as any);
  const stepNumber = session.stepsCompleted;

  return (
    <Link href={`/sessions/${session.sessionId}`} className="block">
      <div className="card overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
        <div className="aspect-video bg-gray-100 relative">
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium truncate">{truncateShop(session.shopDomain)}</span>
            <span className={`badge ${statusColors.bg} ${statusColors.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
              {session.status}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-secondary">
              {session.currentStep ? `Step ${stepNumber}: ${getStepLabel(session.currentStep as any)}` : 'Starting...'}
            </span>
            <span className="text-gray-400">{formatTimeAgo(session.updatedAt)}</span>
          </div>

          <div className="progress-dots">
            {[1, 2, 3, 4, 5].map((step) => (
              <div
                key={step}
                className={`progress-dot ${step <= stepNumber
                    ? session.status === 'failed' && step === stepNumber
                      ? 'failed'
                      : 'filled'
                    : ''
                  }`}
              />
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

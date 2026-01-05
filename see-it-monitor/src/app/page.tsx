import { listSessions, getActiveSessions } from '@/lib/gcs';
import { formatTimeAgo, getStepLabel, getStatusColor, truncateShop } from '@/lib/utils';
import Link from 'next/link';
import Image from 'next/image';

export const revalidate = 30; // Revalidate every 30 seconds

export default async function ControlRoom() {
  const activeSessions = await getActiveSessions();
  const recentSessions = await listSessions({ limit: 20 });

  const todayCount = recentSessions.filter(s => {
    const today = new Date();
    const sessionDate = new Date(s.startedAt);
    return sessionDate.toDateString() === today.toDateString();
  }).length;

  return (
    <div className="space-y-8">
      {/* Header Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
            <span className="font-semibold text-lg">{activeSessions.length} Active</span>
          </div>
          <div className="flex items-center gap-2 text-secondary">
            <span className="w-2 h-2 rounded-full bg-gray-400" />
            <span>{todayCount} Today</span>
          </div>
        </div>
        <div className="text-sm text-secondary">
          Auto-refreshes every 30s
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
        <h2 className="text-lg font-semibold mb-4">Recent Sessions</h2>
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

function SessionCard({ session }: { session: Awaited<ReturnType<typeof listSessions>>[0] }) {
  const statusColors = getStatusColor(session.status);
  const stepNumber = session.stepsCompleted;

  return (
    <Link href={`/sessions/${session.sessionId}`} className="block">
      <div className="card overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
        {/* Image Preview */}
        <div className="aspect-video bg-gray-100 relative">
          {session.latestImageUrl ? (
            <Image
              src={session.latestImageUrl}
              alt="Session preview"
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>

        {/* Card Content */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium truncate">{truncateShop(session.shop)}</span>
            <span className={`badge ${statusColors.bg} ${statusColors.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
              {session.status}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-secondary">
              {session.currentStep ? `Step ${stepNumber}: ${getStepLabel(session.currentStep)}` : 'Starting...'}
            </span>
            <span className="text-gray-400">{formatTimeAgo(session.updatedAt)}</span>
          </div>

          {/* Progress Dots */}
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

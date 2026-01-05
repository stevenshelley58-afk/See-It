import { listSessions, getShopIndex } from '@/lib/gcs';
import { formatTimeAgo, formatDate, getStatusColor, truncateShop, formatDuration } from '@/lib/utils';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';

export const revalidate = 60;

interface PageProps {
    params: Promise<{ domain: string }>;
}

export default async function ShopDetailPage({ params }: PageProps) {
    const { domain } = await params;
    const decodedDomain = decodeURIComponent(domain);

    // Get all sessions for this shop
    const allSessions = await listSessions({ limit: 200 });
    const shopSessions = allSessions.filter(s => s.shop === decodedDomain);

    if (shopSessions.length === 0) {
        notFound();
    }

    const completed = shopSessions.filter(s => s.status === 'complete').length;
    const failed = shopSessions.filter(s => s.status === 'failed').length;
    const abandoned = shopSessions.filter(s => s.status === 'abandoned').length;
    const completionRate = Math.round((completed / shopSessions.length) * 100);

    // Group by day for activity visualization
    const dayActivity: Record<string, number> = {};
    for (const session of shopSessions) {
        const day = new Date(session.startedAt).toISOString().split('T')[0];
        dayActivity[day] = (dayActivity[day] || 0) + 1;
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/shops" className="text-secondary hover:text-primary transition-colors">
                    ← Back
                </Link>
            </div>

            {/* Shop Info */}
            <div className="card p-6">
                <h1 className="text-xl font-semibold">{decodedDomain}</h1>
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                        <div className="text-2xl font-bold">{shopSessions.length}</div>
                        <div className="text-sm text-secondary">Total Sessions</div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-green-600">{completed}</div>
                        <div className="text-sm text-secondary">Completed</div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-red-600">{failed}</div>
                        <div className="text-sm text-secondary">Failed</div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold">{completionRate}%</div>
                        <div className="text-sm text-secondary">Completion Rate</div>
                    </div>
                </div>
            </div>

            {/* Activity Heatmap */}
            <div className="card p-6">
                <h2 className="font-semibold mb-4">Recent Activity</h2>
                <div className="flex items-end gap-1 h-16">
                    {Object.entries(dayActivity)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .slice(-14)
                        .map(([day, count]) => {
                            const height = Math.min(100, (count / 5) * 100);
                            return (
                                <div key={day} className="flex flex-col items-center gap-1">
                                    <div
                                        className="w-4 bg-accent rounded-t"
                                        style={{ height: `${Math.max(4, height)}%` }}
                                        title={`${day}: ${count} sessions`}
                                    />
                                    <div className="text-xs text-gray-400 -rotate-45 origin-top-left whitespace-nowrap">
                                        {new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>

            {/* Sessions List */}
            <div className="card divide-y divide-gray-100">
                <div className="p-4 border-b border-gray-100">
                    <h2 className="font-semibold">Sessions</h2>
                </div>
                {shopSessions.map((session) => {
                    const statusColors = getStatusColor(session.status);
                    return (
                        <Link
                            key={session.sessionId}
                            href={`/sessions/${session.sessionId}`}
                            className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
                        >
                            {/* Thumbnail */}
                            <div className="w-16 h-12 rounded-lg bg-gray-100 relative flex-shrink-0 overflow-hidden">
                                {session.latestImageUrl ? (
                                    <Image
                                        src={session.latestImageUrl}
                                        alt="Session"
                                        fill
                                        className="object-cover"
                                        unoptimized
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                                        </svg>
                                    </div>
                                )}
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3">
                                    <span className={`badge ${statusColors.bg} ${statusColors.text}`}>
                                        {session.status}
                                    </span>
                                    <span className="text-sm text-secondary">
                                        {session.stepsCompleted} steps
                                    </span>
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                    {session.device && `${session.device} · `}
                                    {session.browser}
                                </div>
                            </div>

                            {/* Time */}
                            <div className="text-right text-sm text-secondary">
                                {formatDate(session.startedAt)}
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

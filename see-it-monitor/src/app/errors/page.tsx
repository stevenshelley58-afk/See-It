import { listSessions, getErrorSummary } from '@/lib/gcs';
import { truncateShop, formatTimeAgo } from '@/lib/utils';
import type { SessionMeta } from '@/lib/types';

export const revalidate = 60;

export default async function ErrorsPage() {
    const sessions = await listSessions({ limit: 200 });

    // Get sessions with errors - simplified view
    const sessionsWithErrors = sessions.filter(s => s.status === 'failed');

    // Mock error data based on failed sessions
    const errorCounts: Record<string, { count: number; shops: Set<string>; lastAt: string }> = {};

    for (const session of sessionsWithErrors) {
        const code = 'GEMINI_ERROR'; // Default error code for failed sessions
        if (!errorCounts[code]) {
            errorCounts[code] = { count: 0, shops: new Set(), lastAt: session.updatedAt };
        }
        errorCounts[code].count++;
        errorCounts[code].shops.add(session.shop);
        if (new Date(session.updatedAt) > new Date(errorCounts[code].lastAt)) {
            errorCounts[code].lastAt = session.updatedAt;
        }
    }

    const errors = Object.entries(errorCounts)
        .map(([code, data]) => ({
            code,
            count: data.count,
            affectedShops: Array.from(data.shops),
            lastOccurred: data.lastAt,
        }))
        .sort((a, b) => b.count - a.count);

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Error Dashboard</h1>
                <div className="text-sm text-secondary">
                    {sessionsWithErrors.length} failed sessions
                </div>
            </div>

            {/* Error Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {errors.map((error) => (
                    <div key={error.code} className="card p-6">
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="font-semibold text-red-600">{error.code}</div>
                                <div className="text-2xl font-bold mt-1">{error.count}</div>
                                <div className="text-sm text-secondary">occurrences</div>
                            </div>
                            <span className="badge badge-error">Error</span>
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-100">
                            <div className="text-xs text-secondary">
                                Last: {formatTimeAgo(error.lastOccurred)}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                                Shops: {error.affectedShops.slice(0, 2).map(truncateShop).join(', ')}
                                {error.affectedShops.length > 2 && ` +${error.affectedShops.length - 2}`}
                            </div>
                        </div>
                    </div>
                ))}

                {errors.length === 0 && (
                    <div className="card p-12 col-span-full text-center text-secondary">
                        🎉 No errors recorded
                    </div>
                )}
            </div>

            {/* Recent Failed Sessions */}
            <div className="card p-6">
                <h2 className="font-semibold mb-4">Recent Failed Sessions</h2>
                <div className="divide-y divide-gray-100">
                    {sessionsWithErrors.slice(0, 20).map((session) => (
                        <div key={session.sessionId} className="py-3 flex items-center justify-between">
                            <div>
                                <div className="font-medium">{truncateShop(session.shop)}</div>
                                <div className="text-sm text-secondary">
                                    Step {session.stepsCompleted} · {session.currentStep || 'Unknown step'}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm text-red-600">GEMINI_ERROR</div>
                                <div className="text-xs text-gray-400">{formatTimeAgo(session.updatedAt)}</div>
                            </div>
                        </div>
                    ))}

                    {sessionsWithErrors.length === 0 && (
                        <div className="py-8 text-center text-secondary">
                            No failed sessions to display
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

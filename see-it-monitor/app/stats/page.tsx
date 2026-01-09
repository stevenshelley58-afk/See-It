import { listSessions, getFunnelData, getShopStats, getErrorSummary } from '@/lib/gcs';
import { formatDuration, getStepLabel, truncateShop } from '@/lib/utils';
import Link from 'next/link';
import type { SessionMeta } from '@/lib/types';

export const revalidate = 60;

export default async function StatsPage() {
    const sessions = await listSessions({ limit: 200 });

    // We need full session data for stats - this is a simplified version
    // In production, you'd want to fetch all meta.json files
    const mockSessions: SessionMeta[] = sessions.map(s => ({
        sessionId: s.sessionId,
        shop: s.shop,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        status: s.status,
        steps: Array(s.stepsCompleted).fill(null).map((_, i) => ({
            step: (['room', 'mask', 'inpaint', 'placement', 'final'] as const)[i],
            status: 'success' as const,
            at: s.startedAt,
        })),
    }));

    const funnel = await getFunnelData(mockSessions);
    const shopStats = await getShopStats(mockSessions);
    const errors = await getErrorSummary(mockSessions);

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === 'complete').length;
    const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    return (
        <div className="space-y-8">
            <h1 className="text-2xl font-semibold">Stats Overview</h1>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card p-6">
                    <div className="text-3xl font-bold">{totalSessions}</div>
                    <div className="text-secondary text-sm">Total Sessions</div>
                </div>
                <div className="card p-6">
                    <div className="text-3xl font-bold text-green-600">{completedSessions}</div>
                    <div className="text-secondary text-sm">Completed</div>
                </div>
                <div className="card p-6">
                    <div className="text-3xl font-bold">{completionRate}%</div>
                    <div className="text-secondary text-sm">Completion Rate</div>
                </div>
                <div className="card p-6">
                    <div className="text-3xl font-bold">{shopStats.length}</div>
                    <div className="text-secondary text-sm">Active Shops</div>
                </div>
            </div>

            {/* Funnel */}
            <div className="card p-6">
                <h2 className="font-semibold mb-6">Drop-off Funnel</h2>
                <div className="space-y-4">
                    {funnel.map((step) => (
                        <div key={step.step} className="flex items-center gap-4">
                            <div className="w-24 text-sm text-secondary">{getStepLabel(step.step)}</div>
                            <div className="flex-1 funnel-bar">
                                <div
                                    className="funnel-fill"
                                    style={{ width: `${step.percentage}%` }}
                                />
                            </div>
                            <div className="w-20 text-right text-sm">
                                {step.percentage}% ({step.count})
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Shop Stats */}
            <div className="card p-6">
                <h2 className="font-semibold mb-6">Active Shops</h2>
                <div className="divide-y divide-gray-100">
                    {shopStats.slice(0, 10).map((shop) => (
                        <Link
                            key={shop.shop}
                            href={`/shops/${encodeURIComponent(shop.shop)}`}
                            className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
                        >
                            <div>
                                <div className="font-medium">{truncateShop(shop.shop)}</div>
                                <div className="text-sm text-secondary">
                                    {shop.totalSessions} sessions · {shop.completionRate}% complete
                                </div>
                            </div>
                            {shop.completionRate < 50 && (
                                <span className="text-amber-500">⚠️</span>
                            )}
                        </Link>
                    ))}
                </div>
            </div>

            {/* Error Summary */}
            {errors.length > 0 && (
                <div className="card p-6">
                    <h2 className="font-semibold mb-6">Recent Errors</h2>
                    <div className="divide-y divide-gray-100">
                        {errors.slice(0, 5).map((error) => (
                            <div key={error.code} className="py-3">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-red-600">{error.code}</span>
                                    <span className="text-sm text-secondary">{error.count} occurrences</span>
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                    Affected: {error.affectedShops.slice(0, 3).map(truncateShop).join(', ')}
                                    {error.affectedShops.length > 3 && ` +${error.affectedShops.length - 3} more`}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

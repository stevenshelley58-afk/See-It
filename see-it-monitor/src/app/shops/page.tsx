import { listSessions, listAllShops } from '@/lib/gcs';
import { truncateShop, formatTimeAgo } from '@/lib/utils';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export default async function ShopsPage() {
    // Get shops from index files (shows shops even with 0 sessions)
    const shopIndexes = await listAllShops();
    
    // Also get sessions to merge data
    const sessions = await listSessions({ limit: 200 });
    
    // Group sessions by shop for stats
    const shopMap = new Map<string, typeof sessions>();
    for (const session of sessions) {
        const existing = shopMap.get(session.shop) || [];
        existing.push(session);
        shopMap.set(session.shop, existing);
    }

    // Merge shop indexes with session data
    const allShopDomains = new Set<string>();
    shopIndexes.forEach(idx => allShopDomains.add(idx.shop));
    sessions.forEach(s => allShopDomains.add(s.shop));

    const shops = Array.from(allShopDomains).map(shop => {
        const shopIndex = shopIndexes.find(idx => idx.shop === shop);
        const shopSessions = shopMap.get(shop) || [];
        
        const completed = shopSessions.filter(s => s.status === 'complete').length;
        const failed = shopSessions.filter(s => s.status === 'failed').length;
        const lastSession = shopSessions[0] || shopIndex?.sessions[0];
        
        // Use shop index data if available, otherwise use session data
        const totalSessions = shopIndex?.totalSessions || shopSessions.length;

        return {
            shop,
            totalSessions,
            completedSessions: completed,
            failedSessions: failed,
            completionRate: totalSessions > 0 ? Math.round((completed / totalSessions) * 100) : 0,
            lastActivity: lastSession?.startedAt || '',
        };
    }).sort((a, b) => b.totalSessions - a.totalSessions);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Shops</h1>
                <div className="text-sm text-secondary">
                    {shops.length} active shops
                </div>
            </div>

            <div className="card divide-y divide-gray-100">
                {shops.map((shop) => (
                    <Link
                        key={shop.shop}
                        href={`/shops/${encodeURIComponent(shop.shop)}`}
                        className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                    >
                        <div>
                            <div className="font-medium">{truncateShop(shop.shop)}</div>
                            <div className="text-sm text-secondary mt-1">
                                {shop.totalSessions} sessions · {shop.completedSessions} complete · {shop.failedSessions} failed
                            </div>
                        </div>
                        <div className="text-right">
                            <div className={`text-lg font-semibold ${shop.completionRate >= 50 ? 'text-green-600' : 'text-amber-600'}`}>
                                {shop.completionRate}%
                            </div>
                            <div className="text-xs text-gray-400">
                                {formatTimeAgo(shop.lastActivity)}
                            </div>
                        </div>
                    </Link>
                ))}

                {shops.length === 0 && (
                    <div className="p-12 text-center text-secondary">
                        No shops with sessions yet
                    </div>
                )}
            </div>
        </div>
    );
}

import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';
import { desc, sql } from 'drizzle-orm';
import { truncateShop, formatTimeAgo } from '@/lib/utils';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export default async function ShopsPage() {
    // Aggregate session stats by shop_domain from the database
    // We group by shop_domain and calculate counts/timestamps
    const shopsData = await db
        .select({
            shop: sessions.shopDomain,
            totalSessions: sql<number>`count(*)`,
            completedSessions: sql<number>`count(*) filter (where ${sessions.status} = 'completed')`,
            // Check for various failure statuses typically used
            failedSessions: sql<number>`count(*) filter (where ${sessions.status} = 'error' or ${sessions.status} = 'failed')`,
            lastActivity: sql<string>`max(${sessions.startedAt})`,
        })
        .from(sessions)
        .groupBy(sessions.shopDomain)
        .orderBy(sql`max(${sessions.startedAt}) desc`);

    const shops = shopsData.map(shop => {
        const total = Number(shop.totalSessions);
        const completed = Number(shop.completedSessions);

        return {
            shop: shop.shop,
            totalSessions: total,
            completedSessions: completed,
            failedSessions: Number(shop.failedSessions),
            completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
            lastActivity: shop.lastActivity,
        };
    });

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
                                {shop.totalSessions} sessions · {shop.completedSessions} complete
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

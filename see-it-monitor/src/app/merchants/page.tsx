import { db } from '@/lib/db/client';
import { shops } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import Link from 'next/link';
import { truncateShop } from '@/lib/utils';
import { deriveSessionsFromAnalytics, listAllShops } from '@/lib/gcs';

export const dynamic = 'force-dynamic';

export default async function MerchantsPage() {
  type MerchantRow = {
    id: string;
    domain: string;
    totalSessions: number;
    completedSessions: number;
    lastSessionAt: Date | null;
    // Fields used by "needs attention" panel / badges
    needsAttention: boolean;
    installedAt: Date | null;
    isEmbedded: boolean;
    arEnabledProducts: number;
    attentionReason: string | null;
  };

  let allShops: MerchantRow[] = [];
  let source: 'db' | 'gcs' = 'db';

  try {
    allShops = (await db.select().from(shops).orderBy(desc(shops.lastSessionAt))) as MerchantRow[];
  } catch (err) {
    // Production can be "no DB tables yet" while we’re still ingesting sessions to GCS.
    // Never hard-crash the page — fall back to GCS shop index files.
    console.warn('[MerchantsPage] DB unavailable, falling back to GCS:', err);
    source = 'gcs';

    const indexes = await listAllShops();

    if (indexes.length > 0) {
      allShops = indexes
        .map((idx) => {
          const completedSessions = idx.sessions.filter((s) => s.status === 'complete').length;
          const lastStartedAt = idx.sessions[0]?.startedAt ? new Date(idx.sessions[0].startedAt) : null;

          return {
            id: idx.shop,
            domain: idx.shop,
            totalSessions: idx.totalSessions,
            completedSessions,
            lastSessionAt: lastStartedAt,
            needsAttention: false,
            installedAt: null,
            isEmbedded: false,
            arEnabledProducts: 0,
            attentionReason: null,
          };
        })
        .sort((a, b) => (b.lastSessionAt?.getTime() || 0) - (a.lastSessionAt?.getTime() || 0));
    } else {
      // If the session-meta index isn't present, fall back to analytics event logs (what the extension sends).
      const derived = await deriveSessionsFromAnalytics({ lookbackMs: 7 * 24 * 60 * 60 * 1000 });

      const byShop = new Map<
        string,
        { total: number; completed: number; lastAt: Date | null }
      >();

      for (const s of derived.sessions) {
        const key = s.shopDomain;
        const existing = byShop.get(key) || { total: 0, completed: 0, lastAt: null };
        existing.total += 1;
        if (s.status === 'completed') existing.completed += 1;
        const last = new Date(s.updatedAt);
        if (!existing.lastAt || last.getTime() > existing.lastAt.getTime()) existing.lastAt = last;
        byShop.set(key, existing);
      }

      allShops = Array.from(byShop.entries())
        .map(([domain, stats]) => ({
          id: domain,
          domain,
          totalSessions: stats.total,
          completedSessions: stats.completed,
          lastSessionAt: stats.lastAt,
          needsAttention: false,
          installedAt: null,
          isEmbedded: false,
          arEnabledProducts: 0,
          attentionReason: null,
        }))
        .sort((a, b) => (b.lastSessionAt?.getTime() || 0) - (a.lastSessionAt?.getTime() || 0));
    }
  }

  const needsAttention = allShops.filter(
    (shop) =>
      shop.needsAttention ||
      (shop.installedAt && !shop.isEmbedded) ||
      (shop.isEmbedded && shop.arEnabledProducts === 0)
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Merchants</h1>

      {source === 'gcs' && (
        <div className="card p-4 border-blue-200 bg-blue-50 text-blue-900">
          <div className="font-medium">Using GCS fallback</div>
          <div className="text-sm text-blue-800 mt-1">
            Database tables may not be ready yet. Showing shops from session indexes in GCS.
          </div>
        </div>
      )}

      {needsAttention.length > 0 && (
        <div className="card p-6 border-amber-200 bg-amber-50">
          <h2 className="font-semibold mb-4 text-amber-900">Needs Attention</h2>
          <div className="space-y-3">
            {needsAttention.map((shop) => (
              <Link key={shop.id} href={`/merchants/${shop.domain}`} className="block p-3 bg-white rounded hover:shadow transition">
                <div className="font-medium">{truncateShop(shop.domain)}</div>
                <div className="text-sm text-secondary mt-1">
                  {!shop.isEmbedded && 'Not embedded'}
                  {shop.isEmbedded && shop.arEnabledProducts === 0 && 'No products prepared'}
                  {shop.needsAttention && shop.attentionReason}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card divide-y">
        {allShops.map((shop) => (
          <Link key={shop.id} href={`/merchants/${shop.domain}`} className="block p-4 hover:bg-gray-50 transition">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{truncateShop(shop.domain)}</div>
                <div className="text-sm text-secondary mt-1">
                  {shop.totalSessions} sessions • {shop.completedSessions} completed
                  {shop.lastSessionAt && ` • Last: ${new Date(shop.lastSessionAt).toLocaleDateString()}`}
                </div>
              </div>
              <div className="text-right">
                <div className={`badge ${shop.isEmbedded ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                  {shop.isEmbedded ? 'Embedded' : 'Not Embedded'}
                </div>
              </div>
            </div>
          </Link>
        ))}

        {allShops.length === 0 && (
          <div className="p-6 text-sm text-secondary">
            No shops yet. If you expect data, check the GCS health endpoint at <Link className="underline" href="/api/health">/api/health</Link>.
          </div>
        )}
      </div>
    </div>
  );
}

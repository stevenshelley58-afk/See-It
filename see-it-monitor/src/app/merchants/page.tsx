import { db } from '@/lib/db/client';
import { shops } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { truncateShop } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function MerchantsPage() {
  const allShops = await db.select().from(shops).orderBy(desc(shops.lastSessionAt));
  
  const needsAttention = allShops.filter(shop => 
    shop.needsAttention || 
    (shop.installedAt && !shop.isEmbedded) ||
    (shop.isEmbedded && shop.arEnabledProducts === 0)
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Merchants</h1>

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
      </div>
    </div>
  );
}

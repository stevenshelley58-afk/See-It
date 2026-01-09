import { db } from '@/lib/db/client';
import { prepEvents } from '@/lib/db/schema';
import { desc, and, like, sql, or } from 'drizzle-orm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

interface PageProps {
  searchParams: Promise<{
    shopId?: string;
    productId?: string;
    eventType?: string;
    search?: string;
  }>;
}

export default async function PrepMonitorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const shopId = params.shopId;
  const productId = params.productId;
  const eventType = params.eventType;
  const search = params.search;

  // Build query conditions
  const conditions = [];
  if (shopId) {
    conditions.push(like(prepEvents.shopId, `%${shopId}%`));
  }
  if (productId) {
    conditions.push(like(prepEvents.productId, `%${productId}%`));
  }
  if (eventType && eventType !== 'all') {
    conditions.push(like(prepEvents.eventType, `%${eventType}%`));
  }
  if (search) {
    conditions.push(
      or(
        like(prepEvents.assetId, `%${search}%`),
        like(prepEvents.productId, `%${search}%`),
        like(prepEvents.shopId, `%${search}%`)
      )!
    );
  }

  // Get recent prep events (grouped by assetId, showing latest event per asset)
  const recentEvents = await db
    .select()
    .from(prepEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(prepEvents.timestamp))
    .limit(200);

  // Group by assetId to show unique assets
  const assetsMap = new Map<string, typeof recentEvents[0]>();
  for (const event of recentEvents) {
    if (!assetsMap.has(event.assetId)) {
      assetsMap.set(event.assetId, event);
    }
  }

  const uniqueAssets = Array.from(assetsMap.values());

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Product Prep Monitor</h1>
        <p className="text-gray-600">Audit log for product preparation events</p>
      </div>

      {/* Simple filters */}
      <div className="mb-4 flex gap-4">
        <input
          type="text"
          placeholder="Search asset/product/shop ID..."
          defaultValue={search}
          className="px-3 py-2 border rounded"
        />
        <input
          type="text"
          placeholder="Event type filter..."
          defaultValue={eventType}
          className="px-3 py-2 border rounded"
        />
      </div>

      {/* Assets list */}
      <div className="space-y-2">
        {uniqueAssets.length === 0 ? (
          <p className="text-gray-500">No prep events found</p>
        ) : (
          uniqueAssets.map((event) => (
            <Link
              key={event.id}
              href={`/monitor/prep/${event.assetId}`}
              className="block p-4 border rounded hover:bg-gray-50"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-mono text-sm text-gray-600">
                    Asset: {event.assetId.substring(0, 8)}...
                  </div>
                  <div className="font-mono text-sm text-gray-600">
                    Product: {event.productId}
                  </div>
                  <div className="mt-1">
                    <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                      {event.eventType}
                    </span>
                    <span className={`ml-2 inline-block px-2 py-1 rounded text-xs ${
                      event.actorType === 'system' 
                        ? 'bg-gray-100 text-gray-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {event.actorType}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  {new Date(event.timestamp).toLocaleString()}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

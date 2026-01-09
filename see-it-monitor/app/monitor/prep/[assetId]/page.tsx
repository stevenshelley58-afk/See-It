import { db } from '@/lib/db/client';
import { prepEvents } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getPrepEventsByAssetId } from '@/lib/db/queries';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

interface PageProps {
  params: Promise<{
    assetId: string;
  }>;
}

export default async function PrepDetailPage({ params }: PageProps) {
  const { assetId } = await params;

  // Get all events for this asset
  const events = await getPrepEventsByAssetId(assetId);

  if (events.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <Link href="/monitor/prep" className="text-blue-600 hover:underline mb-4 inline-block">
          ← Back to Prep Monitor
        </Link>
        <h1 className="text-2xl font-bold mb-4">Prep Detail</h1>
        <p className="text-gray-500">No events found for asset: {assetId}</p>
      </div>
    );
  }

  const latestEvent = events[0];

  return (
    <div className="container mx-auto p-6">
      <Link href="/monitor/prep" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back to Prep Monitor
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Prep Detail</h1>
        <div className="text-sm text-gray-600 space-y-1">
          <div>Asset ID: <span className="font-mono">{assetId}</span></div>
          <div>Product ID: <span className="font-mono">{latestEvent.productId}</span></div>
          <div>Shop ID: <span className="font-mono">{latestEvent.shopId}</span></div>
        </div>
      </div>

      {/* Tabs placeholder - will implement in next step */}
      <div className="mb-4 border-b">
        <div className="flex gap-4">
          <button className="px-4 py-2 border-b-2 border-blue-600 font-semibold">
            Prep Timeline
          </button>
          <button className="px-4 py-2 text-gray-600 hover:text-gray-900">
            Cutout Inspection
          </button>
          <button className="px-4 py-2 text-gray-600 hover:text-gray-900">
            Field Audit
          </button>
          <button className="px-4 py-2 text-gray-600 hover:text-gray-900">
            Classification
          </button>
          <button className="px-4 py-2 text-gray-600 hover:text-gray-900">
            Merchant Notes
          </button>
          <button className="px-4 py-2 text-gray-600 hover:text-gray-900">
            Hidden Render Intelligence
          </button>
        </div>
      </div>

      {/* Prep Timeline - chronological event stream */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold mb-4">Prep Timeline</h2>
        {events.map((event) => (
          <div key={event.id} className="border rounded p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="font-semibold">{event.eventType}</span>
                <span className={`ml-2 inline-block px-2 py-1 rounded text-xs ${
                  event.actorType === 'system' 
                    ? 'bg-gray-100 text-gray-800' 
                    : 'bg-green-100 text-green-800'
                }`}>
                  {event.actorType}
                </span>
                {event.actorId && (
                  <span className="ml-2 text-xs text-gray-500">
                    by {event.actorId}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-500">
                {new Date(event.timestamp).toLocaleString()}
              </div>
            </div>
            <div className="mt-2">
              <details className="text-sm">
                <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                  View payload
                </summary>
                <pre className="mt-2 p-2 bg-gray-50 rounded overflow-auto text-xs">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

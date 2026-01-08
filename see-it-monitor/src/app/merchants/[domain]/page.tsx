import Link from 'next/link';
import { db } from '@/lib/db/client';
import { sessions, shops } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { deriveSessionsFromAnalytics, listSessions } from '@/lib/gcs';
import { truncateShop } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Props = {
  params: { domain: string };
};

export default async function MerchantDetailPage({ params }: Props) {
  const domain = decodeURIComponent(params.domain);

  let source: 'db' | 'gcs' | 'gcs_analytics' = 'db';
  let recentSessions: Array<{
    sessionId: string;
    status: string;
    updatedAt: string;
    startedAt: string;
    currentStep: string | null;
    stepsCompleted: number;
  }> = [];

  // Prefer DB when available
  try {
    const shopRow = await db.select().from(shops).where(eq(shops.domain, domain)).limit(1);
    const shop = shopRow[0];
    if (shop) {
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.shopId, shop.id))
        .orderBy(desc(sessions.updatedAt))
        .limit(50);

      recentSessions = rows.map((s) => ({
        sessionId: s.sessionId,
        status: s.status,
        updatedAt: s.updatedAt?.toISOString() || s.startedAt?.toISOString() || new Date().toISOString(),
        startedAt: s.startedAt?.toISOString() || new Date().toISOString(),
        currentStep: s.currentStep,
        stepsCompleted: s.stepsCompleted || 0,
      }));
    }
  } catch (err) {
    console.warn('[MerchantDetailPage] DB unavailable, falling back:', err);
    source = 'gcs';
  }

  // Fall back to session-meta logs if present
  if (recentSessions.length === 0) {
    try {
      const gcsSessions = await listSessions({ limit: 500, offset: 0, shop: domain });
      if (gcsSessions.length > 0) {
        source = 'gcs';
        recentSessions = gcsSessions.map((s) => ({
          sessionId: s.sessionId,
          status: s.status === 'complete' ? 'completed' : s.status,
          updatedAt: s.updatedAt,
          startedAt: s.startedAt,
          currentStep: s.currentStep,
          stepsCompleted: s.stepsCompleted,
        }));
      }
    } catch (err) {
      console.warn('[MerchantDetailPage] listSessions failed, falling back to analytics:', err);
    }
  }

  // Final fallback: analytics event logs (what the extension posts)
  if (recentSessions.length === 0) {
    source = 'gcs_analytics';
    const derived = await deriveSessionsFromAnalytics({ lookbackMs: 7 * 24 * 60 * 60 * 1000 });
    recentSessions = derived.sessions
      .filter((s) => s.shopDomain === domain)
      .slice(0, 50)
      .map((s) => ({
        sessionId: s.sessionId,
        status: s.status,
        updatedAt: s.updatedAt,
        startedAt: s.startedAt,
        currentStep: s.currentStep,
        stepsCompleted: s.stepsCompleted,
      }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{truncateShop(domain)}</h1>
          <div className="text-sm text-secondary mt-1">{domain}</div>
        </div>
        <Link className="text-sm underline" href="/merchants">
          Back to merchants
        </Link>
      </div>

      {source !== 'db' && (
        <div className="card p-4 border-blue-200 bg-blue-50 text-blue-900">
          <div className="font-medium">Fallback mode</div>
          <div className="text-sm text-blue-800 mt-1">
            Showing sessions from {source === 'gcs_analytics' ? 'analytics event logs (GCS)' : 'GCS session logs'}.
          </div>
        </div>
      )}

      <div className="card divide-y">
        {recentSessions.map((s) => (
          <Link key={s.sessionId} href={`/sessions/${encodeURIComponent(s.sessionId)}`} className="block p-4 hover:bg-gray-50 transition">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.sessionId}</div>
                <div className="text-sm text-secondary mt-1">
                  {s.status}
                  {s.currentStep ? ` • ${s.currentStep}` : ''} • {s.stepsCompleted} steps • Updated{' '}
                  {new Date(s.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="text-sm text-secondary">{new Date(s.startedAt).toLocaleDateString()}</div>
            </div>
          </Link>
        ))}

        {recentSessions.length === 0 && (
          <div className="p-6 text-sm text-secondary">
            No sessions found for this shop yet.
          </div>
        )}
      </div>
    </div>
  );
}


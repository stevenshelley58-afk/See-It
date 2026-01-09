import { db } from '@/lib/db/client';
import { errors } from '@/lib/db/schema';
import { deriveSessionsFromAnalytics } from '@/lib/gcs';
import { desc, sql } from 'drizzle-orm';
import { truncateShop, formatTimeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function ErrorsPage() {
  type DbErrorRow = typeof errors.$inferSelect;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let allErrors: DbErrorRow[] = [];
  let source: 'db' | 'gcs_analytics' = 'db';
  let loadError: string | null = null;

  try {
    allErrors = await db
      .select()
      .from(errors)
      .orderBy(desc(errors.occurredAt))
      .limit(200);
  } catch (err) {
    // DB unavailable — fall back to derived errors from analytics batches stored in GCS.
    source = 'gcs_analytics';
    loadError = err instanceof Error ? err.message : String(err);

    // Match the Control Room "Errors Today" definition (midnight → now).
    const derived = await deriveSessionsFromAnalytics({ lookbackMs: 24 * 60 * 60 * 1000 });
    allErrors = derived.recentErrors.slice(0, 200).map((e) => {
      const occurredAt = new Date(e.occurredAt);
      return {
        id: e.id as any,
        sessionId: null,
        shopId: null,
        errorType: 'client',
        errorCode: e.errorCode,
        errorMessage: e.errorMessage,
        severity: (e.severity as any) || 'error',
        step: null,
        isUserFacing: true,
        deviceType: null,
        os: null,
        browser: null,
        userAgent: null,
        occurredAt,
      } as DbErrorRow;
    });
  }

  // If DB returns no errors but we have recent error events in GCS, show those (common when DB writes are failing).
  if (allErrors.length === 0 && source === 'db') {
    // Match the Control Room "Errors Today" definition (midnight → now).
    const derived = await deriveSessionsFromAnalytics({ lookbackMs: 24 * 60 * 60 * 1000 });
    if (derived.recentErrors.length > 0) {
      source = 'gcs_analytics';
      loadError = loadError || 'DB returned 0 errors; showing GCS-derived errors from analytics backups.';
      allErrors = derived.recentErrors.slice(0, 200).map((e) => {
        const occurredAt = new Date(e.occurredAt);
        return {
          id: e.id as any,
          sessionId: null,
          shopId: null,
          errorType: 'client',
          errorCode: e.errorCode,
          errorMessage: e.errorMessage,
          severity: (e.severity as any) || 'error',
          step: null,
          isUserFacing: true,
          deviceType: null,
          os: null,
          browser: null,
          userAgent: null,
          occurredAt,
        } as DbErrorRow;
      });
    }
  }

  const todayErrors = allErrors.filter((e) => e.occurredAt >= today);

  // Group by error code
  const errorCounts: Record<string, { count: number; shops: Set<string>; lastAt: Date; severity: string }> = {};

  for (const error of allErrors) {
    const code = error.errorCode;
    if (!errorCounts[code]) {
      errorCounts[code] = { count: 0, shops: new Set(), lastAt: error.occurredAt, severity: error.severity };
    }
    errorCounts[code].count++;
    if (error.shopId) {
      // We'd need to join shops table to get domain, but for now just track count
      errorCounts[code].shops.add('shop');
    }
    if (error.occurredAt > errorCounts[code].lastAt) {
      errorCounts[code].lastAt = error.occurredAt;
    }
  }

  const errorSummary = Object.entries(errorCounts)
    .map(([code, data]) => ({
      code,
      count: data.count,
      affectedShops: data.shops.size,
      lastOccurred: data.lastAt.toISOString(),
      severity: data.severity,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Error Dashboard</h1>
        <div className="text-sm text-secondary">
          {todayErrors.length} today • {allErrors.length} total
        </div>
      </div>

      {source !== 'db' && (
        <div className="card p-4 border border-amber-200 bg-amber-50">
          <div className="font-semibold text-amber-900">DB unavailable — showing GCS-derived errors</div>
          {loadError && (
            <div className="text-xs text-amber-900 mt-1 font-mono break-all">{loadError}</div>
          )}
          <div className="text-sm text-amber-800 mt-2">
            This page will switch to DB-backed errors automatically once the monitor database is configured and migrated.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {errorSummary.map((error) => (
          <div key={error.code} className="card p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className={`font-semibold ${
                  error.severity === 'critical' ? 'text-red-600' :
                  error.severity === 'error' ? 'text-orange-600' : 'text-yellow-600'
                }`}>
                  {error.code}
                </div>
                <div className="text-2xl font-bold mt-1">{error.count}</div>
                <div className="text-sm text-secondary">occurrences</div>
              </div>
              <span className={`badge ${
                error.severity === 'critical' ? 'bg-red-100 text-red-700' :
                error.severity === 'error' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
                {error.severity}
              </span>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-xs text-secondary">
                Last: {formatTimeAgo(error.lastOccurred)}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {error.affectedShops} shop{error.affectedShops !== 1 ? 's' : ''} affected
              </div>
            </div>
          </div>
        ))}

        {errorSummary.length === 0 && (
          <div className="card p-12 col-span-full text-center text-secondary">
            🎉 No errors recorded
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-4">Recent Errors</h2>
        <div className="divide-y divide-gray-100">
          {todayErrors.slice(0, 50).map((error) => (
            <div key={error.id} className="py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{error.errorCode}</div>
                <div className="text-sm text-secondary mt-1">
                  {error.errorMessage.substring(0, 100)}
                  {error.step && ` · Step: ${error.step}`}
                </div>
              </div>
              <div className="text-right">
                <span className={`badge ${
                  error.severity === 'critical' ? 'bg-red-100 text-red-700' :
                  error.severity === 'error' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {error.severity}
                </span>
                <div className="text-xs text-gray-400 mt-1">{formatTimeAgo(error.occurredAt.toISOString())}</div>
              </div>
            </div>
          ))}

          {todayErrors.length === 0 && (
            <div className="py-8 text-center text-secondary">
              No errors to display
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';
import { gte } from 'drizzle-orm';
import JourneyCharts from './JourneyCharts';

export const dynamic = 'force-dynamic';

export default async function JourneyPage() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let allSessions: Array<{ currentStep: string | null; status: string }> = [];
  let dbSchemaBehind = false;

  try {
    // Only select columns needed for the funnel (prevents crashes if DB schema is behind)
    allSessions = await db
      .select({
        currentStep: sessions.currentStep,
        status: sessions.status,
      })
      .from(sessions)
      .where(gte(sessions.startedAt, sevenDaysAgo));
  } catch (err) {
    // Common in prod when migrations haven’t been applied yet.
    dbSchemaBehind = true;
    allSessions = [];
    console.error('[Journey] Failed to query sessions:', err);
  }

  // Calculate funnel
  const total = allSessions.length;
  const roomCapture = allSessions.filter(s => s.currentStep && ['room_capture', 'mask', 'inpaint', 'placement', 'final'].includes(s.currentStep)).length;
  const mask = allSessions.filter(s => s.currentStep && ['mask', 'inpaint', 'placement', 'final'].includes(s.currentStep)).length;
  const inpaint = allSessions.filter(s => s.currentStep && ['inpaint', 'placement', 'final'].includes(s.currentStep)).length;
  const placement = allSessions.filter(s => s.currentStep && ['placement', 'final'].includes(s.currentStep)).length;
  const completed = allSessions.filter(s => s.status === 'completed').length;

  const funnelData = [
    { step: 'Room Capture', count: roomCapture, percentage: total > 0 ? Math.round((roomCapture / total) * 100) : 0 },
    { step: 'Mask', count: mask, percentage: total > 0 ? Math.round((mask / total) * 100) : 0 },
    { step: 'Inpaint', count: inpaint, percentage: total > 0 ? Math.round((inpaint / total) * 100) : 0 },
    { step: 'Placement', count: placement, percentage: total > 0 ? Math.round((placement / total) * 100) : 0 },
    { step: 'Completed', count: completed, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 },
  ];

  const dropOffs = [
    { from: 'Room Capture', to: 'Mask', dropped: roomCapture - mask, percentage: roomCapture > 0 ? Math.round(((roomCapture - mask) / roomCapture) * 100) : 0 },
    { from: 'Mask', to: 'Inpaint', dropped: mask - inpaint, percentage: mask > 0 ? Math.round(((mask - inpaint) / mask) * 100) : 0 },
    { from: 'Inpaint', to: 'Placement', dropped: inpaint - placement, percentage: inpaint > 0 ? Math.round(((inpaint - placement) / inpaint) * 100) : 0 },
    { from: 'Placement', to: 'Completed', dropped: placement - completed, percentage: placement > 0 ? Math.round(((placement - completed) / placement) * 100) : 0 },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">User Journey (Last 7 Days)</h1>

      {dbSchemaBehind && (
        <div className="card p-4 border border-yellow-200 bg-yellow-50 text-yellow-900">
          <div className="font-medium">Database migrations needed</div>
          <div className="text-sm mt-1 text-yellow-800">
            This environment’s Postgres schema is behind the code. Run the migration endpoint once to add the Flight Recorder columns/tables.
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="font-semibold mb-4">Funnel</h2>
        <JourneyCharts funnelData={funnelData} />
        <div className="mt-4 space-y-2">
          {funnelData.map((item) => (
            <div key={item.step} className="flex items-center justify-between">
              <span>{item.step}</span>
              <span className="font-medium">{item.count} ({item.percentage}%)</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-4">Drop-off Analysis</h2>
        <div className="space-y-3">
          {dropOffs.map((drop) => (
            <div key={drop.from} className="p-3 bg-gray-50 rounded">
              <div className="font-medium">{drop.from} → {drop.to}</div>
              <div className="text-sm text-secondary mt-1">
                {drop.dropped} dropped ({drop.percentage}%)
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


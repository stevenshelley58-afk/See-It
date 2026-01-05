import { db } from '@/lib/db/client';
import { sessions, sessionSteps } from '@/lib/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export const dynamic = 'force-dynamic';

export default async function JourneyPage() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const allSessions = await db
    .select()
    .from(sessions)
    .where(gte(sessions.startedAt, sevenDaysAgo));

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

      <div className="card p-6">
        <h2 className="font-semibold mb-4">Funnel</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={funnelData}>
            <XAxis dataKey="step" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
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

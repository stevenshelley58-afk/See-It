import { NextResponse } from 'next/server';
import { evaluateAlerts } from '@/lib/alerts/evaluator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const alerts = await evaluateAlerts();
    
    // Format as active alerts (in a real system, you'd store these in DB)
    const activeAlerts = alerts.map((alert, index) => ({
      id: `alert_${Date.now()}_${index}`,
      ruleId: alert.ruleId,
      message: alert.message,
      severity: alert.severity || 'error',
      affectedShops: alert.affectedShops,
      createdAt: new Date().toISOString(),
    }));
    
    return NextResponse.json(activeAlerts);
  } catch (error) {
    // Avoid breaking the dashboard if alerts can't be computed (e.g., DB not ready).
    console.warn('[Alerts API] Failed to evaluate alerts, returning empty list:', error);
    return NextResponse.json([]);
  }
}

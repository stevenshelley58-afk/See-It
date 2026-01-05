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
    console.error('[Alerts API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch alerts' },
      { status: 500 }
    );
  }
}

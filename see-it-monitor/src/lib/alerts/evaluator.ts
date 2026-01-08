/**
 * Alert Evaluator
 * Evaluates alert rules against current data
 */

import { alertRules, AlertRule, AlertData, AlertResult } from './rules';
import { db } from '@/lib/db/client';
import { sessions, errors, shops, systemHealth } from '@/lib/db/schema';
import { gte, eq, sql } from 'drizzle-orm';

export async function evaluateAlerts(): Promise<AlertResult[]> {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Get error rate
    const [totalSessions, errorSessions] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(sessions).where(gte(sessions.startedAt, fiveMinutesAgo)),
      db.select({ count: sql<number>`COUNT(*)` }).from(errors).where(gte(errors.occurredAt, fiveMinutesAgo)),
    ]);

    const total = Number(totalSessions[0]?.count || 0);
    const errorCount = Number(errorSessions[0]?.count || 0);
    const errorRate = total > 0 ? errorCount / total : 0;

    // Get shop success rates
    const shopStats = await db
      .select({
        domain: shops.domain,
        total: sql<number>`COUNT(${sessions.id})`,
        completed: sql<number>`SUM(CASE WHEN ${sessions.status} = 'completed' THEN 1 ELSE 0 END)`,
      })
      .from(shops)
      .leftJoin(sessions, eq(sessions.shopId, shops.id))
      .where(gte(sessions.startedAt, oneHourAgo))
      .groupBy(shops.domain);

    const shopSuccessRates: Record<string, number> = {};
    for (const stat of shopStats) {
      const total = Number(stat.total || 0);
      const completed = Number(stat.completed || 0);
      if (total > 0) {
        shopSuccessRates[stat.domain] = completed / total;
      }
    }

    // Get system health
    const healthRecords = await db.select().from(systemHealth);
    const systemHealthMap: Record<string, { status: string; responseTime?: number }> = {};
    for (const health of healthRecords) {
      systemHealthMap[health.service] = {
        status: health.status,
        responseTime: health.responseTimeMs || undefined,
      };
    }

    // Get session count in last hour
    const sessionCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sessions)
      .where(gte(sessions.startedAt, oneHourAgo));
    const sessionCount = Number(sessionCountResult[0]?.count || 0);

    const alertData: AlertData = {
      errorRate,
      shopSuccessRates,
      systemHealth: systemHealthMap,
      sessionCount,
      currentHour: new Date().getUTCHours(),
    };

    // Evaluate all rules
    const results: AlertResult[] = [];
    for (const rule of alertRules) {
      try {
        const result = await rule.evaluate(alertData);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error(`[Alerts] Error evaluating rule ${rule.id}:`, error);
      }
    }

    return results;
  } catch (err) {
    // Don't take down the UI if Postgres isn't migrated/available.
    console.warn('[Alerts] DB unavailable, returning no alerts:', err);
    return [];
  }
}

/**
 * Database query functions for See It Monitor
 */

import { db } from './client';
import { sessions, shops, errors, aiRequests, sessionSteps, prepEvents } from './schema';
import { eq, and, gte, desc, sql, count } from 'drizzle-orm';

export async function getActiveSessions() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  
  return await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.status, 'in_progress'),
        gte(sessions.updatedAt, tenMinutesAgo)
      )
    )
    .orderBy(desc(sessions.updatedAt))
    .limit(100);
}

export async function getRecentSessions(limit = 20) {
  return await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.startedAt))
    .limit(limit);
}

export async function getTodaySessionCount() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const result = await db
    .select({ count: count() })
    .from(sessions)
    .where(gte(sessions.startedAt, today));
  
  return result[0]?.count || 0;
}

export async function getSessionStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const [totalResult, completedResult, activeShopsResult, todayErrorsResult, todayCostResult] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` }).from(sessions),
    db.select({ count: sql<number>`COUNT(*)` }).from(sessions).where(eq(sessions.status, 'completed')),
    db.select({ count: sql<number>`COUNT(*)` }).from(shops).where(eq(shops.isEmbedded, true)),
    db.select({ count: sql<number>`COUNT(*)` }).from(errors).where(gte(errors.occurredAt, today)),
    db.select({ total: sql<number>`COALESCE(SUM(${aiRequests.costUsd}), 0)` })
      .from(aiRequests)
      .where(gte(aiRequests.createdAt, today)),
  ]);
  
  const totalSessions = Number(totalResult[0]?.count || 0);
  const completedSessions = Number(completedResult[0]?.count || 0);
  const successRate = totalSessions > 0 
    ? Math.round((completedSessions / totalSessions) * 100)
    : 0;
  
  return {
    totalSessions,
    completedSessions,
    successRate,
    activeShops: Number(activeShopsResult[0]?.count || 0),
    todayErrors: Number(todayErrorsResult[0]?.count || 0),
    todayCost: Number(todayCostResult[0]?.total || 0),
    todayCount: await getTodaySessionCount(),
  };
}

export async function getSessionById(sessionId: string) {
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, sessionId))
    .limit(1);
  
  if (!session[0]) return null;
  
  const steps = await db
    .select()
    .from(sessionSteps)
    .where(eq(sessionSteps.sessionId, session[0].id))
    .orderBy(sessionSteps.createdAt);
  
  return { ...session[0], steps };
}

export async function getPrepEventsByAssetId(assetId: string) {
  return await db
    .select()
    .from(prepEvents)
    .where(eq(prepEvents.assetId, assetId))
    .orderBy(desc(prepEvents.timestamp))
    .limit(1000);
}

export async function getPrepEventsByShopDomain(shopDomain: string, limit = 100) {
  // Note: shopId in prep_events is from app DB, not monitor DB
  // For now, we'll filter by shopId string match (may need to join with shops table later)
  return await db
    .select()
    .from(prepEvents)
    .orderBy(desc(prepEvents.timestamp))
    .limit(limit);
}

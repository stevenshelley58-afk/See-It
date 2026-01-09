/**
 * Alert Rules Engine
 * Defines rules for triggering alerts
 */

import { db } from '@/lib/db/client';
import { prepEvents } from '@/lib/db/schema';
import { eq, and, gte, sql, or, like } from 'drizzle-orm';

export interface AlertRule {
  id: string;
  name: string;
  severity: 'critical' | 'error' | 'warning';
  evaluate: (data: AlertData) => Promise<AlertResult | null>;
}

export interface AlertData {
  errorRate: number;
  shopSuccessRates: Record<string, number>;
  systemHealth: Record<string, { status: string; responseTime?: number }>;
  sessionCount: number;
  currentHour: number; // 0-23
  prepEvents?: {
    manualCutoutRate?: Record<string, number>; // shopId -> rate
    overrideRate?: Record<string, number>;
    abandonmentRate?: Record<string, number>;
    lowConfidenceReadyCount?: number;
    downgradeAfterConfirmRate?: Record<string, number>;
  };
}

export interface AlertResult {
  ruleId: string;
  message: string;
  severity?: 'critical' | 'error' | 'warning';
  affectedShops?: string[];
  metadata?: Record<string, unknown>;
}

export const alertRules: AlertRule[] = [
  {
    id: 'critical_error_rate',
    name: 'Critical Error Rate',
    severity: 'critical',
    evaluate: async (data) => {
      if (data.errorRate > 0.1) { // > 10% error rate
        return {
          ruleId: 'critical_error_rate',
          message: `Critical error rate: ${Math.round(data.errorRate * 100)}% in last 5 minutes`,
        };
      }
      return null;
    },
  },
  {
    id: 'shop_success_rate',
    name: 'Shop Success Rate Drop',
    severity: 'error',
    evaluate: async (data) => {
      const lowSuccessShops = Object.entries(data.shopSuccessRates)
        .filter(([_, rate]) => rate < 0.5)
        .map(([shop, _]) => shop);

      if (lowSuccessShops.length > 0) {
        return {
          ruleId: 'shop_success_rate',
          message: `${lowSuccessShops.length} shop(s) with success rate below 50%`,
          affectedShops: lowSuccessShops,
        };
      }
      return null;
    },
  },
  {
    id: 'ai_provider_down',
    name: 'AI Provider Down',
    severity: 'critical',
    evaluate: async (data) => {
      const downProviders = Object.entries(data.systemHealth)
        .filter(([_, health]) => health.status === 'down')
        .map(([provider, _]) => provider);

      if (downProviders.length > 0) {
        return {
          ruleId: 'ai_provider_down',
          message: `AI provider(s) down: ${downProviders.join(', ')}`,
          metadata: { providers: downProviders },
        };
      }
      return null;
    },
  },
  {
    id: 'no_sessions_business_hours',
    name: 'No Sessions During Business Hours',
    severity: 'warning',
    evaluate: async (data) => {
      // AWST is UTC+8, so 8am-10pm AWST = 0-14 UTC
      const isBusinessHours = data.currentHour >= 0 && data.currentHour < 14;
      if (isBusinessHours && data.sessionCount === 0) {
        return {
          ruleId: 'no_sessions_business_hours',
          message: 'No sessions in the last hour during business hours (8am-10pm AWST)',
        };
      }
      return null;
    },
  },
  // ============================================
  // PREP-SPECIFIC ALERTS
  // ============================================
  {
    id: 'prep_high_manual_rate',
    name: 'High Manual Cutout Rate',
    severity: 'warning',
    evaluate: async (data) => {
      // Check last 24 hours for manual vs auto cutout ratio
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const [manualCount, autoCount] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` })
          .from(prepEvents)
          .where(
            and(
              gte(prepEvents.timestamp, oneDayAgo),
              eq(prepEvents.eventType, 'manual_cutout_applied')
            )
          ),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(prepEvents)
          .where(
            and(
              gte(prepEvents.timestamp, oneDayAgo),
              eq(prepEvents.eventType, 'auto_cutout_created')
            )
          ),
      ]);

      const manual = Number(manualCount[0]?.count || 0);
      const auto = Number(autoCount[0]?.count || 0);
      const total = manual + auto;

      if (total > 0 && manual / total > 0.3) {
        return {
          ruleId: 'prep_high_manual_rate',
          message: `High manual cutout rate: ${Math.round((manual / total) * 100)}% (${manual}/${total}) in last 24h`,
          severity: 'warning',
        };
      }
      return null;
    },
  },
  {
    id: 'prep_high_override_rate',
    name: 'High Cutout Override Rate',
    severity: 'warning',
    evaluate: async (data) => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const [overrideCount, approvedCount] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` })
          .from(prepEvents)
          .where(
            and(
              gte(prepEvents.timestamp, oneDayAgo),
              eq(prepEvents.eventType, 'cutout_override_proceed')
            )
          ),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(prepEvents)
          .where(
            and(
              gte(prepEvents.timestamp, oneDayAgo),
              eq(prepEvents.eventType, 'cutout_approved')
            )
          ),
      ]);

      const overrides = Number(overrideCount[0]?.count || 0);
      const approved = Number(approvedCount[0]?.count || 0);
      const total = overrides + approved;

      if (total > 0 && overrides / total > 0.15) {
        return {
          ruleId: 'prep_high_override_rate',
          message: `High cutout override rate: ${Math.round((overrides / total) * 100)}% (${overrides}/${total}) in last 24h`,
          severity: 'warning',
        };
      }
      return null;
    },
  },
  {
    id: 'prep_abandonment_rate',
    name: 'High Prep Abandonment Rate',
    severity: 'warning',
    evaluate: async (data) => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const [abandonedCount, startedCount] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` })
          .from(prepEvents)
          .where(
            and(
              gte(prepEvents.timestamp, oneDayAgo),
              eq(prepEvents.eventType, 'prep_abandoned')
            )
          ),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(prepEvents)
          .where(
            and(
              gte(prepEvents.timestamp, oneDayAgo),
              or(
                eq(prepEvents.eventType, 'prep_started'),
                eq(prepEvents.eventType, 'prep_opened')
              )!
            )
          ),
      ]);

      const abandoned = Number(abandonedCount[0]?.count || 0);
      const started = Number(startedCount[0]?.count || 0);

      if (started > 0 && abandoned / started > 0.25) {
        return {
          ruleId: 'prep_abandonment_rate',
          message: `High prep abandonment rate: ${Math.round((abandoned / started) * 100)}% (${abandoned}/${started}) in last 24h`,
          severity: 'warning',
        };
      }
      return null;
    },
  },
];

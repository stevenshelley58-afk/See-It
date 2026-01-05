/**
 * Alert Rules Engine
 * Defines rules for triggering alerts
 */

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
];

export const PLANS = {
  trial: { priceUsd: 0, renders: 50, lifestyleImages: 10 },
  starter: { priceUsd: 39, renders: 150, lifestyleImages: 15 },
  growth: { priceUsd: 79, renders: 600, lifestyleImages: 50 }
};

export function mapBillingPlan(plan: keyof typeof PLANS) {
  return PLANS[plan];
}

export function billingUpgradeUrl(shopDomain: string, plan: keyof typeof PLANS) {
  return "https://" + shopDomain + "/admin/charges/see-it/" + plan;
}

import { BillingInterval } from "@shopify/shopify-api";

export const PLANS = {
    FREE: {
        id: "free",
        name: "Free",
        amount: 0.0,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
        dailyQuota: 100,  // Increased for testing
        monthlyQuota: 3000,
    },
    PRO: {
        id: "pro",
        name: "Pro",
        amount: 20.0,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
        dailyQuota: 100,
        monthlyQuota: 3000,
    },
};

export const BILLING_CONFIG = {
    [PLANS.PRO.name]: {
        amount: PLANS.PRO.amount,
        currencyCode: PLANS.PRO.currencyCode,
        interval: PLANS.PRO.interval,
    },
};

export function getPlan(planName) {
    const key = Object.keys(PLANS).find(
        (key) => PLANS[key].name.toLowerCase() === (planName || "").toLowerCase()
    );
    return key ? PLANS[key] : PLANS.FREE;
}

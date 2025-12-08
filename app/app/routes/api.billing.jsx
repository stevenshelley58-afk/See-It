import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PLANS } from "../billing";
import prisma from "../db.server";

export const action = async ({ request }) => {
    const { billing, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const plan = formData.get("plan");

    if (plan === "PRO") {
        // Request PRO plan
        // This will redirect the user to Shopify to approve the charge
        await billing.request({
            plan: PLANS.PRO.name,
            isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false',
            returnUrl: `${process.env.SHOPIFY_APP_URL}/api/billing/callback`,
        });
        return null; // billing.request redirects
    } else if (plan === "FREE") {
        // Downgrade to FREE
        // 1. Check for active subscriptions
        const billingCheck = await billing.check();

        if (billingCheck.hasActivePayment) {
            const subscription = billingCheck.appSubscriptions[0];
            // 2. Cancel active subscription
            await billing.cancel({
                subscriptionId: subscription.id,
                isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false',
                prune: true,
            });
        }

        // 3. Update DB to FREE
        await prisma.shop.update({
            where: { shopDomain: session.shop },
            data: {
                plan: PLANS.FREE.id,
                dailyQuota: PLANS.FREE.dailyQuota,
                monthlyQuota: PLANS.FREE.monthlyQuota,
            },
        });

        return redirect("/app");
    }

    return json({ error: "Invalid plan" }, { status: 400 });
};

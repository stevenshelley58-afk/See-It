import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PLANS, getPlan } from "../billing";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    const { billing, session } = await authenticate.admin(request);

    console.log(`[Billing Callback] Processing for shop: ${session.shop}`);

    try {
        // Verify payment - must specify the plans to check for and isTest mode
        const billingCheck = await billing.check({
            plans: [PLANS.PRO.name],
            isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false',
        });

        let planToSet = PLANS.FREE;

        if (billingCheck.hasActivePayment) {
            // Get the active subscription details to determine which plan
            const activeSubscription = billingCheck.appSubscriptions?.[0];
            if (activeSubscription) {
                // Use getPlan to match subscription name to our plan config
                planToSet = getPlan(activeSubscription.name);
                console.log(`[Billing Callback] Active payment found: ${activeSubscription.name}, setting plan: ${planToSet.id}`);
            } else {
                // Fallback to PRO if we have payment but no subscription details
                planToSet = PLANS.PRO;
                console.log(`[Billing Callback] Active payment found (no subscription details), defaulting to PRO`);
            }
        } else {
            console.log(`[Billing Callback] No active payment found, setting plan: FREE`);
        }

        // Update shop plan and quotas
        await prisma.shop.update({
            where: { shopDomain: session.shop },
            data: {
                plan: planToSet.id,
                dailyQuota: planToSet.dailyQuota,
                monthlyQuota: planToSet.monthlyQuota,
            },
        });

        console.log(`[Billing Callback] Successfully updated shop ${session.shop} to plan: ${planToSet.id}`);

    } catch (error) {
        console.error(`[Billing Callback] Error processing for shop ${session.shop}:`, error);
        // Continue to redirect - the next page load will re-verify billing status
        // This prevents users from being stuck on an error page
    }

    return redirect("/app");
};

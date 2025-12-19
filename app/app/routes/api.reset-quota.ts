/**
 * DEV ONLY: Reset quota for testing
 * POST /api/reset-quota
 * 
 * This endpoint:
 * 1. Increases the shop's daily quota to 100
 * 2. Resets today's usage to 0
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    // Only allow in development/test mode
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_QUOTA_RESET !== "true") {
        return json({ error: "Not allowed in production" }, { status: 403 });
    }

    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    // Find the shop
    const shop = await prisma.shop.findFirst({
        where: { shopDomain }
    });

    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }

    // Update shop quota to 100
    await prisma.shop.update({
        where: { id: shop.id },
        data: { dailyQuota: 100 }
    });

    // Reset today's usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.usageDaily.updateMany({
        where: {
            shopId: shop.id,
            date: today
        },
        data: {
            compositeRenders: 0,
            prepRenders: 0,
            cleanupRenders: 0
        }
    });

    return json({ 
        success: true, 
        message: "Quota reset successfully",
        shopId: shop.id,
        newDailyQuota: 100
    });
};

// Also support GET for easy browser testing
export const loader = async ({ request }: ActionFunctionArgs) => {
    return json({ 
        message: "POST to this endpoint to reset quota",
        note: "Only works in dev mode or when ALLOW_QUOTA_RESET=true"
    });
};


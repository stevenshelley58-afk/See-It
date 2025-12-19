/**
 * DEV ONLY: Reset quota for testing
 * GET /api/reset-quota?shop=xxx - Reset quota for a specific shop
 * 
 * This endpoint:
 * 1. Increases the shop's daily quota to 100
 * 2. Resets today's usage to 0
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // Only allow when ALLOW_QUOTA_RESET is set
    if (process.env.ALLOW_QUOTA_RESET !== "true") {
        return json({ error: "Not allowed - set ALLOW_QUOTA_RESET=true" }, { status: 403 });
    }

    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop");

    // If no shop specified, reset ALL shops (for testing)
    if (!shopDomain) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Update all shops to have 100 daily quota
        const shopUpdate = await prisma.shop.updateMany({
            data: { dailyQuota: 100 }
        });

        // Reset all usage for today
        const usageUpdate = await prisma.usageDaily.updateMany({
            where: { date: today },
            data: {
                compositeRenders: 0,
                prepRenders: 0,
                cleanupRenders: 0
            }
        });

        return json({ 
            success: true, 
            message: "All quotas reset",
            shopsUpdated: shopUpdate.count,
            usageRecordsReset: usageUpdate.count
        });
    }

    // Find the specific shop
    const shop = await prisma.shop.findFirst({
        where: { shopDomain: { contains: shopDomain } }
    });

    if (!shop) {
        // List all shops for debugging
        const allShops = await prisma.shop.findMany({
            select: { id: true, shopDomain: true, dailyQuota: true }
        });
        return json({ 
            error: "Shop not found", 
            searchedFor: shopDomain,
            availableShops: allShops 
        }, { status: 404 });
    }

    // Update shop quota to 100
    await prisma.shop.update({
        where: { id: shop.id },
        data: { dailyQuota: 100 }
    });

    // Reset today's usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usageUpdate = await prisma.usageDaily.updateMany({
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
        shopDomain: shop.shopDomain,
        newDailyQuota: 100,
        usageRecordsReset: usageUpdate.count
    });
};


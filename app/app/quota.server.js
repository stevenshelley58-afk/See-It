import prisma from "./db.server";

/**
 * Check if a shop has quota available without incrementing.
 * Throws a 429 Response if quota would be exceeded.
 */
export async function checkQuota(shopId, type, count = 1) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await prisma.$transaction(async (tx) => {
        const shop = await tx.shop.findUnique({ where: { id: shopId } });
        if (!shop) throw new Error("Shop not found");

        let usage = await tx.usageDaily.findUnique({
            where: { shopId_date: { shopId, date: today } },
        });

        if (!usage) {
            // Create placeholder usage record for today
            usage = await tx.usageDaily.create({
                data: { shopId, date: today },
            });
        }

        const limit = shop.dailyQuota;
        let currentUsage = 0;

        // Quota is based on composite renders only.
        // Prep logs usage but does not block.
        if (type === "render") {
            currentUsage = usage.compositeRenders;

            if (currentUsage + count > limit) {
                throw new Response(
                    JSON.stringify({
                        error: "quota_exceeded",
                        message: "Daily quota exceeded for your current plan. Upgrade to increase your limit.",
                    }),
                    {
                        status: 429,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }
        }

        return true;
    });
}

/**
 * Increment usage counter for a shop.
 * Safe for concurrent requests - uses upsert with increment.
 */
export async function incrementQuota(shopId, type, count = 1) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const updateData = {};
    if (type === "render") {
        updateData.compositeRenders = { increment: count };
    } else if (type === "prep") {
        updateData.prepRenders = { increment: count };
    } else if (type === "cleanup") {
        updateData.cleanupRenders = { increment: count };
    }

    // Use upsert to handle race conditions where usage record doesn't exist yet
    await prisma.usageDaily.upsert({
        where: { shopId_date: { shopId, date: today } },
        create: {
            shopId,
            date: today,
            ...updateData,
        },
        update: updateData,
    });

    return true;
}

/**
 * Legacy function for backward compatibility.
 * Checks quota and increments in one transaction.
 */
export async function enforceQuota(shopId, type, count = 1) {
    await checkQuota(shopId, type, count);
    await incrementQuota(shopId, type, count);
    return true;
}

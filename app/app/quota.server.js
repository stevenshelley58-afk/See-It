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

    // For update, we use increment syntax
    const updateData = {};
    // For create, we need the actual integer value (not increment object)
    const createData = {
        shopId,
        date: today,
        prepRenders: 0,
        cleanupRenders: 0,
        compositeRenders: 0,
    };

    if (type === "render") {
        updateData.compositeRenders = { increment: count };
        createData.compositeRenders = count;
    } else if (type === "prep") {
        updateData.prepRenders = { increment: count };
        createData.prepRenders = count;
    } else if (type === "cleanup") {
        updateData.cleanupRenders = { increment: count };
        createData.cleanupRenders = count;
    }

    // Use upsert to handle race conditions where usage record doesn't exist yet
    await prisma.usageDaily.upsert({
        where: { shopId_date: { shopId, date: today } },
        create: createData,
        update: updateData,
    });

    return true;
}

/**
 * Atomically checks quota and increments in one transaction.
 * Prevents race conditions where multiple requests could exceed quota.
 */
export async function enforceQuota(shopId, type, count = 1) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await prisma.$transaction(async (tx) => {
        // Get shop quota limits
        const shop = await tx.shop.findUnique({
            where: { id: shopId },
            select: { dailyQuota: true, monthlyQuota: true }
        });

        if (!shop) {
            throw new Error("Shop not found");
        }

        // Get or create today's usage
        let usage = await tx.usageDaily.findFirst({
            where: { shopId, date: today }
        });

        if (!usage) {
            usage = await tx.usageDaily.create({
                data: {
                    shopId,
                    date: today,
                    prepRenders: 0,
                    cleanupRenders: 0,
                    compositeRenders: 0
                }
            });
        }

        // Check quota
        const field = type === 'prep' ? 'prepRenders'
                    : type === 'cleanup' ? 'cleanupRenders'
                    : 'compositeRenders';

        // Only enforce quota for render operations (prep and cleanup are logged but not blocked)
        if (type === 'render' && usage[field] + count > shop.dailyQuota) {
            const error = new Error("Daily quota exceeded");
            error.code = "QUOTA_EXCEEDED";
            throw error;
        }

        // Increment atomically
        await tx.usageDaily.update({
            where: { id: usage.id },
            data: { [field]: { increment: count } }
        });

        return true;
    });
}

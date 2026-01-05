// Diagnostic script to check render job data
import prisma from "./app/db.server.js";

async function diagnose() {
    console.log("=== Shop Records ===");
    const shops = await prisma.shop.findMany({
        select: {
            id: true,
            shopDomain: true,
            plan: true,
            _count: {
                select: {
                    renderJobs: true,
                }
            }
        }
    });

    console.table(shops.map(s => ({
        id: s.id.substring(0, 8),
        domain: s.shopDomain,
        plan: s.plan,
        renderJobs: s._count.renderJobs
    })));

    console.log("\n=== Recent Render Jobs ===");
    const recentJobs = await prisma.renderJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
            id: true,
            shopId: true,
            status: true,
            createdAt: true,
            productId: true,
        }
    });

    console.table(recentJobs.map(j => ({
        id: j.id.substring(0, 8),
        shopId: j.shopId.substring(0, 8),
        status: j.status,
        createdAt: j.createdAt.toISOString(),
        productId: j.productId?.split('/').pop() || 'N/A'
    })));

    console.log("\n=== Render Job Status Counts ===");
    const statusCounts = await prisma.renderJob.groupBy({
        by: ['status'],
        _count: true
    });
    console.table(statusCounts);

    await prisma.$disconnect();
}

diagnose().catch(console.error);

// Temporary diagnostic endpoint - DELETE AFTER USE
import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async () => {
    try {
        // Get all shops with render job counts
        const shops = await prisma.shop.findMany({
            select: {
                id: true,
                shopDomain: true,
                plan: true,
                _count: {
                    select: {
                        renderJobs: true,
                        productAssets: true,
                        roomSessions: true,
                    }
                }
            }
        });

        // Get recent render jobs
        const recentJobs = await prisma.renderJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
                id: true,
                shopId: true,
                status: true,
                createdAt: true,
                productId: true,
                shop: {
                    select: { shopDomain: true }
                }
            }
        });

        // Get status counts
        const statusCounts = await prisma.renderJob.groupBy({
            by: ['status'],
            _count: true
        });

        return json({
            shops: shops.map(s => ({
                id: s.id.substring(0, 8) + '...',
                domain: s.shopDomain,
                plan: s.plan,
                renderJobs: s._count.renderJobs,
                productAssets: s._count.productAssets,
                roomSessions: s._count.roomSessions
            })),
            recentJobs: recentJobs.map(j => ({
                id: j.id.substring(0, 8) + '...',
                shopDomain: j.shop?.shopDomain,
                status: j.status,
                createdAt: j.createdAt.toISOString(),
                productId: j.productId?.split('/').pop() || 'N/A'
            })),
            statusCounts: statusCounts.reduce((acc, s) => {
                acc[s.status] = s._count;
                return acc;
            }, {})
        });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
};

import { json } from "@remix-run/node";
import { useLoaderData, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StatCard, PageShell, Card } from "../components/ui";

export const loader = async ({ request }) => {
    const { session, admin } = await authenticate.admin(request);
    let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

    if (!shop) {
        const shopResponse = await admin.graphql(
            `#graphql
                query {
                    shop {
                        id
                    }
                }
            `
        );
        const shopData = await shopResponse.json();
        const shopifyShopId = shopData.data.shop.id.replace('gid://shopify/Shop/', '');
        
        const { PLANS } = await import("../billing");
        shop = await prisma.shop.create({
            data: {
                shopDomain: session.shop,
                shopifyShopId: shopifyShopId,
                accessToken: session.accessToken || "pending",
                plan: PLANS.FREE.id,
                dailyQuota: PLANS.FREE.dailyQuota,
                monthlyQuota: PLANS.FREE.monthlyQuota
            }
        });
    }

    // Get all completed renders (total visualizations)
    const totalVisualizations = await prisma.renderJob.count({
        where: { shopId: shop.id, status: "completed" }
    });

    // Get total products with ready assets
    const totalProducts = await prisma.productAsset.count({
        where: { shopId: shop.id, status: "ready" }
    });

    // Calculate average per product
    const avgPerProduct = totalProducts > 0 ? (totalVisualizations / totalProducts).toFixed(1) : "0";

    // Get leads collected (feature not yet implemented)
    const leadsCount = 0;

    // Calculate lead conversion rate (simplified: leads / total visualizations * 100)
    const leadConversion = totalVisualizations > 0 ? ((leadsCount / totalVisualizations) * 100).toFixed(1) : "0";

    // Success rate (completed vs failed)
    const statusCounts = await prisma.renderJob.groupBy({
        by: ['status'],
        where: {
            shopId: shop.id,
            status: { in: ['completed', 'failed'] }
        },
        _count: true
    });

    const completed = statusCounts.find(s => s.status === 'completed')?._count || 0;
    const failed = statusCounts.find(s => s.status === 'failed')?._count || 0;
    const successRate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0;

    // Get weekly data (last 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const weeklyJobs = await prisma.renderJob.findMany({
        where: {
            shopId: shop.id,
            status: "completed",
            createdAt: { gte: sevenDaysAgo }
        },
        select: {
            createdAt: true
        }
    });

    // Group by day
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyData = [];
    
    // Initialize last 7 days
    for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const count = weeklyJobs.filter(job => {
            const jobDate = new Date(job.createdAt);
            jobDate.setHours(0, 0, 0, 0);
            return jobDate.getTime() === date.getTime();
        }).length;

        weeklyData.push({
            day: dayNames[date.getDay()],
            renders: count
        });
    }

    // Get top products by visualization count
    // Get top products - filter out null productIds in JS since Prisma groupBy has issues with { not: null }
    const allProductStats = await prisma.renderJob.groupBy({
        by: ['productId'],
        where: {
            shopId: shop.id,
            status: "completed"
        },
        _count: { productId: true },
        orderBy: {
            _count: {
                productId: 'desc'
            }
        },
        take: 10
    });
    
    // Filter out null productIds and take top 5
    const productStats = allProductStats
        .filter(stat => stat.productId != null)
        .slice(0, 5);

    // Get product titles from Shopify
    const productIds = productStats.map(stat => stat.productId.replace('gid://shopify/Product/', ''));
    let topProducts = [];
    
    if (productIds.length > 0) {
        try {
            const response = await admin.graphql(
                `#graphql
                    query getProducts($ids: [ID!]!) {
                        nodes(ids: $ids) {
                            ... on Product {
                                id
                                title
                            }
                        }
                    }
                `,
                { variables: { ids: productStats.map(s => s.productId) } }
            );
            
            const responseJson = await response.json();
            const products = responseJson.data.nodes || [];
            
            topProducts = productStats.map(stat => {
                const product = products.find(p => p && p.id === stat.productId);
                return {
                    name: product?.title || `Product ${stat.productId.split('/').pop()}`,
                    count: stat._count.productId
                };
            });
        } catch (e) {
            // Fallback to just IDs
            topProducts = productStats.map(stat => ({
                name: `Product ${stat.productId.split('/').pop()}`,
                count: stat._count.productId
            }));
        }
    }

    return json({
        metrics: {
            total: totalVisualizations,
            avgPerProduct,
            conversion: leadConversion,
            successRate
        },
        weeklyData,
        topProducts
    });
};

export default function Analytics() {
    const { metrics, weeklyData, topProducts } = useLoaderData();
    const maxRenders = Math.max(...weeklyData.map(d => d.renders), 1); // Avoid division by zero

    return (
        <>
            <TitleBar title="Analytics" />
            <PageShell>
                {/* Header */}
                <div>
                    <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 tracking-tight">
                        Analytics
                    </h1>
                    <p className="text-neutral-500 text-sm mt-0.5">
                        Track visualization engagement and performance
                    </p>
                </div>

                {/* Metrics - 2 cols mobile, 4 cols desktop */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                    <StatCard label="Total Visualizations" value={metrics.total.toString()} subtitle="All time" compact />
                    <StatCard label="Avg. per Product" value={metrics.avgPerProduct} subtitle="visualizations" compact />
                    <StatCard label="Lead Conversion" value={`${metrics.conversion}%`} subtitle="from visualizations" compact />
                    <StatCard label="Success Rate" value={`${metrics.successRate}%`} subtitle="render completion" highlight compact />
                </div>

                {/* Chart */}
                <Card>
                    <div className="flex items-center justify-between mb-4 md:mb-6">
                        <h2 className="font-semibold text-neutral-900 text-sm md:text-base">Visualizations This Week</h2>
                        <select className="text-xs md:text-sm border border-neutral-200 rounded-lg px-2 md:px-3 py-1 md:py-1.5 text-neutral-600 bg-white">
                            <option>Last 7 days</option>
                            <option>Last 30 days</option>
                            <option>Last 90 days</option>
                        </select>
                    </div>

                    {/* Bar Chart - shorter on mobile */}
                    <div className="flex items-end justify-between h-32 md:h-48 gap-2 md:gap-4">
                        {weeklyData.map((data, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 md:gap-2">
                                <div className="w-full flex flex-col items-center justify-end h-24 md:h-40">
                                    <div 
                                        className="w-full bg-neutral-900 rounded-t transition-all duration-500"
                                        style={{ height: `${(data.renders / maxRenders) * 100}%` }}
                                    />
                                </div>
                                <span className="text-xs text-neutral-500">{data.day}</span>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Top Products */}
                <Card>
                    <h2 className="font-semibold text-neutral-900 mb-3 md:mb-4 text-sm md:text-base">
                        Top Products by Visualizations
                    </h2>
                    {topProducts.length > 0 ? (
                        <div className="space-y-3">
                            {topProducts.map((product, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 md:gap-3 min-w-0">
                                        <span className="text-sm text-neutral-400 w-4">{i + 1}</span>
                                        <span className="text-sm text-neutral-900 truncate">{product.name}</span>
                                    </div>
                                    <span className="text-sm font-medium text-neutral-900 flex-shrink-0 ml-2">
                                        {product.count}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-sm text-neutral-500 text-center">
                            No visualization data yet
                        </div>
                    )}
                </Card>
            </PageShell>
        </>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    let title = "Error";
    let message = "Something went wrong";

    if (isRouteErrorResponse(error)) {
        title = `${error.status}`;
        message = error.data?.message || error.statusText;
    } else if (error instanceof Error) {
        message = error.message;
    }

    return (
        <>
            <TitleBar title="Analytics" />
            <PageShell>
                <Card>
                    <div className="space-y-4">
                        <div>
                            <h1 className="text-lg font-semibold text-red-600">{title}</h1>
                            <p className="text-sm text-neutral-600 mt-1">{message}</p>
                        </div>
                    </div>
                </Card>
            </PageShell>
        </>
    );
}

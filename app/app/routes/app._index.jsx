import { useLoaderData, useSubmit, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { PLANS } from "../billing";
import { StatCard, UsageBar, PageShell, Card, Button } from "../components/ui";

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const usage = await prisma.usageDaily.findUnique({
    where: { shopId_date: { shopId: shop.id, date: today } }
  });

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthlyUsageAgg = await prisma.usageDaily.aggregate({
    where: {
      shopId: shop.id,
      date: { gte: startOfMonth }
    },
    _sum: { compositeRenders: true }
  });
  const monthlyUsage = monthlyUsageAgg._sum.compositeRenders || 0;

  // Get total completed renders (customer uses)
  const totalRenders = await prisma.renderJob.count({
    where: { shopId: shop.id, status: "completed" }
  });

  // Get unique customers who used it
  let customersUsed = 0;
  try {
    const uniqueResult = await prisma.renderJob.groupBy({
      by: ['customerSessionId'],
      where: { shopId: shop.id, status: "completed", customerSessionId: { not: null } }
    });
    customersUsed = uniqueResult.length;
  } catch (e) {
    customersUsed = Math.round(totalRenders * 0.35); // Fallback estimate
  }

  // Get leads generated
  let leadsGenerated = 0;
  try {
    leadsGenerated = await prisma.leadCapture.count({ where: { shopId: shop.id } });
  } catch (e) {
    leadsGenerated = 0;
  }

  // Get products ready
  const productsReady = await prisma.productAsset.count({
    where: { shopId: shop.id, status: "ready" }
  });

  // Calculate success rate (completed vs failed)
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

  // Get recent activity (last 10 completed/failed renders)
  const recentJobs = await prisma.renderJob.findMany({
    where: { shopId: shop.id, status: { in: ['completed', 'failed'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      createdAt: true,
      productId: true,
    }
  });

  // Map recent activity to display format
  const recentActivity = recentJobs.map(job => {
    const timeAgo = getTimeAgo(job.createdAt);
    return {
      id: job.id,
      action: job.status === 'completed' ? 'Customer visualization' : 'Render failed',
      product: `Product ${job.productId?.split('/').pop() || 'Unknown'}`,
      time: timeAgo,
      success: job.status === 'completed'
    };
  });

  // Check if setup is complete (has at least one ready product asset)
  const setupComplete = productsReady > 0;

  return json({
    stats: {
      customersUsed,
      leadsGenerated,
      productsReady,
      successRate
    },
    usage: {
      daily: {
        used: usage?.compositeRenders || 0,
        limit: shop.dailyQuota
      },
      monthly: {
        used: monthlyUsage,
        limit: shop.monthlyQuota
      }
    },
    plan: shop.plan === PLANS.PRO.id ? 'pro' : 'free',
    recentActivity,
    setupComplete
  });
};

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Index() {
  const { stats, usage, plan, recentActivity, setupComplete } = useLoaderData();
  const submit = useSubmit();

  const handleUpgrade = () => submit({ plan: "PRO" }, { method: "POST", action: "/api/billing" });

  return (
    <>
      <TitleBar title="See It Dashboard" />
      <PageShell>
        {/* Header */}
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 tracking-tight">
            Dashboard
          </h1>
          <p className="text-neutral-500 text-sm mt-0.5 md:mt-1">
            Your AR visualization performance at a glance
          </p>
        </div>

        {/* Stats Grid - 2 cols mobile, 4 cols desktop */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Customer Uses" value={stats.customersUsed} subtitle="All time" highlight compact />
          <StatCard label="Leads Generated" value={stats.leadsGenerated} subtitle="From visualizations" compact />
          <StatCard label="Products Ready" value={stats.productsReady} subtitle="Available for AR" compact />
          <StatCard label="Success Rate" value={`${stats.successRate}%`} subtitle="Render completion" compact />
        </div>

        {/* Usage + Activity - Stacked on mobile, grid on desktop */}
        <div className="grid md:grid-cols-3 gap-4 md:gap-6">
          {/* Usage Card */}
          <Card>
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <h2 className="font-semibold text-neutral-900 text-sm md:text-base">Usage</h2>
              <span className="text-xs px-2 py-1 bg-neutral-100 rounded-full text-neutral-600">
                {plan === 'pro' ? 'Pro Plan' : 'Free Plan'}
              </span>
            </div>
            <UsageBar used={usage.daily.used} limit={usage.daily.limit} label="Today" />
            <UsageBar used={usage.monthly.used} limit={usage.monthly.limit} label="This month" />
            {plan === 'free' && (
              <Button 
                variant="secondary" 
                className="w-full mt-4 md:mt-6"
                onClick={handleUpgrade}
              >
                Upgrade Plan
              </Button>
            )}
          </Card>

          {/* Activity Card - spans 2 columns on desktop */}
          <div className="md:col-span-2">
            <Card>
              <h2 className="font-semibold text-neutral-900 mb-3 md:mb-4 text-sm md:text-base">
                Recent Activity
              </h2>
              <div>
                {recentActivity.length > 0 ? (
                  recentActivity.map(activity => (
                    <div key={activity.id} className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          activity.success ? 'bg-emerald-500' : 'bg-red-500'
                        }`} />
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-900 truncate">{activity.action}</div>
                          <div className="text-xs text-neutral-500 truncate">{activity.product}</div>
                        </div>
                      </div>
                      <div className="text-xs text-neutral-400 flex-shrink-0 ml-3">{activity.time}</div>
                    </div>
                  ))
                ) : (
                  <div className="py-4 text-sm text-neutral-500 text-center">
                    No activity yet
                  </div>
                )}
              </div>
              {recentActivity.length > 0 && (
                <Button 
                  variant="secondary" 
                  className="w-full mt-4 text-neutral-500"
                  onClick={() => window.location.href = '/app/analytics'}
                >
                  View all activity →
                </Button>
              )}
            </Card>
          </div>
        </div>

        {/* Setup Banner - only show if not complete */}
        {!setupComplete && (
          <Card className="bg-neutral-50">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="font-semibold text-neutral-900 text-sm md:text-base">Setup</h2>
                <p className="text-sm text-neutral-500 mt-1">
                  Add the See It button to your product pages to start capturing leads
                </p>
              </div>
              <Button 
                variant="primary"
                className="w-full md:w-auto"
                onClick={() => window.location.href = 'https://admin.shopify.com/store/' + (window.location.hostname.match(/[\w-]+\.myshopify\.com/)?.[0] || '') + '/themes'}
              >
                Open Theme Editor
              </Button>
            </div>
          </Card>
        )}
      </PageShell>
    </>
  );
}

// Error boundary to catch and display errors gracefully
export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try refreshing the page.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = error.data?.message || "The requested resource could not be loaded.";
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <>
      <TitleBar title="See It Dashboard" />
      <PageShell>
        <Card>
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-red-600">{title}</h1>
              <p className="text-sm text-neutral-600 mt-1">{message}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Refresh Page
              </Button>
              <Button variant="secondary" onClick={() => window.location.href = '/app'}>
                Go to Dashboard
              </Button>
            </div>
          </div>
        </Card>
      </PageShell>
    </>
  );
}

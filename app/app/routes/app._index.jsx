import { useLoaderData, useSubmit, useRouteError, isRouteErrorResponse, Link } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { PLANS } from "../billing";
import { PageShell, Card, Button } from "../components/ui";

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

  // Get total completed renders (customer uses)
  const totalRenders = await prisma.renderJob.count({
    where: { shopId: shop.id, status: "completed" }
  });

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

  // Get products needing attention (failed renders in last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const failedProducts = await prisma.renderJob.groupBy({
    by: ['productId'],
    where: {
      shopId: shop.id,
      status: 'failed',
      createdAt: { gte: sevenDaysAgo }
    },
    _count: true
  });
  const productsNeedingAttention = failedProducts.length;

  // Check if setup is complete
  const setupComplete = productsReady > 0;

  // Plan info
  const isUnlimited = shop.shopDomain === 'bohoem58.myshopify.com';
  const displayPlan = isUnlimited ? 'unlimited' : (shop.plan === PLANS.PRO.id ? 'pro' : 'free');

  return json({
    stats: {
      customerUses: totalRenders,
      productsReady,
      successRate,
      productsNeedingAttention
    },
    plan: displayPlan,
    setupComplete
  });
};

export default function Index() {
  const { stats, plan, setupComplete } = useLoaderData();
  const submit = useSubmit();

  const handleUpgrade = () => submit({ plan: "PRO" }, { method: "POST", action: "/api/billing" });

  return (
    <>
      <TitleBar title="See It Dashboard" />
      <PageShell>
        {/* Action Cards - This IS the dashboard */}
        <div className="space-y-3">
          <Link 
            to="/app/products" 
            className="block bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-transparent hover:border-neutral-200"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-neutral-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-neutral-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-neutral-900">Products</div>
                <div className="text-sm text-neutral-500">{stats.productsReady} enabled for AR</div>
              </div>
              <div className="text-2xl font-semibold text-neutral-900">{stats.productsReady}</div>
            </div>
          </Link>

          <Link 
            to="/app/analytics" 
            className="block bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-transparent hover:border-neutral-200"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-neutral-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-neutral-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-neutral-900">Customer views</div>
                <div className="text-sm text-neutral-500">{stats.successRate}% success rate</div>
              </div>
              <div className="text-2xl font-semibold text-neutral-900">{stats.customerUses}</div>
            </div>
          </Link>

          {stats.productsNeedingAttention > 0 && (
            <Link 
              to="/app/products?status=failed" 
              className="block bg-amber-50 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-amber-200"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-200 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-amber-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-neutral-900">Needs attention</div>
                  <div className="text-sm text-neutral-500">Fix rendering issues</div>
                </div>
                <div className="text-2xl font-semibold text-amber-600">{stats.productsNeedingAttention}</div>
              </div>
            </Link>
          )}

          <Link 
            to="/app/settings" 
            className="block bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-transparent hover:border-neutral-200"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-neutral-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-neutral-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-neutral-900">Settings</div>
                <div className="text-sm text-neutral-500">{plan === 'free' ? 'Free plan' : plan === 'pro' ? 'Pro plan' : 'Unlimited'}</div>
              </div>
              <svg className="w-5 h-5 text-neutral-400 flex-shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 4l6 6-6 6"/>
              </svg>
            </div>
          </Link>
        </div>

        {/* Setup Banner - only if no products */}
        {!setupComplete && (
          <div className="bg-neutral-900 text-white rounded-xl p-5">
            <div className="font-semibold">Get started</div>
            <p className="text-sm text-neutral-400 mt-1 mb-4">
              Add your first product to enable AR for customers
            </p>
            <Link to="/app/products">
              <Button variant="secondary" className="bg-white text-neutral-900 hover:bg-neutral-100">
                Add product
              </Button>
            </Link>
          </div>
        )}
      </PageShell>
    </>
  );
}

// Error boundary
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

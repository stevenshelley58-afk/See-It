import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../billing";
import pkg from "../../package.json" with { type: "json" };
import { GEMINI_IMAGE_MODEL_PRO, MODEL_FOR_COMPOSITING } from "../config/ai-models.config";
import { PageShell, Card, Button } from "../components/ui";

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
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

  // Check billing status
  let isPro = shop.plan === PLANS.PRO.id;
  try {
    const { hasActivePayment } = await billing.check({
      plans: [PLANS.PRO.name],
      isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false'
    });
    if (hasActivePayment) {
      isPro = true;
    }
  } catch (e) {
    console.error("Billing check failed", e);
  }

  // Auto-generate build info
  const buildTimestamp = process.env.BUILD_TIMESTAMP || new Date().toISOString();
  const version = { 
    app: pkg.version, 
    build: buildTimestamp.slice(0, 10).replace(/-/g, ''),
    date: new Date(buildTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };

  return json({
    shop,
    isPro,
    version
  });
};

export default function Settings() {
  const { shop, isPro, version } = useLoaderData();
  const submit = useSubmit();

  const handleUpgrade = () => submit({ plan: "PRO" }, { method: "POST", action: "/api/billing" });

  return (
    <>
      <TitleBar title="Settings" />
      <PageShell>
        {/* Header */}
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 tracking-tight">
            Settings
          </h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            Configure your See It installation
          </p>
        </div>

        {/* App Info */}
        <Card>
          <div className="divide-y divide-neutral-100">
            <div className="p-4 md:p-6 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">App Version</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5">
                  v{version.app} (Build {version.build})
                </p>
              </div>
              <span className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full">
                Up to date
              </span>
            </div>

            <div className="p-4 md:p-6 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">AI Model</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5">
                  {MODEL_FOR_COMPOSITING}
                </p>
              </div>
            </div>

            <div className="p-4 md:p-6 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">Button Style</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5 truncate">
                  Customize how the See It button appears on your store
                </p>
              </div>
              <Button 
                size="sm" 
                variant="secondary"
                className="flex-shrink-0"
                onClick={() => {
                  // Navigate to theme editor - this would need to be implemented
                  window.location.href = `https://admin.shopify.com/store/${shop.shopDomain}/themes`;
                }}
              >
                Customize
              </Button>
            </div>

            <div className="p-4 md:p-6 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">Lead Capture</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5 truncate">
                  Collect email addresses when customers save visualizations
                </p>
              </div>
              <button 
                className="w-11 h-6 bg-neutral-900 rounded-full relative flex-shrink-0"
                onClick={() => {
                  // Toggle functionality would go here
                  console.log("Lead capture toggle");
                }}
              >
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full transition-transform" />
              </button>
            </div>
          </div>
        </Card>

        {/* Billing */}
        <Card>
          <h2 className="font-semibold text-neutral-900 mb-3 md:mb-4 text-sm md:text-base">Billing</h2>
          <div className="p-3 md:p-4 bg-neutral-50 rounded-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="font-medium text-neutral-900 text-sm md:text-base">
                  {isPro ? 'Pro Plan' : 'Free Plan'}
                </div>
                <div className="text-xs md:text-sm text-neutral-500">
                  {shop.dailyQuota} renders/day · {shop.monthlyQuota} renders/month
                </div>
              </div>
              {!isPro && (
                <Button 
                  variant="primary"
                  className="w-full md:w-auto"
                  onClick={handleUpgrade}
                >
                  Upgrade to Pro
                </Button>
              )}
            </div>
          </div>
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
      <TitleBar title="Settings" />
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


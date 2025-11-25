import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineStack,
  ProgressBar,
  Banner,
  Icon,
  Divider,
  Badge,
} from "@shopify/polaris";
import {
  HomeIcon,
  ImageIcon,
  SettingsIcon,
  ChartVerticalFilledIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { PLANS } from "../billing";

// ============================================
// VERSION INFO - Update this when deploying!
// ============================================
const APP_VERSION = "2.0.0";
const BUILD_DATE = "Nov 25, 2025";
const BUILD_ID = "gemini3-nov25";

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

  // Get total renders all time
  const totalRendersAgg = await prisma.renderJob.count({
    where: { shopId: shop.id, status: "completed" }
  });

  return json({
    shop,
    usage: usage || { compositeRenders: 0, prepRenders: 0 },
    monthlyUsage,
    totalRenders: totalRendersAgg,
    version: { app: APP_VERSION, build: BUILD_ID, date: BUILD_DATE }
  });
};

export default function Index() {
  const { shop, usage, monthlyUsage, totalRenders, version } = useLoaderData();
  const submit = useSubmit();

  const handleUpgrade = () => submit({ plan: "PRO" }, { method: "POST", action: "/api/billing" });
  const handleDowngrade = () => submit({ plan: "FREE" }, { method: "POST", action: "/api/billing" });

  const isPro = shop.plan === PLANS.PRO.id;
  const dailyPercent = Math.min((usage.compositeRenders / shop.dailyQuota) * 100, 100);
  const monthlyPercent = Math.min((monthlyUsage / shop.monthlyQuota) * 100, 100);

  return (
    <Page>
      <TitleBar title="See It Dashboard" />
      
      <BlockStack gap="600">
        {/* Welcome Banner */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h1" variant="headingXl">
                    👋 Welcome to See It
                  </Text>
                  <Badge tone={isPro ? "success" : "info"}>
                    {isPro ? "Pro Plan" : "Free Plan"}
                  </Badge>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  Help customers visualize your products in their space
                </Text>
              </BlockStack>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Version</Text>
                  <Text variant="headingSm" fontWeight="bold">
                    {version.app}
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Build: {version.build}
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>

        <Layout>
          {/* Main Content - Left Side */}
          <Layout.Section>
            <BlockStack gap="500">
              {/* Quick Stats */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    📊 Quick Stats
                  </Text>
                  <InlineStack gap="400" wrap={false}>
                    <Box
                      background="bg-fill-success-secondary"
                      padding="400"
                      borderRadius="200"
                      minWidth="120px"
                    >
                      <BlockStack gap="100" inlineAlign="center">
                        <Text variant="headingLg" fontWeight="bold">
                          {totalRenders}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          Total Renders
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box
                      background="bg-fill-info-secondary"
                      padding="400"
                      borderRadius="200"
                      minWidth="120px"
                    >
                      <BlockStack gap="100" inlineAlign="center">
                        <Text variant="headingLg" fontWeight="bold">
                          {usage.compositeRenders}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          Today
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box
                      background="bg-fill-warning-secondary"
                      padding="400"
                      borderRadius="200"
                      minWidth="120px"
                    >
                      <BlockStack gap="100" inlineAlign="center">
                        <Text variant="headingLg" fontWeight="bold">
                          {monthlyUsage}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          This Month
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Getting Started */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    🚀 Getting Started
                  </Text>
                  <BlockStack gap="300">
                    <Box
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <InlineStack gap="300" blockAlign="center">
                        <Text variant="headingMd">1️⃣</Text>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="semibold">
                            Add the "See It" button to your theme
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            Go to Online Store → Themes → Customize → Add block → See It Button
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </Box>
                    <Box
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <InlineStack gap="300" blockAlign="center">
                        <Text variant="headingMd">2️⃣</Text>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="semibold">
                            Position the button on product pages
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            Place the block near your "Add to Cart" button for best results
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </Box>
                    <Box
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <InlineStack gap="300" blockAlign="center">
                        <Text variant="headingMd">3️⃣</Text>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="semibold">
                            Customers can now visualize products!
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            They upload a room photo, place your product, and see it come to life
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </Box>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* How It Works */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    ✨ How It Works
                  </Text>
                  <Text variant="bodyMd">
                    See It uses AI-powered image generation to place your products 
                    into customer room photos. Customers can:
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack gap="200">
                      <Text>📸</Text>
                      <Text variant="bodyMd">Upload or capture a photo of their room</Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Text>🎯</Text>
                      <Text variant="bodyMd">Drag and resize your product to position it</Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Text>🎨</Text>
                      <Text variant="bodyMd">Generate a photorealistic composite image</Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Text>💾</Text>
                      <Text variant="bodyMd">Save and share their visualization</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* Sidebar - Right Side */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {/* Plan & Usage */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      📈 Usage & Billing
                    </Text>
                    <Badge tone={isPro ? "success" : "attention"}>
                      {isPro ? "Pro" : "Free"}
                    </Badge>
                  </InlineStack>
                  
                  <Divider />

                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text variant="bodySm">Daily Renders</Text>
                        <Text variant="bodySm" fontWeight="semibold">
                          {usage.compositeRenders} / {shop.dailyQuota}
                        </Text>
                      </InlineStack>
                      <ProgressBar
                        progress={dailyPercent}
                        tone={dailyPercent > 80 ? "critical" : "primary"}
                        size="small"
                      />
                    </BlockStack>

                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text variant="bodySm">Monthly Renders</Text>
                        <Text variant="bodySm" fontWeight="semibold">
                          {monthlyUsage} / {shop.monthlyQuota}
                        </Text>
                      </InlineStack>
                      <ProgressBar
                        progress={monthlyPercent}
                        tone={monthlyPercent > 80 ? "critical" : "primary"}
                        size="small"
                      />
                    </BlockStack>
                  </BlockStack>

                  <Divider />

                  {isPro ? (
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">
                        You're on the Pro plan with higher limits
                      </Text>
                      <Button onClick={handleDowngrade} variant="plain">
                        Downgrade to Free
                      </Button>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">
                        Upgrade for more renders and features
                      </Text>
                      <Button onClick={handleUpgrade} variant="primary">
                        Upgrade to Pro
                      </Button>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* System Status */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    🔧 System Status
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodySm">App Version</Text>
                      <Badge>{version.app}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm">Build</Text>
                      <Text variant="bodySm" tone="subdued">{version.build}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm">Last Updated</Text>
                      <Text variant="bodySm" tone="subdued">{version.date}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm">AI Model</Text>
                      <Text variant="bodySm" tone="subdued">Gemini 3 Pro</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Need Help */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    💬 Need Help?
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Having issues or questions? We're here to help.
                  </Text>
                  <Button url="mailto:support@seeit.app" external>
                    Contact Support
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Footer */}
        <Box paddingBlockStart="400">
          <InlineStack align="center">
            <Text variant="bodySm" tone="subdued">
              See It v{version.app} • Built with ❤️ using Gemini 3 AI
            </Text>
          </InlineStack>
        </Box>
      </BlockStack>
    </Page>
  );
}

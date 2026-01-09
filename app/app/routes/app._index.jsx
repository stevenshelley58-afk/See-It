import { useLoaderData, useRouteError, isRouteErrorResponse, Link } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { PLANS } from "../billing";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, InlineGrid, InlineStack, Page, Text } from "@shopify/polaris";

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

  // Product asset status counts (prep coverage + failures)
  const assetGroups = await prisma.productAsset.groupBy({
    by: ["status"],
    where: { shopId: shop.id },
    _count: { status: true },
  });
  const productsReady = assetGroups.find((g) => g.status === "ready")?._count?.status || 0;
  const productsFailed = assetGroups.find((g) => g.status === "failed")?._count?.status || 0;
  const productsPending = assetGroups.find((g) => g.status === "pending")?._count?.status || 0;

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

  return json({
    customerViews: totalRenders,
    successRate,
    enabledProductsCount: productsReady,
    productsFailed,
    productsPending,
  });
};

export default function Index() {
  const { customerViews, successRate, enabledProductsCount, productsFailed, productsPending } = useLoaderData();

  return (
    <>
      <TitleBar title="See It" />
      <Page
        title="See It"
        subtitle="Product visualization for your store"
        primaryAction={{ content: "Prepare products", url: "/app/products" }}
        secondaryActions={[{ content: "Settings", url: "/app/settings" }]}
      >
        <BlockStack gap="500">
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            <Card roundedAbove="sm">
              <BlockStack gap="200">
                <Text as="p" tone="subdued" variant="bodySm">
                  Customer views
                </Text>
                <Text as="p" variant="heading2xl">
                  {customerViews}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Completed renders
                </Text>
              </BlockStack>
            </Card>

            <Card roundedAbove="sm">
              <BlockStack gap="200">
                <Text as="p" tone="subdued" variant="bodySm">
                  Success rate
                </Text>
                <Text as="p" variant="heading2xl">
                  {successRate}%
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Completed / (completed + failed)
                </Text>
              </BlockStack>
            </Card>

            <Card roundedAbove="sm">
              <BlockStack gap="200">
                <Text as="p" tone="subdued" variant="bodySm">
                  Products prepared
                </Text>
                <Text as="p" variant="heading2xl">
                  {enabledProductsCount}
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  {productsPending > 0 ? <Badge tone="attention">{productsPending} pending</Badge> : null}
                  {productsFailed > 0 ? <Badge tone="critical">{productsFailed} failed</Badge> : null}
                </InlineStack>
              </BlockStack>
            </Card>
          </InlineGrid>

          <InlineGrid columns={{ xs: 1, lg: 3 }} gap="400">
            <Box gridColumn={{ lg: "span 2" }}>
              <Card roundedAbove="sm">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Needs attention
                    </Text>
                    <Button url="/app/products" variant="plain">
                      View products
                    </Button>
                  </InlineStack>

                  {productsFailed > 0 ? (
                    <Banner
                      title={`${productsFailed} products failed preparation`}
                      tone="warning"
                      action={{ content: "Review", url: "/app/products?status=failed" }}
                    >
                      <p>Fix these so customers don’t hit errors in the widget.</p>
                    </Banner>
                  ) : (
                    <Banner title="All good" tone="success">
                      <p>No failed products right now.</p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>
            </Box>

            <Card roundedAbove="sm">
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Quick links
                </Text>
                <Divider />
                <BlockStack gap="200">
                  <NavRow title="Products" description="Prepare products and fix failures" to="/app/products" right={<Badge tone="success">{enabledProductsCount} ready</Badge>} />
                  <NavRow title="Analytics" description="View performance insights" to="/app/analytics" />
                  <NavRow title="Settings" description="Configure preferences and defaults" to="/app/settings" />
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </BlockStack>
      </Page>
    </>
  );
}

function NavRow({ title, description, right, to }) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderColor="border" borderWidth="0165" borderRadius="300">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="050">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {title}
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {description}
          </Text>
        </BlockStack>
        <InlineStack gap="200" blockAlign="center">
          {right || null}
          <Button url={to} variant="secondary">
            Open
          </Button>
        </InlineStack>
      </InlineStack>
    </Box>
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
      <TitleBar title="See It" />
      <Page title="See It">
        <Banner title={title} tone="critical">
          <p>{message}</p>
        </Banner>
        <Box paddingBlockStart="400">
          <InlineStack gap="200">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Refresh
            </Button>
            <Button variant="secondary" onClick={() => (window.location.href = "/app")}>
              Go to Dashboard
            </Button>
          </InlineStack>
        </Box>
      </Page>
    </>
  );
}

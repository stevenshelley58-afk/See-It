import { json } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async () => {
  // Mock data (replace with real loader data if you want to demo live metrics)
  return json({
    polarisTranslations,
    kpis: {
      customerViews7d: 50,
      successRate7d: 83,
      productsPrepared: 17,
      quotaUsed: 25,
      quotaTotal: 300,
      failures: 3,
    },
    activity: [
      { title: 'Prepared "Calligraphy Brush"', when: "2 minutes ago", tone: "success" },
      { title: "Customer render started", when: "9 minutes ago", tone: "info" },
      { title: "Preparation failed (Lamp)", when: "1 hour ago", tone: "critical" },
    ],
  });
};

export default function DemoDashboard() {
  const { polarisTranslations: i18n, kpis, activity } = useLoaderData();

  return (
    <PolarisAppProvider i18n={i18n}>
      <Page
        title="See It"
        subtitle="Product visualization for your store"
        primaryAction={{ content: "Prepare products", url: "/app/products" }}
        secondaryActions={[
          {
            content: "View docs",
            url: "https://github.com/stevenshelley58-afk/See-It/blob/main/app/docs/PRODUCT_PREP_REDESIGN.md",
            external: true,
          },
          { content: "Open products", url: "/app/products" },
        ]}
      >
        <BlockStack gap="500">
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            <Card roundedAbove="sm">
              <BlockStack gap="200">
                <Text as="p" tone="subdued" variant="bodySm">
                  Customer views (7 days)
                </Text>
                <Text as="p" variant="heading2xl">
                  {kpis.customerViews7d}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  +12% vs previous 7 days
                </Text>
              </BlockStack>
            </Card>

            <Card roundedAbove="sm">
              <BlockStack gap="200">
                <Text as="p" tone="subdued" variant="bodySm">
                  Render success rate (7 days)
                </Text>
                <Text as="p" variant="heading2xl">
                  {kpis.successRate7d}%
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Completed / started
                </Text>
              </BlockStack>
            </Card>

            <Card roundedAbove="sm">
              <BlockStack gap="200">
                <Text as="p" tone="subdued" variant="bodySm">
                  Products prepared
                </Text>
                <Text as="p" variant="heading2xl">
                  {kpis.productsPrepared}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Ready for room renders
                </Text>
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

                  {kpis.failures > 0 ? (
                    <Banner
                      title={`${kpis.failures} products failed preparation`}
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

                  <Card background="bg-surface-secondary" roundedAbove="sm">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Quota
                      </Text>
                      <Text as="p" tone="subdued">
                        <strong>{kpis.quotaUsed}</strong> / {kpis.quotaTotal} used this month
                      </Text>
                      <InlineStack gap="200">
                        <Button url="/app/billing" variant="secondary">
                          Billing
                        </Button>
                        <Button url="/app/settings" variant="secondary">
                          Settings
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Card>
            </Box>

            <Card roundedAbove="sm">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Recent activity
                  </Text>
                  <Button url="/app/analytics" variant="plain">
                    Analytics
                  </Button>
                </InlineStack>

                <BlockStack gap="300">
                  {activity.map((a, idx) => (
                    <Box key={idx}>
                      <InlineStack align="space-between" blockAlign="start" gap="300">
                        <BlockStack gap="050">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {a.title}
                          </Text>
                          <Text as="p" tone="subdued" variant="bodySm">
                            {a.when}
                          </Text>
                        </BlockStack>
                        <Badge tone={a.tone === "critical" ? "critical" : a.tone === "success" ? "success" : "info"}>
                          {a.tone === "critical" ? "failed" : a.tone === "success" ? "ready" : "view"}
                        </Badge>
                      </InlineStack>
                      {idx < activity.length - 1 ? (
                        <Box paddingBlockStart="300">
                          <Divider />
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>

          <Card roundedAbove="sm">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Navigation
              </Text>
              <Text as="p" tone="subdued">
                This is a demo page. Use these links to check your real routes.
              </Text>

              <Divider />

              <BlockStack gap="200">
                <NavRow
                  title="Products"
                  description="Manage prepared products and fix failures"
                  right={<Badge tone="success">{kpis.productsPrepared} ready</Badge>}
                  to="/app/products"
                />
                <NavRow title="Analytics" description="See customer usage and performance" to="/app/analytics" />
                <NavRow title="Settings" description="Defaults, quotas, automation, widget behavior" to="/app/settings" />
              </BlockStack>
            </BlockStack>
          </Card>

          <Text as="p" tone="subdued" variant="bodySm">
            Tip: open this demo at{" "}
            <RemixLink to="/demo/dashboard" style={{ textDecoration: "underline" }}>
              /demo/dashboard
            </RemixLink>{" "}
            (use a trailing slash if you see a 404).
          </Text>
        </BlockStack>
      </Page>
    </PolarisAppProvider>
  );
}

function NavRow({ title, description, right, to }) {
  return (
    <Box
      padding="400"
      background="bg-surface-secondary"
      borderColor="border"
      borderWidth="0165"
      borderRadius="300"
    >
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


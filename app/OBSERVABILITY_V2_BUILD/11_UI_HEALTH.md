# Step 11: UI - Health Dashboard

## Context

You are working on a Shopify Remix app. You have created the runs list and detail pages. Now create the health dashboard.

## Task

Create the health dashboard showing failure rates, latency, and error counts.

## Instructions

Create `app/routes/app.monitor.health.tsx`:

### Page Structure

1. **Failure Rate Cards** - Three cards showing 1h, 24h, 7d failure rates
2. **Latency Stats** - P50 and P95 latency
3. **Error Counts** - Provider errors, storage errors, telemetry dropped
4. **Run Totals** - Total runs in each time period

### Loader

```typescript
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const stats = await getHealthStats(shop.id);

  return json(stats);
};
```

### Component

```typescript
export default function MonitorHealthPage() {
  const stats = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Poll every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [revalidator]);

  const getFailureRateTone = (rate: number): "success" | "warning" | "critical" => {
    if (rate < 5) return "success";
    if (rate < 20) return "warning";
    return "critical";
  };

  return (
    <Page
      title="Monitor Health"
      backAction={{ content: "Runs", url: "/app/monitor" }}
    >
      <Layout>
        {/* Failure Rates */}
        <Layout.Section>
          <InlineStack gap="400" align="start">
            <Card>
              <Box padding="400">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Failure Rate (1h)</Text>
                  <Text as="p" variant="headingLg">
                    <Badge tone={getFailureRateTone(stats.failureRate1h)}>
                      {stats.failureRate1h.toFixed(1)}%
                    </Badge>
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {stats.totalRuns1h} runs
                  </Text>
                </BlockStack>
              </Box>
            </Card>

            <Card>
              <Box padding="400">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Failure Rate (24h)</Text>
                  <Text as="p" variant="headingLg">
                    <Badge tone={getFailureRateTone(stats.failureRate24h)}>
                      {stats.failureRate24h.toFixed(1)}%
                    </Badge>
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {stats.totalRuns24h} runs
                  </Text>
                </BlockStack>
              </Box>
            </Card>

            <Card>
              <Box padding="400">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Failure Rate (7d)</Text>
                  <Text as="p" variant="headingLg">
                    <Badge tone={getFailureRateTone(stats.failureRate7d)}>
                      {stats.failureRate7d.toFixed(1)}%
                    </Badge>
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {stats.totalRuns7d} runs
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Latency */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text as="h2" variant="headingMd">Latency (24h)</Text>
            </Box>
            <Box padding="400" paddingBlockStart="0">
              <InlineStack gap="800">
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">P50</Text>
                  <Text as="p" variant="headingLg">
                    {stats.latencyP50 ? `${(stats.latencyP50 / 1000).toFixed(1)}s` : "-"}
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">P95</Text>
                  <Text as="p" variant="headingLg">
                    {stats.latencyP95 ? `${(stats.latencyP95 / 1000).toFixed(1)}s` : "-"}
                  </Text>
                </div>
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* Errors */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text as="h2" variant="headingMd">Errors (24h)</Text>
            </Box>
            <Box padding="400" paddingBlockStart="0">
              <InlineStack gap="800">
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">Provider Errors</Text>
                  <Text as="p" variant="headingLg">
                    {stats.providerErrors24h}
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">Storage Errors</Text>
                  <Text as="p" variant="headingLg">
                    {stats.storageErrors24h}
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">Telemetry Dropped</Text>
                  <Text as="p" variant="headingLg">
                    {stats.telemetryDropped24h}
                  </Text>
                </div>
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

### Required Imports

```typescript
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getHealthStats } from "../services/monitor";
import {
  Page,
  Layout,
  Card,
  Badge,
  Text,
  InlineStack,
  BlockStack,
  Box,
} from "@shopify/polaris";
```

## Verification

1. Navigate to `/app/monitor/health`
2. Page loads without errors
3. Shows failure rates with color-coded badges
4. Shows latency P50/P95
5. Shows error counts
6. Polls every 30 seconds

## Do Not

- Do not add charting libraries (keep it simple with numbers)
- Do not add trend data (future enhancement)

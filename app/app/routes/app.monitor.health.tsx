/**
 * Monitor - Health Dashboard
 *
 * Shows failure rates, latency stats, and error counts.
 * Polls every 30 seconds for updates.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
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
  Banner,
  Button,
} from "@shopify/polaris";
import { useRouteError, isRouteErrorResponse } from "@remix-run/react";

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

export default function MonitorHealthPage() {
  const stats = useLoaderData<typeof loader>();
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

  const getFailureRateTone = (
    rate: number
  ): "success" | "warning" | "critical" => {
    if (rate < 5) return "success";
    if (rate < 20) return "warning";
    return "critical";
  };

  return (
    <Page title="Monitor Health" backAction={{ content: "Runs", url: "/app/monitor" }}>
      <Layout>
        {/* Failure Rates */}
        <Layout.Section>
          <Text as="h2" variant="headingMd">
            Failure Rates
          </Text>
          <Box paddingBlockStart="400">
            <InlineStack gap="400" align="start">
              <Card>
                <Box padding="400">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Last Hour
                    </Text>
                    <Text as="p" variant="headingLg">
                      <Badge tone={getFailureRateTone(stats.failureRate1h)}>
                        {`${stats.failureRate1h.toFixed(1)}%`}
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
                    <Text as="p" variant="bodySm" tone="subdued">
                      Last 24 Hours
                    </Text>
                    <Text as="p" variant="headingLg">
                      <Badge tone={getFailureRateTone(stats.failureRate24h)}>
                        {`${stats.failureRate24h.toFixed(1)}%`}
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
                    <Text as="p" variant="bodySm" tone="subdued">
                      Last 7 Days
                    </Text>
                    <Text as="p" variant="headingLg">
                      <Badge tone={getFailureRateTone(stats.failureRate7d)}>
                        {`${stats.failureRate7d.toFixed(1)}%`}
                      </Badge>
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {stats.totalRuns7d} runs
                    </Text>
                  </BlockStack>
                </Box>
              </Card>
            </InlineStack>
          </Box>
        </Layout.Section>

        {/* Latency */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text as="h2" variant="headingMd">
                Latency (24h)
              </Text>
            </Box>
            <Box padding="400" paddingBlockStart="0">
              <InlineStack gap="800">
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    P50 (Median)
                  </Text>
                  <Text as="p" variant="headingLg">
                    {stats.latencyP50
                      ? `${(stats.latencyP50 / 1000).toFixed(1)}s`
                      : "-"}
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    P95
                  </Text>
                  <Text as="p" variant="headingLg">
                    {stats.latencyP95
                      ? `${(stats.latencyP95 / 1000).toFixed(1)}s`
                      : "-"}
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
              <Text as="h2" variant="headingMd">
                Errors (24h)
              </Text>
            </Box>
            <Box padding="400" paddingBlockStart="0">
              <InlineStack gap="800">
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Provider Errors
                  </Text>
                  <Text as="p" variant="headingLg">
                    {stats.providerErrors24h}
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Storage Errors
                  </Text>
                  <Text as="p" variant="headingLg">
                    {stats.storageErrors24h}
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Telemetry Dropped
                  </Text>
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

export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Error loading health dashboard";
  let message = "An unexpected error occurred while loading the health dashboard.";

  if (isRouteErrorResponse(error)) {
    title = `Error ${error.status}`;
    message = error.data || error.statusText;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Page title="Monitor Health" backAction={{ content: "Runs", url: "/app/monitor" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Banner title={title} tone="critical">
                <p>{message}</p>
              </Banner>
              <Button url="/app/monitor/health">Try Again</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

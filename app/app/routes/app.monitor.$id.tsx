/**
 * Monitor - Run Detail Page
 *
 * Shows full run detail with variants, events, inputs, and export.
 * Polls every 2s if status is "in_flight".
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { useEffect, useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getRunDetail,
  getRunEvents,
  getRunArtifacts,
} from "../services/monitor";
import {
  Page,
  Layout,
  Card,
  Badge,
  Button,
  Text,
  InlineStack,
  BlockStack,
  Box,
  Collapsible,
  Modal,
  Thumbnail,
  Icon,
  Divider,
  Banner,
} from "@shopify/polaris";
import { ClipboardIcon, ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    throw new Response("Missing run ID", { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const [run, events, artifacts] = await Promise.all([
    getRunDetail(id, shop.id),
    getRunEvents(id, shop.id),
    getRunArtifacts(id, shop.id),
  ]);

  if (!run) {
    throw new Response("Run not found", { status: 404 });
  }

  return json({ run, events: events.events, artifacts: artifacts.artifacts });
};

export default function MonitorRunDetailPage() {
  const { run, events, artifacts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Polling if in_flight
  useEffect(() => {
    if (run.status !== "in_flight") return;

    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [run.status, revalidator]);

  // Collapsible state
  const [eventsOpen, setEventsOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [promptPackOpen, setPromptPackOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);

  // Variant modal state
  const [selectedVariant, setSelectedVariant] = useState<typeof run.variants[number] | null>(null);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const getStatusBadge = (status: string) => {
    const tones: Record<string, "success" | "warning" | "critical" | "info"> = {
      complete: "success",
      success: "success",
      partial: "warning",
      timeout: "warning",
      failed: "critical",
      in_flight: "info",
    };
    return <Badge tone={tones[status] || "info"}>{status}</Badge>;
  };

  const getSeverityBadge = (severity: string) => {
    const tones: Record<string, "success" | "warning" | "critical" | "info"> = {
      debug: "info",
      info: "info",
      warn: "warning",
      error: "critical",
    };
    return <Badge tone={tones[severity] || "info"}>{severity}</Badge>;
  };

  return (
    <Page
      title={`Run ${run.id.slice(0, 8)}...`}
      subtitle={run.productTitle || "Unknown Product"}
      backAction={{ content: "Back to Monitor", url: "/app/monitor" }}
      primaryAction={{
        content: "Export Debug Bundle",
        url: `/api/monitor/v1/runs/${run.id}/export`,
        external: true,
      }}
    >
      <Layout>
        {/* Summary Card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Summary</Text>

              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Status</Text>
                  {getStatusBadge(run.status)}
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Duration</Text>
                  <Text as="span" variant="bodyMd">
                    {run.totalDurationMs ? `${(run.totalDurationMs / 1000).toFixed(2)}s` : "-"}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Variants</Text>
                  <Text as="span" variant="bodyMd">
                    {run.successCount} / {run.variants.length} success
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Version</Text>
                  <Text as="span" variant="bodyMd">v{run.promptPackVersion}</Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Model</Text>
                  <Text as="span" variant="bodyMd">{run.model}</Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <InlineStack gap="400" wrap>
                <InlineStack gap="200" align="center">
                  <Text as="span" tone="subdued" variant="bodySm">Request ID:</Text>
                  <Text as="span" variant="bodyMd">{run.requestId.slice(0, 12)}...</Text>
                  <Button
                    icon={ClipboardIcon}
                    size="slim"
                    variant="plain"
                    onClick={() => copyToClipboard(run.requestId)}
                    accessibilityLabel="Copy request ID"
                  />
                </InlineStack>

                {run.traceId && (
                  <InlineStack gap="200" align="center">
                    <Text as="span" tone="subdued" variant="bodySm">Trace ID:</Text>
                    <Text as="span" variant="bodyMd">{run.traceId.slice(0, 12)}...</Text>
                    <Button
                      icon={ClipboardIcon}
                      size="slim"
                      variant="plain"
                      onClick={() => copyToClipboard(run.traceId!)}
                      accessibilityLabel="Copy trace ID"
                    />
                  </InlineStack>
                )}
              </InlineStack>

              {run.telemetryDropped && (
                <Banner tone="warning">
                  Some telemetry was dropped for this run due to write failures.
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Variants Grid */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Variants ({run.variants.length})</Text>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
                {run.variants.map((variant) => (
                  <div
                    key={variant.id}
                    onClick={() => setSelectedVariant(variant)}
                    style={{
                      cursor: "pointer",
                      border: "1px solid #e1e3e5",
                      borderRadius: "8px",
                      padding: "12px",
                      transition: "box-shadow 0.2s",
                    }}
                  >
                    <BlockStack gap="200">
                      {variant.imageUrl ? (
                        <img
                          src={variant.imageUrl}
                          alt={variant.variantId}
                          style={{
                            width: "100%",
                            height: "120px",
                            objectFit: "cover",
                            borderRadius: "4px",
                            backgroundColor: "#f6f6f7",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "120px",
                            backgroundColor: "#f6f6f7",
                            borderRadius: "4px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text as="span" tone="subdued">No image</Text>
                        </div>
                      )}

                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {variant.variantId}
                        </Text>
                        {getStatusBadge(variant.status)}
                      </InlineStack>

                      <Text as="span" tone="subdued" variant="bodySm">
                        {variant.latencyMs ? `${(variant.latencyMs / 1000).toFixed(2)}s` : "-"}
                      </Text>

                      {variant.errorCode && (
                        <Text as="span" tone="critical" variant="bodySm">
                          {variant.errorCode}
                        </Text>
                      )}
                    </BlockStack>
                  </div>
                ))}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Events Timeline */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Button
                onClick={() => setEventsOpen(!eventsOpen)}
                variant="plain"
                fullWidth
                textAlign="left"
                icon={eventsOpen ? ChevronUpIcon : ChevronDownIcon}
              >
                {`Events Timeline (${events.length})`}
              </Button>

              <Collapsible open={eventsOpen} id="events-collapsible">
                <BlockStack gap="200">
                  {events.length === 0 ? (
                    <Text as="p" tone="subdued">No events recorded</Text>
                  ) : (
                    events.map((event) => (
                      <Box
                        key={event.id}
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <InlineStack gap="400" align="start">
                          <Text as="span" variant="bodySm" tone="subdued">
                            {new Date(event.ts).toLocaleTimeString()}
                          </Text>
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {event.type}
                          </Text>
                          {getSeverityBadge(event.severity)}
                          <Text as="span" variant="bodySm" tone="subdued">
                            {event.source}
                          </Text>
                        </InlineStack>
                        {Object.keys(event.payload).length > 0 && (
                          <Box paddingBlockStart="200">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {JSON.stringify(event.payload).slice(0, 100)}
                              {JSON.stringify(event.payload).length > 100 ? "..." : ""}
                            </Text>
                          </Box>
                        )}
                      </Box>
                    ))
                  )}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Inputs Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Button
                onClick={() => setFactsOpen(!factsOpen)}
                variant="plain"
                fullWidth
                textAlign="left"
                icon={factsOpen ? ChevronUpIcon : ChevronDownIcon}
              >
                Resolved Facts
              </Button>

              <Collapsible open={factsOpen} id="facts-collapsible">
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <InlineStack align="end">
                    <Button
                      icon={ClipboardIcon}
                      size="slim"
                      variant="plain"
                      onClick={() => copyToClipboard(JSON.stringify(run.resolvedFactsJson, null, 2))}
                    >
                      Copy
                    </Button>
                  </InlineStack>
                  <pre style={{ overflow: "auto", maxHeight: "300px", fontSize: "12px" }}>
                    {JSON.stringify(run.resolvedFactsJson, null, 2)}
                  </pre>
                </Box>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Button
                onClick={() => setPromptPackOpen(!promptPackOpen)}
                variant="plain"
                fullWidth
                textAlign="left"
                icon={promptPackOpen ? ChevronUpIcon : ChevronDownIcon}
              >
                Prompt Pack
              </Button>

              <Collapsible open={promptPackOpen} id="prompt-pack-collapsible">
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <InlineStack align="end">
                    <Button
                      icon={ClipboardIcon}
                      size="slim"
                      variant="plain"
                      onClick={() => copyToClipboard(JSON.stringify(run.promptPackJson, null, 2))}
                    >
                      Copy
                    </Button>
                  </InlineStack>
                  <pre style={{ overflow: "auto", maxHeight: "300px", fontSize: "12px" }}>
                    {JSON.stringify(run.promptPackJson, null, 2)}
                  </pre>
                </Box>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Artifacts Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Button
                onClick={() => setArtifactsOpen(!artifactsOpen)}
                variant="plain"
                fullWidth
                textAlign="left"
                icon={artifactsOpen ? ChevronUpIcon : ChevronDownIcon}
              >
                {`Artifacts (${artifacts.length})`}
              </Button>

              <Collapsible open={artifactsOpen} id="artifacts-collapsible">
                <BlockStack gap="200">
                  {artifacts.length === 0 ? (
                    <Text as="p" tone="subdued">No artifacts recorded</Text>
                  ) : (
                    artifacts.map((artifact) => (
                      <Box
                        key={artifact.id}
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <InlineStack gap="400" align="space-between">
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {artifact.type}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {artifact.contentType} - {(artifact.byteSize / 1024).toFixed(1)} KB
                            </Text>
                          </BlockStack>
                          {artifact.url && (
                            <Button
                              size="slim"
                              url={artifact.url}
                              external
                            >
                              Download
                            </Button>
                          )}
                        </InlineStack>
                      </Box>
                    ))
                  )}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Variant Detail Modal */}
      <Modal
        open={selectedVariant !== null}
        onClose={() => setSelectedVariant(null)}
        title={selectedVariant?.variantId || "Variant"}
        size="large"
      >
        <Modal.Section>
          {selectedVariant && (
            <BlockStack gap="400">
              {selectedVariant.imageUrl ? (
                <img
                  src={selectedVariant.imageUrl}
                  alt={selectedVariant.variantId}
                  style={{ width: "100%", borderRadius: "8px" }}
                />
              ) : (
                <Box
                  padding="800"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <Text as="p" alignment="center" tone="subdued">
                    No image available
                  </Text>
                </Box>
              )}

              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Status</Text>
                  {getStatusBadge(selectedVariant.status)}
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Total Latency</Text>
                  <Text as="span" variant="bodyMd">
                    {selectedVariant.latencyMs ? `${(selectedVariant.latencyMs / 1000).toFixed(2)}s` : "-"}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Provider Time</Text>
                  <Text as="span" variant="bodyMd">
                    {selectedVariant.providerMs ? `${(selectedVariant.providerMs / 1000).toFixed(2)}s` : "-"}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">Upload Time</Text>
                  <Text as="span" variant="bodyMd">
                    {selectedVariant.uploadMs ? `${(selectedVariant.uploadMs / 1000).toFixed(2)}s` : "-"}
                  </Text>
                </BlockStack>
              </InlineStack>

              {selectedVariant.errorMessage && (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm">
                    <strong>{selectedVariant.errorCode}:</strong> {selectedVariant.errorMessage}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}

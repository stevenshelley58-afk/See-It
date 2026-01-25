/**
 * Monitor - Runs List Page
 *
 * Shows paginated list of composite runs with filters.
 * Polls every 2 seconds for updates.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  useLoaderData,
  useSearchParams,
  useNavigate,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useCallback, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRuns, type RunListFilters } from "../services/monitor";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Filters,
  ChoiceList,
  Badge,
  Button,
  TextField,
  Pagination,
  Text,
  InlineStack,
  Box,
  Banner,
  BlockStack,
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

  const url = new URL(request.url);

  const filters: RunListFilters = {};

  const status = url.searchParams.get("status");
  if (status) filters.status = status;

  // Prefer traceId (canonical), but accept legacy requestId param for backwards compatibility.
  const traceId = url.searchParams.get("traceId") || url.searchParams.get("requestId");
  if (traceId) filters.traceId = traceId;

  const configHash =
    url.searchParams.get("configHash") || url.searchParams.get("pipelineConfigHash");
  if (configHash) filters.pipelineConfigHash = configHash;

  const page = parseInt(url.searchParams.get("page") || "1");

  const result = await getRuns(shop.id, filters, { page, limit: 20 });

  // Get distinct pipeline config hashes for filter
  const configHashes = await prisma.compositeRun.findMany({
    where: { shopId: shop.id },
    select: { pipelineConfigHash: true },
    distinct: ["pipelineConfigHash"],
    orderBy: { createdAt: "desc" },
  });

  return json({
    ...result,
    configHashes: configHashes.map((v: { pipelineConfigHash: string }) => v.pipelineConfigHash),
  });
};

export default function MonitorRunsPage() {
  const { runs, total, page, pages, configHashes } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Polling every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [revalidator]);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string[]>(
    searchParams.get("status") ? [searchParams.get("status")!] : []
  );
  const [configHashFilter, setConfigHashFilter] = useState<string[]>(
    searchParams.get("configHash")
      ? [searchParams.get("configHash")!]
      : []
  );
  const [traceIdFilter, setTraceIdFilter] = useState(
    searchParams.get("traceId") || searchParams.get("requestId") || ""
  );

  const handleStatusChange = useCallback(
    (value: string[]) => {
      setStatusFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value.length > 0) {
        params.set("status", value[0]);
      } else {
        params.delete("status");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleConfigHashChange = useCallback(
    (value: string[]) => {
      setConfigHashFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value.length > 0) {
        params.set("configHash", value[0]);
      } else {
        params.delete("configHash");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleTraceIdChange = useCallback((value: string) => {
    setTraceIdFilter(value);
  }, []);

  const handleTraceIdSubmit = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (traceIdFilter) {
      params.set("traceId", traceIdFilter);
    } else {
      params.delete("traceId");
      params.delete("requestId"); // legacy
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [traceIdFilter, searchParams, setSearchParams]);

  const handleClearAll = useCallback(() => {
    setStatusFilter([]);
    setConfigHashFilter([]);
    setTraceIdFilter("");
    setSearchParams({ page: "1" });
  }, [setSearchParams]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("page", newPage.toString());
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "In Flight", value: "in_flight" },
            { label: "Complete", value: "complete" },
            { label: "Partial", value: "partial" },
            { label: "Failed", value: "failed" },
          ]}
          selected={statusFilter}
          onChange={handleStatusChange}
        />
      ),
      shortcut: true,
    },
    {
      key: "configHash",
      label: "Pipeline Config",
      filter: (
        <ChoiceList
          title="Config"
          titleHidden
          choices={configHashes.map((hash: string) => ({
            label: hash.slice(0, 8),
            value: hash,
          }))}
          selected={configHashFilter}
          onChange={handleConfigHashChange}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [
    ...(statusFilter.length > 0
      ? [
          {
            key: "status",
            label: `Status: ${statusFilter[0]}`,
            onRemove: () => handleStatusChange([]),
          },
        ]
      : []),
    ...(configHashFilter.length > 0
      ? [
          {
            key: "configHash",
            label: `Config: ${configHashFilter[0].slice(0, 8)}`,
            onRemove: () => handleConfigHashChange([]),
          },
        ]
      : []),
    ...(traceIdFilter
      ? [
          {
            key: "traceId",
            label: `Trace: ${traceIdFilter.slice(0, 8)}...`,
            onRemove: () => {
              setTraceIdFilter("");
              const params = new URLSearchParams(searchParams);
              params.delete("traceId");
              params.delete("requestId"); // legacy
              setSearchParams(params);
            },
          },
        ]
      : []),
  ];

  const getStatusBadge = (status: string) => {
    const tones: Record<string, "success" | "warning" | "critical" | "info"> = {
      complete: "success",
      partial: "warning",
      failed: "critical",
      in_flight: "info",
    };
    return <Badge tone={tones[status] || "info"}>{status}</Badge>;
  };

  const rows = runs.map((run) => [
    new Date(run.createdAt).toLocaleString(),
    run.productTitle || "Unknown",
    getStatusBadge(run.status),
    `${run.successCount}/${run.variantCount}`,
    run.totalDurationMs ? `${(run.totalDurationMs / 1000).toFixed(1)}s` : "-",
    run.pipelineConfigHash?.slice(0, 8) || "-",
    <Button
      key={run.id}
      size="slim"
      onClick={() => navigate(`/app/monitor/${run.id}`)}
    >
      View
    </Button>,
  ]);

  return (
    <Page
      title="See It Now Monitor"
      subtitle={`${total} composite runs`}
      secondaryActions={[
        {
          content: "Health Dashboard",
          onAction: () => navigate("/app/monitor/health"),
        },
      ]}
      backAction={{ content: "Products", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400">
              <InlineStack gap="400" align="start">
                <div style={{ flex: 1, maxWidth: 300 }}>
                  <TextField
                    label="Search by Trace ID"
                    value={traceIdFilter}
                    onChange={handleTraceIdChange}
                    onBlur={handleTraceIdSubmit}
                    placeholder="Enter trace ID..."
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => {
                      setTraceIdFilter("");
                      const params = new URLSearchParams(searchParams);
                      params.delete("traceId");
                      params.delete("requestId"); // legacy
                      setSearchParams(params);
                    }}
                  />
                </div>
              </InlineStack>
            </Box>

            <Filters
              queryValue=""
              filters={filters}
              appliedFilters={appliedFilters}
              onClearAll={handleClearAll}
              onQueryChange={() => {}}
              onQueryClear={() => {}}
              hideQueryField
            />

            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "text",
                "text",
                "text",
                "text",
                "text",
              ]}
              headings={[
                "Time",
                "Product",
                "Status",
                "Variants",
                "Duration",
                "Config",
                "",
              ]}
              rows={rows}
            />

            {pages > 1 && (
              <Box padding="400">
                <InlineStack align="center">
                  <Pagination
                    hasPrevious={page > 1}
                    hasNext={page < pages}
                    onPrevious={() => handlePageChange(page - 1)}
                    onNext={() => handlePageChange(page + 1)}
                  />
                  <Text as="span" variant="bodySm" tone="subdued">
                    Page {page} of {pages}
                  </Text>
                </InlineStack>
              </Box>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Error loading monitor";
  let message = "An unexpected error occurred while loading the monitor.";

  if (isRouteErrorResponse(error)) {
    title = `Error ${error.status}`;
    message = error.data || error.statusText;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Page title="See It Now Monitor" backAction={{ content: "Products", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Banner title={title} tone="critical">
                <p>{message}</p>
              </Banner>
              <Button url="/app/monitor">Try Again</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

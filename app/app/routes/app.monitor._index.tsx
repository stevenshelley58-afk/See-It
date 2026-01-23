/**
 * Monitor - Runs List Page
 *
 * Shows paginated list of render runs with filters.
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
} from "@shopify/polaris";

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

  const requestId = url.searchParams.get("requestId");
  if (requestId) filters.requestId = requestId;

  const promptVersion = url.searchParams.get("promptVersion");
  if (promptVersion) filters.promptVersion = parseInt(promptVersion);

  const page = parseInt(url.searchParams.get("page") || "1");

  const result = await getRuns(shop.id, filters, { page, limit: 20 });

  // Get distinct prompt versions for filter
  const versions = await prisma.renderRun.findMany({
    where: { shopId: shop.id },
    select: { promptPackVersion: true },
    distinct: ["promptPackVersion"],
    orderBy: { promptPackVersion: "desc" },
  });

  return json({
    ...result,
    versions: versions.map((v: { promptPackVersion: number }) => v.promptPackVersion),
  });
};

export default function MonitorRunsPage() {
  const { runs, total, page, pages, versions } =
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
  const [versionFilter, setVersionFilter] = useState<string[]>(
    searchParams.get("promptVersion")
      ? [searchParams.get("promptVersion")!]
      : []
  );
  const [requestIdFilter, setRequestIdFilter] = useState(
    searchParams.get("requestId") || ""
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

  const handleVersionChange = useCallback(
    (value: string[]) => {
      setVersionFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value.length > 0) {
        params.set("promptVersion", value[0]);
      } else {
        params.delete("promptVersion");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleRequestIdChange = useCallback((value: string) => {
    setRequestIdFilter(value);
  }, []);

  const handleRequestIdSubmit = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (requestIdFilter) {
      params.set("requestId", requestIdFilter);
    } else {
      params.delete("requestId");
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [requestIdFilter, searchParams, setSearchParams]);

  const handleClearAll = useCallback(() => {
    setStatusFilter([]);
    setVersionFilter([]);
    setRequestIdFilter("");
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
      key: "version",
      label: "Prompt Version",
      filter: (
        <ChoiceList
          title="Version"
          titleHidden
          choices={versions.map((v: number) => ({
            label: `v${v}`,
            value: v.toString(),
          }))}
          selected={versionFilter}
          onChange={handleVersionChange}
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
    ...(versionFilter.length > 0
      ? [
          {
            key: "version",
            label: `Version: v${versionFilter[0]}`,
            onRemove: () => handleVersionChange([]),
          },
        ]
      : []),
    ...(requestIdFilter
      ? [
          {
            key: "requestId",
            label: `Request: ${requestIdFilter.slice(0, 8)}...`,
            onRemove: () => {
              setRequestIdFilter("");
              const params = new URLSearchParams(searchParams);
              params.delete("requestId");
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
    `v${run.promptPackVersion}`,
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
      subtitle={`${total} render runs`}
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
                    label="Search by Request ID"
                    value={requestIdFilter}
                    onChange={handleRequestIdChange}
                    onBlur={handleRequestIdSubmit}
                    placeholder="Enter request ID..."
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => {
                      setRequestIdFilter("");
                      const params = new URLSearchParams(searchParams);
                      params.delete("requestId");
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
                "Version",
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

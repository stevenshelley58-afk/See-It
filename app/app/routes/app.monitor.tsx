// Monitor UI - View RenderRun history and variant results

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Filters,
  ChoiceList,
  Badge,
  Button,
  Modal,
  TextContainer,
  Thumbnail,
  Pagination,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";

const PAGE_SIZE = 20;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const statusFilter = url.searchParams.get("status") || "";
  const versionFilter = url.searchParams.get("version") || "";

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Build where clause
  const where: any = { shopId: shop.id };
  if (statusFilter) {
    where.status = statusFilter;
  }
  if (versionFilter) {
    where.promptPackVersion = parseInt(versionFilter);
  }

  // Fetch render runs with pagination
  const [runs, totalCount, versions] = await Promise.all([
    prisma.renderRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        productAsset: {
          select: {
            productTitle: true,
            productId: true,
          },
        },
        variantResults: {
          select: {
            variantId: true,
            status: true,
            latencyMs: true,
          },
        },
      },
    }),
    prisma.renderRun.count({ where }),
    prisma.promptVersion.findMany({
      select: { version: true },
      orderBy: { version: "desc" },
    }),
  ]);

  return json({
    runs: runs.map((run: any) => ({
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      productTitle: run.productAsset?.productTitle || "Unknown",
      productId: run.productAsset?.productId || "Unknown",
      status: run.status,
      promptPackVersion: run.promptPackVersion,
      totalDurationMs: run.totalDurationMs,
      variantCount: run.variantResults.length,
      successCount: run.variantResults.filter((v: any) => v.status === "success")
        .length,
    })),
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / PAGE_SIZE),
    versions: versions.map((v: any) => v.version),
  });
};

export default function MonitorPage() {
  const { runs, totalCount, page, totalPages, versions } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string[]>(
    searchParams.get("status") ? [searchParams.get("status")!] : []
  );
  const [versionFilter, setVersionFilter] = useState<string[]>(
    searchParams.get("version") ? [searchParams.get("version")!] : []
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
        params.set("version", value[0]);
      } else {
        params.delete("version");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleClearAll = useCallback(() => {
    setStatusFilter([]);
    setVersionFilter([]);
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
          choices={versions.map((v: any) => ({
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
  ];

  const rows = runs.map((run: any) => [
    new Date(run.createdAt).toLocaleString(),
    run.productTitle,
    <Badge
      key={run.id}
      tone={
        run.status === "complete"
          ? "success"
          : run.status === "partial"
            ? "warning"
            : "critical"
      }
    >
      {run.status}
    </Badge>,
    `v${run.promptPackVersion}`,
    `${run.successCount}/${run.variantCount}`,
    run.totalDurationMs ? `${(run.totalDurationMs / 1000).toFixed(1)}s` : "-",
    <Button key={run.id} size="slim" onClick={() => setSelectedRun(run.id)}>
      View
    </Button>,
  ]);

  return (
    <Page
      title="See It Now Monitor"
      subtitle={`${totalCount} render runs`}
      backAction={{ content: "Products", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Filters
              queryValue=""
              filters={filters}
              appliedFilters={appliedFilters}
              onClearAll={handleClearAll}
              onQueryChange={() => { }}
              onQueryClear={() => { }}
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
                "Version",
                "Variants",
                "Duration",
                "",
              ]}
              rows={rows}
            />
            {totalPages > 1 && (
              <div style={{ padding: "16px", textAlign: "center" }}>
                <Pagination
                  hasPrevious={page > 1}
                  hasNext={page < totalPages}
                  onPrevious={() => handlePageChange(page - 1)}
                  onNext={() => handlePageChange(page + 1)}
                />
              </div>
            )}
          </Card>
        </Layout.Section>
      </Layout>

      {selectedRun && (
        <RenderRunModal runId={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </Page>
  );
}

function RenderRunModal({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const [runDetails, setRunDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/monitor/run/${runId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch run details");
        return res.json();
      })
      .then((data) => {
        setRunDetails(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, [runId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Render Run Details"
      size="large"
    >
      <Modal.Section>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <p>Loading run details...</p>
          </div>
        ) : error ? (
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <p style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</p>
            <Button onClick={fetchData}>Retry</Button>
          </div>
        ) : runDetails ? (
          <TextContainer>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p>
                  <strong>Run ID:</strong> {runDetails.id}
                </p>
                <p>
                  <strong>Status:</strong> {runDetails.status}
                </p>
                <p>
                  <strong>Duration:</strong>{" "}
                  {runDetails.totalDurationMs
                    ? `${(runDetails.totalDurationMs / 1000).toFixed(1)}s`
                    : "-"}
                </p>
                <p>
                  <strong>Prompt Version:</strong> v{runDetails.promptPackVersion}
                </p>
              </div>
              <Button size="slim" onClick={fetchData}>Refresh</Button>
            </div>

            <h3 style={{ marginTop: "16px" }}>Variants</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "12px",
                marginTop: "8px",
              }}
            >
              {runDetails.variants?.map((v: any) => (
                <div
                  key={v.variantId}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    padding: "8px",
                    textAlign: "center",
                  }}
                >
                  {v.imageUrl ? (
                    <img
                      src={v.imageUrl}
                      alt={v.variantId}
                      style={{
                        width: "100%",
                        height: "auto",
                        borderRadius: "4px",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100px",
                        background: "#f0f0f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {v.status === "failed" ? "Failed" : "No image"}
                    </div>
                  )}
                  <p style={{ marginTop: "4px", fontSize: "12px" }}>
                    {v.variantId}
                  </p>
                  <Badge
                    tone={
                      v.status === "success"
                        ? "success"
                        : v.status === "timeout"
                          ? "warning"
                          : "critical"
                    }
                  >
                    {v.status}
                  </Badge>
                  {v.latencyMs && (
                    <p style={{ fontSize: "11px", color: "#666" }}>
                      {(v.latencyMs / 1000).toFixed(1)}s
                    </p>
                  )}
                </div>
              ))}
            </div>

            <h3 style={{ marginTop: "16px" }}>Resolved Facts</h3>
            <pre
              style={{
                background: "#f5f5f5",
                padding: "8px",
                borderRadius: "4px",
                fontSize: "11px",
                overflow: "auto",
                maxHeight: "200px",
              }}
            >
              {JSON.stringify(runDetails.resolvedFactsJson, null, 2)}
            </pre>

            <h3 style={{ marginTop: "16px" }}>Prompt Pack</h3>
            <pre
              style={{
                background: "#f5f5f5",
                padding: "8px",
                borderRadius: "4px",
                fontSize: "11px",
                overflow: "auto",
                maxHeight: "200px",
              }}
            >
              {JSON.stringify(runDetails.promptPackJson, null, 2)}
            </pre>
          </TextContainer>
        ) : (
          <p>Result not found</p>
        )}
      </Modal.Section>
    </Modal>
  );
}

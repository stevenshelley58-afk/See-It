import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useNavigation, useRouteError, isRouteErrorResponse, useRevalidator } from "@remix-run/react";
import { useState, useCallback, useEffect, useRef } from "react";
import {
    Page,
    Layout,
    Card,
    ResourceList,
    Text,
    Button,
    Badge,
    BlockStack,
    InlineStack,
    Select,
    Banner,
    Pagination
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getStatusInfo, formatErrorMessage } from "../utils/status-mapping";
import { StorageService } from "../services/storage.server";

import { PLANS } from "../billing";

export const loader = async ({ request }) => {
    const { admin, session, billing } = await authenticate.admin(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction") || "next";

    // Pagination parameters
    const pageSize = 20;
    let queryArgs = { first: pageSize };

    if (cursor) {
        if (direction === "previous") {
            queryArgs = { last: pageSize, before: cursor };
        } else {
            queryArgs = { first: pageSize, after: cursor };
        }
    }

    // 1. Fetch Page of Products
    const response = await admin.graphql(
        `#graphql
        query getProducts($first: Int, $last: Int, $after: String, $before: String) {
            products(first: $first, last: $last, after: $after, before: $before) {
                edges {
                    node {
                        id
                        title
                        handle
                        featuredImage {
                            id
                            url
                            altText
                        }
                    }
                    cursor
                }
                pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                }
            }
        }`,
        { variables: queryArgs }
    );

    const responseJson = await response.json();
    const { edges, pageInfo } = responseJson.data.products;
    const products = edges.map((edge) => edge.node);

    // 2. Billing Check & Shop Sync
    // Check if store has active PRO subscription
    let planId = PLANS.FREE.id;
    let dailyQuota = PLANS.FREE.dailyQuota;
    let monthlyQuota = PLANS.FREE.monthlyQuota;

    try {
        const { hasActivePayment } = await billing.check({
            plans: [PLANS.PRO.name],
            isTest: true, // Always allow test charges
        });

        if (hasActivePayment) {
            planId = PLANS.PRO.id;
            dailyQuota = PLANS.PRO.dailyQuota;
            monthlyQuota = PLANS.PRO.monthlyQuota;
        }
    } catch (error) {
        console.error("Billing check failed", error);
        // Fallback to FREE default safe
    }

    // Ensure Shop Record Exists & Is Synced
    let shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
    });

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
                plan: planId,
                dailyQuota: dailyQuota,
                monthlyQuota: monthlyQuota
            }
        });
    } else {
        // Sync plan if changed
        if (shop.plan !== planId) {
            shop = await prisma.shop.update({
                where: { id: shop.id },
                data: {
                    plan: planId,
                    dailyQuota: dailyQuota,
                    monthlyQuota: monthlyQuota
                }
            });
        }
    }

    // 3. Get Asset Status for Current Page Only
    let assetsMap = {};
    if (shop && products.length > 0) {
        const productIds = products.map(p => p.id.split('/').pop()); // Handle both gid and raw id if needed, usually gid in response
        // Note: product.id from GraphQL is "gid://shopify/Product/123456"
        // Database stores "123456" usually. Let's normalize.
        const normalizedIds = products.map(p => {
            return p.id.split('/').pop();
        });

        const assets = await prisma.productAsset.findMany({
            where: {
                shopId: shop.id,
                productId: { in: normalizedIds }
            }
        });

        // Generate fresh signed URLs for ready assets with preparedImageKey
        for (const a of assets) {
            let preparedImageUrlFresh = a.preparedImageUrl;

            // If we have a stable GCS key, generate a fresh signed URL (1 hour expiry)
            if (a.status === "ready" && a.preparedImageKey) {
                try {
                    preparedImageUrlFresh = await StorageService.getSignedReadUrl(a.preparedImageKey, 60 * 60 * 1000);
                } catch (err) {
                    console.error(`Failed to generate signed URL for asset ${a.id}:`, err);
                    // Fall back to stored URL (may be expired)
                }
            }

            assetsMap[`gid://shopify/Product/${a.productId}`] = {
                ...a,
                preparedImageUrlFresh
            };
        }
    }

    // 4. Get Global Status Counts (Aggregated)
    // This is cheap in SQL
    const statusGroups = await prisma.productAsset.groupBy({
        by: ['status'],
        where: { shopId: shop.id },
        _count: { status: true }
    });

    const statusCounts = { ready: 0, pending: 0, failed: 0, stale: 0, processing: 0, unprepared: 0 };
    statusGroups.forEach(group => {
        statusCounts[group.status] = group._count.status;
    });

    // Note: statusCounts.unprepared cannot be accurately calculated without total shop product count
    // We will omit it or set it to "many"
    statusCounts.unprepared = -1; // Indicator for "Unknown/Many"

    return json({
        products,
        assetsMap,
        statusCounts,
        pageInfo
    });
};

export default function Products() {
    const { products, assetsMap, statusCounts, pageInfo } = useLoaderData();
    const fetcher = useFetcher();
    const revalidator = useRevalidator();
    const [selectedItems, setSelectedItems] = useState([]);
    const [statusFilter, setStatusFilter] = useState("all");
    const [params, setParams] = useSearchParams();
    const navigation = useNavigation();
    const prevFetcherState = useRef(fetcher.state);

    const isLoading = navigation.state === "loading" || revalidator.state === "loading";

    // Revalidate page data after batch-prepare completes to show updated statuses
    useEffect(() => {
        // Detect transition from submitting/loading to idle (fetcher completed)
        if (prevFetcherState.current !== "idle" && fetcher.state === "idle" && fetcher.data) {
            // Revalidate after a short delay to let processor pick up the items
            const timer = setTimeout(() => {
                revalidator.revalidate();
            }, 1000);
            return () => clearTimeout(timer);
        }
        prevFetcherState.current = fetcher.state;
    }, [fetcher.state, fetcher.data, revalidator]);

    const handleSelectionChange = useCallback((selection) => {
        setSelectedItems(selection);
    }, []);

    const handleBatchPrepare = useCallback(() => {
        const formData = new FormData();
        // Extract numeric IDs from GIDs for the backend
        const numericIds = selectedItems.map(id => id.split('/').pop());
        formData.append("productIds", JSON.stringify(numericIds));
        // Use fetcher.submit instead of submit to stay on the page (no navigation)
        fetcher.submit(formData, { method: "post", action: "/api/products/batch-prepare" });
        setSelectedItems([]);
    }, [selectedItems, fetcher]);

    // Client-side filtering only affects the current page view, 
    // but useful for quick visual check on the page.
    const filteredProducts = products.filter((item) => {
        if (statusFilter === "all") return true;
        const asset = assetsMap[item.id];
        const status = asset ? asset.status : "unprepared";
        return status === statusFilter;
    });

    const filterOptions = [
        { label: `All`, value: "all" },
        { label: `Ready (${statusCounts.ready})`, value: "ready" },
        { label: `Pending (${statusCounts.pending})`, value: "pending" },
        { label: `Processing (${statusCounts.processing || 0})`, value: "processing" },
        { label: `Failed (${statusCounts.failed})`, value: "failed" },
    ];

    const handlePagination = (direction) => {
        const cursor = direction === "next" ? pageInfo.endCursor : pageInfo.startCursor;
        setParams(prev => {
            prev.set("cursor", cursor);
            prev.set("direction", direction);
            return prev;
        });
        setSelectedItems([]); // Clear selection on page change
    };

    return (
        <Page
            title="Products"
            primaryAction={
                selectedItems.length > 0 ? {
                    content: `Batch Prepare Selected (${selectedItems.length})`,
                    onAction: handleBatchPrepare,
                    loading: fetcher.state === "submitting" // Show spinner on button
                } : undefined
            }
        >
            <Layout>
                <Layout.Section>
                    {/* Show queued message from batch prepare action */}
                    {fetcher.data?.message && (
                        <Banner tone={fetcher.data.errors?.length > 0 ? "warning" : "success"}>
                            <p>{fetcher.data.message}</p>
                        </Banner>
                    )}

                    <Card>
                        <BlockStack gap="400">
                            <InlineStack align="spaceBetween">
                                <Select
                                    label="Filter page by status"
                                    options={filterOptions}
                                    value={statusFilter}
                                    onChange={setStatusFilter}
                                    labelInline
                                />
                                <Pagination
                                    hasPrevious={pageInfo.hasPreviousPage}
                                    onPrevious={() => handlePagination("previous")}
                                    hasNext={pageInfo.hasNextPage}
                                    onNext={() => handlePagination("next")}
                                />
                            </InlineStack>

                            <ResourceList
                                resourceName={{ singular: "product", plural: "products" }}
                                items={filteredProducts}
                                selectedItems={selectedItems}
                                onSelectionChange={handleSelectionChange}
                                selectable
                                loading={isLoading}
                                renderItem={(item) => {
                                    const { id, title, featuredImage } = item;
                                    const asset = assetsMap[id];
                                    const statusInfo = getStatusInfo(asset?.status);

                                    // Show prepared image for ready products
                                    const showPreparedImage = asset?.status === "ready" && asset?.preparedImageUrlFresh;

                                    return (
                                        <ResourceList.Item
                                            id={id}
                                            accessibilityLabel={`View details for ${title}`}
                                        >
                                            <InlineStack gap="400" align="start" blockAlign="start" wrap={false}>
                                                {/* Original product image */}
                                                <div style={{ width: '60px', height: '60px', flexShrink: 0 }}>
                                                    {featuredImage ? (
                                                        <img
                                                            src={featuredImage.url}
                                                            alt={featuredImage.altText || title}
                                                            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }}
                                                        />
                                                    ) : (
                                                        <div style={{ width: '100%', height: '100%', background: '#eee', borderRadius: '4px' }} />
                                                    )}
                                                </div>

                                                {/* Prepared image preview (background removed) - only for ready products */}
                                                {showPreparedImage && (
                                                    <div style={{ width: '60px', height: '60px', flexShrink: 0, position: 'relative' }}>
                                                        <img
                                                            src={asset.preparedImageUrlFresh}
                                                            alt={`${title} - prepared`}
                                                            style={{
                                                                width: '100%',
                                                                height: '100%',
                                                                objectFit: 'contain',
                                                                borderRadius: '4px',
                                                                background: 'repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%) 50% / 10px 10px'
                                                            }}
                                                        />
                                                        <span style={{
                                                            position: 'absolute',
                                                            bottom: '2px',
                                                            right: '2px',
                                                            fontSize: '8px',
                                                            background: 'rgba(0,0,0,0.6)',
                                                            color: 'white',
                                                            padding: '1px 3px',
                                                            borderRadius: '2px'
                                                        }}>BG Removed</span>
                                                    </div>
                                                )}

                                                <BlockStack gap="200" inlineAlign="start">
                                                    <Text variant="bodyMd" fontWeight="bold" as="h3">
                                                        {title}
                                                    </Text>
                                                    <InlineStack gap="200">
                                                        <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
                                                        {asset?.updatedAt && (
                                                            <Text variant="bodySm" tone="subdued">
                                                                {new Date(asset.updatedAt).toLocaleDateString()}
                                                            </Text>
                                                        )}
                                                    </InlineStack>
                                                    {/* Processing indicator */}
                                                    {asset?.status === 'processing' && (
                                                        <Text variant="bodySm" tone="attention">
                                                            Processing in background...
                                                        </Text>
                                                    )}
                                                </BlockStack>
                                            </InlineStack>
                                        </ResourceList.Item>
                                    );
                                }}
                            />

                            <InlineStack align="center">
                                <Pagination
                                    hasPrevious={pageInfo.hasPreviousPage}
                                    onPrevious={() => handlePagination("previous")}
                                    hasNext={pageInfo.hasNextPage}
                                    onNext={() => handlePagination("next")}
                                />
                            </InlineStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}

// Error boundary to catch and display errors gracefully
export function ErrorBoundary() {
    const error = useRouteError();

    let title = "Something went wrong";
    let message = "An unexpected error occurred while loading products. Please try refreshing the page.";

    if (isRouteErrorResponse(error)) {
        title = `${error.status} ${error.statusText}`;
        if (error.status === 401 || error.status === 403) {
            message = "You don't have permission to view this page. Please check your app installation.";
        } else if (error.status === 404) {
            message = "The products page could not be found.";
        } else {
            message = error.data?.message || "Failed to load products data.";
        }
    } else if (error instanceof Error) {
        message = error.message;
    }

    return (
        <Page title="Products">
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Banner title={title} tone="critical">
                                <p>{message}</p>
                            </Banner>
                            <InlineStack gap="300">
                                <Button onClick={() => window.location.reload()}>
                                    Refresh Page
                                </Button>
                                <Button url="/app" variant="plain">
                                    Go to Dashboard
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}


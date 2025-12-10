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
    Pagination,
    Modal,
    Spinner,
    Tooltip
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
    const batchFetcher = useFetcher();
    const singleFetcher = useFetcher();
    const revalidator = useRevalidator();
    const [selectedItems, setSelectedItems] = useState([]);
    const [statusFilter, setStatusFilter] = useState("all");
    const [params, setParams] = useSearchParams();
    const navigation = useNavigation();
    const prevBatchFetcherState = useRef(batchFetcher.state);
    const prevSingleFetcherState = useRef(singleFetcher.state);

    // Banner dismissal state
    const [showBanner, setShowBanner] = useState(false);
    const [bannerMessage, setBannerMessage] = useState("");
    const [bannerTone, setBannerTone] = useState("success");
    const bannerTimerRef = useRef(null);

    // Image modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [modalImage, setModalImage] = useState(null);
    const [modalTitle, setModalTitle] = useState("");
    const [modalPreparedImage, setModalPreparedImage] = useState(null);

    // Track which single item is being processed
    const [processingItemId, setProcessingItemId] = useState(null);

    // Only show loading on initial page navigation, not during background revalidation
    const isPageLoading = navigation.state === "loading";

    // Show subtle loading indicator during revalidation (but don't block UI)
    const isRevalidating = revalidator.state === "loading";

    // Handle banner display and auto-dismiss
    const showBannerWithTimeout = useCallback((message, tone = "success") => {
        // Clear any existing timer
        if (bannerTimerRef.current) {
            clearTimeout(bannerTimerRef.current);
        }

        setBannerMessage(message);
        setBannerTone(tone);
        setShowBanner(true);

        // Auto-dismiss after 5 seconds
        bannerTimerRef.current = setTimeout(() => {
            setShowBanner(false);
        }, 5000);
    }, []);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (bannerTimerRef.current) {
                clearTimeout(bannerTimerRef.current);
            }
        };
    }, []);

    // Handle batch fetcher completion
    useEffect(() => {
        if (prevBatchFetcherState.current !== "idle" && batchFetcher.state === "idle" && batchFetcher.data) {
            if (batchFetcher.data.message) {
                showBannerWithTimeout(
                    batchFetcher.data.message,
                    batchFetcher.data.errors?.length > 0 ? "warning" : "success"
                );
            }
            // Revalidate after a short delay to let processor pick up the items
            const timer = setTimeout(() => {
                revalidator.revalidate();
            }, 1500);
            return () => clearTimeout(timer);
        }
        prevBatchFetcherState.current = batchFetcher.state;
    }, [batchFetcher.state, batchFetcher.data, revalidator, showBannerWithTimeout]);

    // Handle single fetcher completion
    useEffect(() => {
        if (prevSingleFetcherState.current !== "idle" && singleFetcher.state === "idle" && singleFetcher.data) {
            setProcessingItemId(null);
            if (singleFetcher.data.message) {
                showBannerWithTimeout(
                    singleFetcher.data.message,
                    singleFetcher.data.error ? "critical" : "success"
                );
            }
            // Revalidate to show updated status
            const timer = setTimeout(() => {
                revalidator.revalidate();
            }, 1500);
            return () => clearTimeout(timer);
        }
        prevSingleFetcherState.current = singleFetcher.state;
    }, [singleFetcher.state, singleFetcher.data, revalidator, showBannerWithTimeout]);

    const handleSelectionChange = useCallback((selection) => {
        setSelectedItems(selection);
    }, []);

    const handleBatchPrepare = useCallback(() => {
        const formData = new FormData();
        // Extract numeric IDs from GIDs for the backend
        const numericIds = selectedItems.map(id => id.split('/').pop());
        formData.append("productIds", JSON.stringify(numericIds));
        // Use fetcher.submit instead of submit to stay on the page (no navigation)
        batchFetcher.submit(formData, { method: "post", action: "/api/products/batch-prepare" });
        setSelectedItems([]);
    }, [selectedItems, batchFetcher]);

    // Handle single item processing
    const handleSinglePrepare = useCallback((productId) => {
        const numericId = productId.split('/').pop();
        setProcessingItemId(productId);
        const formData = new FormData();
        formData.append("productId", numericId);
        singleFetcher.submit(formData, { method: "post", action: "/api/products/prepare" });
    }, [singleFetcher]);

    // Handle image click to open modal
    const handleImageClick = useCallback((title, originalUrl, preparedUrl) => {
        setModalTitle(title);
        setModalImage(originalUrl);
        setModalPreparedImage(preparedUrl || null);
        setModalOpen(true);
    }, []);

    const handleModalClose = useCallback(() => {
        setModalOpen(false);
        setModalImage(null);
        setModalPreparedImage(null);
    }, []);

    const handleDismissBanner = useCallback(() => {
        setShowBanner(false);
        if (bannerTimerRef.current) {
            clearTimeout(bannerTimerRef.current);
        }
    }, []);

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
        { label: `BG Removed (${statusCounts.ready})`, value: "ready" },
        { label: `Queued (${statusCounts.pending})`, value: "pending" },
        { label: `Processing (${statusCounts.processing || 0})`, value: "processing" },
        { label: `Error (${statusCounts.failed})`, value: "failed" },
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
                    content: `Remove BG (${selectedItems.length} selected)`,
                    onAction: handleBatchPrepare,
                    loading: batchFetcher.state === "submitting"
                } : undefined
            }
        >
            <Layout>
                <Layout.Section>
                    {/* Dismissible banner with auto-dismiss */}
                    {showBanner && (
                        <div style={{ marginBottom: '16px' }}>
                            <Banner
                                tone={bannerTone}
                                onDismiss={handleDismissBanner}
                            >
                                <p>{bannerMessage}</p>
                            </Banner>
                        </div>
                    )}

                    <Card>
                        <BlockStack gap="400">
                            <InlineStack align="space-between" blockAlign="center">
                                <InlineStack gap="300" blockAlign="center">
                                    <Select
                                        label="Filter by status"
                                        options={filterOptions}
                                        value={statusFilter}
                                        onChange={setStatusFilter}
                                        labelInline
                                    />
                                    {isRevalidating && (
                                        <InlineStack gap="200" blockAlign="center">
                                            <Spinner size="small" />
                                            <Text variant="bodySm" tone="subdued">Updating...</Text>
                                        </InlineStack>
                                    )}
                                </InlineStack>
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
                                loading={isPageLoading}
                                renderItem={(item) => {
                                    const { id, title, featuredImage } = item;
                                    const asset = assetsMap[id];
                                    const statusInfo = getStatusInfo(asset?.status);
                                    const isProcessingThis = processingItemId === id;
                                    const isItemBusy = isProcessingThis || asset?.status === 'pending' || asset?.status === 'processing';

                                    // Show prepared image for ready products
                                    const showPreparedImage = asset?.status === "ready" && asset?.preparedImageUrlFresh;

                                    return (
                                        <ResourceList.Item
                                            id={id}
                                            accessibilityLabel={`View details for ${title}`}
                                        >
                                            <InlineStack gap="400" align="space-between" blockAlign="center" wrap={false}>
                                                <InlineStack gap="400" align="start" blockAlign="center" wrap={false}>
                                                    {/* Original product image - clickable */}
                                                    <div
                                                        style={{
                                                            width: '64px',
                                                            height: '64px',
                                                            flexShrink: 0,
                                                            cursor: featuredImage ? 'pointer' : 'default',
                                                            borderRadius: '8px',
                                                            overflow: 'hidden',
                                                            border: '1px solid #e1e3e5',
                                                            transition: 'box-shadow 0.2s ease'
                                                        }}
                                                        onClick={() => featuredImage && handleImageClick(
                                                            title,
                                                            featuredImage.url,
                                                            showPreparedImage ? asset.preparedImageUrlFresh : null
                                                        )}
                                                        onMouseEnter={(e) => featuredImage && (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)')}
                                                        onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                                                    >
                                                        {featuredImage ? (
                                                            <img
                                                                src={featuredImage.url}
                                                                alt={featuredImage.altText || title}
                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            />
                                                        ) : (
                                                            <div style={{
                                                                width: '100%',
                                                                height: '100%',
                                                                background: '#f6f6f7',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center'
                                                            }}>
                                                                <Text variant="bodySm" tone="subdued">No image</Text>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Prepared image preview (background removed) - clickable */}
                                                    {showPreparedImage && (
                                                        <div
                                                            style={{
                                                                width: '64px',
                                                                height: '64px',
                                                                flexShrink: 0,
                                                                position: 'relative',
                                                                cursor: 'pointer',
                                                                borderRadius: '8px',
                                                                overflow: 'hidden',
                                                                border: '1px solid #e1e3e5',
                                                                transition: 'box-shadow 0.2s ease'
                                                            }}
                                                            onClick={() => handleImageClick(
                                                                title,
                                                                featuredImage?.url,
                                                                asset.preparedImageUrlFresh
                                                            )}
                                                            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'}
                                                            onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                                                        >
                                                            <img
                                                                src={asset.preparedImageUrlFresh}
                                                                alt={`${title} - background removed`}
                                                                style={{
                                                                    width: '100%',
                                                                    height: '100%',
                                                                    objectFit: 'contain',
                                                                    background: 'repeating-conic-gradient(#f0f0f0 0% 25%, white 0% 50%) 50% / 8px 8px'
                                                                }}
                                                            />
                                                            <span style={{
                                                                position: 'absolute',
                                                                bottom: '2px',
                                                                right: '2px',
                                                                fontSize: '9px',
                                                                background: 'rgba(0,128,0,0.8)',
                                                                color: 'white',
                                                                padding: '2px 4px',
                                                                borderRadius: '3px',
                                                                fontWeight: '500'
                                                            }}>Done</span>
                                                        </div>
                                                    )}

                                                    <BlockStack gap="100">
                                                        <Text variant="bodyMd" fontWeight="semibold" as="h3">
                                                            {title}
                                                        </Text>
                                                        <InlineStack gap="200" blockAlign="center">
                                                            <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
                                                            {asset?.updatedAt && (
                                                                <Text variant="bodySm" tone="subdued">
                                                                    {new Date(asset.updatedAt).toLocaleDateString()}
                                                                </Text>
                                                            )}
                                                        </InlineStack>
                                                        {/* Show error message on hover if failed */}
                                                        {asset?.status === 'failed' && asset?.errorMessage && (
                                                            <Tooltip content={asset.errorMessage}>
                                                                <Text variant="bodySm" tone="critical">
                                                                    {formatErrorMessage(asset.errorMessage, 40)}
                                                                </Text>
                                                            </Tooltip>
                                                        )}
                                                    </BlockStack>
                                                </InlineStack>

                                                {/* Single item action button */}
                                                <div style={{ flexShrink: 0 }}>
                                                    {featuredImage && (
                                                        <Button
                                                            size="slim"
                                                            onClick={() => handleSinglePrepare(id)}
                                                            loading={isProcessingThis}
                                                            disabled={isItemBusy}
                                                            variant={asset?.status === 'failed' ? 'primary' : 'secondary'}
                                                            tone={asset?.status === 'failed' ? 'critical' : undefined}
                                                        >
                                                            {statusInfo.showSpinner ? (
                                                                <InlineStack gap="200" blockAlign="center">
                                                                    <Spinner size="small" />
                                                                    <span>{statusInfo.buttonLabel}</span>
                                                                </InlineStack>
                                                            ) : (
                                                                statusInfo.buttonLabel
                                                            )}
                                                        </Button>
                                                    )}
                                                </div>
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

            {/* Image Preview Modal */}
            <Modal
                open={modalOpen}
                onClose={handleModalClose}
                title={modalTitle}
                large
            >
                <Modal.Section>
                    <BlockStack gap="400">
                        <InlineStack gap="400" align="center" wrap>
                            {/* Original Image */}
                            <BlockStack gap="200" inlineAlign="center">
                                <Text variant="headingSm" as="h3">Original</Text>
                                <div style={{
                                    maxWidth: '400px',
                                    maxHeight: '400px',
                                    border: '1px solid #e1e3e5',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    background: '#f6f6f7'
                                }}>
                                    {modalImage && (
                                        <img
                                            src={modalImage}
                                            alt="Original product"
                                            style={{
                                                maxWidth: '100%',
                                                maxHeight: '400px',
                                                objectFit: 'contain'
                                            }}
                                        />
                                    )}
                                </div>
                            </BlockStack>

                            {/* Prepared Image (if available) */}
                            {modalPreparedImage && (
                                <BlockStack gap="200" inlineAlign="center">
                                    <Text variant="headingSm" as="h3">Background Removed</Text>
                                    <div style={{
                                        maxWidth: '400px',
                                        maxHeight: '400px',
                                        border: '1px solid #e1e3e5',
                                        borderRadius: '8px',
                                        overflow: 'hidden',
                                        background: 'repeating-conic-gradient(#e8e8e8 0% 25%, white 0% 50%) 50% / 16px 16px'
                                    }}>
                                        <img
                                            src={modalPreparedImage}
                                            alt="Background removed"
                                            style={{
                                                maxWidth: '100%',
                                                maxHeight: '400px',
                                                objectFit: 'contain'
                                            }}
                                        />
                                    </div>
                                </BlockStack>
                            )}
                        </InlineStack>

                        {/* Download button for prepared image */}
                        {modalPreparedImage && (
                            <InlineStack align="center">
                                <Button
                                    url={modalPreparedImage}
                                    download
                                    external
                                >
                                    Download Processed Image
                                </Button>
                            </InlineStack>
                        )}
                    </BlockStack>
                </Modal.Section>
            </Modal>
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

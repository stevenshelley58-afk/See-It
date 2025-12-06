import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSubmit } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
    Page,
    Layout,
    Card,
    ResourceList,
    Thumbnail,
    Text,
    Button,
    Badge,
    BlockStack,
    InlineStack,
    Select,
    Banner
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getStatusInfo, formatErrorMessage } from "../utils/status-mapping";

export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    // Fetch ALL products using pagination
    let allProducts = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
        const response = await admin.graphql(
            `#graphql
            query getProducts($cursor: String) {
                products(first: 50, after: $cursor) {
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
                    }
                }
            }`,
            { variables: { cursor } }
        );

        const responseJson = await response.json();
        const { edges, pageInfo } = responseJson.data.products;
        
        allProducts = [...allProducts, ...edges.map((edge) => edge.node)];
        hasNextPage = pageInfo.hasNextPage;
        
        if (edges.length > 0) {
            cursor = edges[edges.length - 1].cursor;
        }
    }

    const products = allProducts;

    let shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
    });

    // Create shop if it doesn't exist
    if (!shop) {
        // Get shop details from Shopify
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
        
        const { PLANS } = await import("../billing");
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

    let assetsMap = {};
    let statusCounts = { ready: 0, pending: 0, failed: 0, stale: 0, unprepared: 0 };

    if (shop) {
        const assets = await prisma.productAsset.findMany({
            where: { shopId: shop.id }
        });
        assets.forEach(a => {
            assetsMap[a.productId] = a;
            statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
        });
    }

    // Count unprepared products
    statusCounts.unprepared = products.length - Object.keys(assetsMap).length;

    return json({ products, assetsMap, statusCounts });
};

export default function Products() {
    const { products, assetsMap, statusCounts } = useLoaderData();
    const fetcher = useFetcher();
    const submit = useSubmit();
    const [selectedItems, setSelectedItems] = useState([]);
    const [statusFilter, setStatusFilter] = useState("all");

    const handleSelectionChange = useCallback((selection) => {
        setSelectedItems(selection);
    }, []);

    const handleBatchPrepare = useCallback(() => {
        const formData = new FormData();
        formData.append("productIds", JSON.stringify(selectedItems));
        submit(formData, { method: "post", action: "/api/products/batch-prepare" });
        setSelectedItems([]);
    }, [selectedItems, submit]);

    const handleBatchRegenerateStale = useCallback(() => {
        const staleProductIds = products
            .filter(p => assetsMap[p.id]?.status === "stale")
            .map(p => p.id);

        const formData = new FormData();
        formData.append("productIds", JSON.stringify(staleProductIds));
        submit(formData, { method: "post", action: "/api/products/batch-prepare" });
    }, [products, assetsMap, submit]);

    // Filter products based on selected status
    const filteredProducts = products.filter((item) => {
        if (statusFilter === "all") return true;

        const asset = assetsMap[item.id];
        const status = asset ? asset.status : "unprepared";

        return status === statusFilter;
    });

    const filterOptions = [
        { label: `All (${products.length})`, value: "all" },
        { label: `Ready (${statusCounts.ready})`, value: "ready" },
        { label: `Pending (${statusCounts.pending})`, value: "pending" },
        { label: `Failed (${statusCounts.failed})`, value: "failed" },
        { label: `Stale (${statusCounts.stale})`, value: "stale" },
        { label: `Unprepared (${statusCounts.unprepared})`, value: "unprepared" },
    ];

    // Show error toast if prepare action failed
    useEffect(() => {
        if (fetcher.data?.error) {
            // Error is already shown in Banner, but we could add a toast here if needed
            console.error("Prepare action error:", fetcher.data.error, "Request ID:", fetcher.data.requestId);
        }
    }, [fetcher.data]);

    return (
        <Page
            title="Products"
            primaryAction={
                selectedItems.length > 0 ? {
                    content: `Batch Prepare Selected (${selectedItems.length})`,
                    onAction: handleBatchPrepare,
                } : undefined
            }
            secondaryActions={
                statusCounts.stale > 0 ? [{
                    content: `Batch Regenerate Stale (${statusCounts.stale})`,
                    onAction: handleBatchRegenerateStale,
                }] : []
            }
        >
            <Layout>
                <Layout.Section>
                    {fetcher.data?.message || fetcher.data?.error ? (
                        <Banner tone={fetcher.data.errors?.length > 0 || fetcher.data.error ? "critical" : "success"}>
                            <BlockStack gap="200">
                                <p>{fetcher.data.message || fetcher.data.error}</p>
                                {fetcher.data.requestId && (
                                    <Text variant="bodySm" tone="subdued">
                                        Request ID: {fetcher.data.requestId} (use this to correlate with backend logs)
                                    </Text>
                                )}
                                {fetcher.data.errors?.length > 0 && (
                                    <BlockStack gap="100">
                                        {fetcher.data.errors.map((err: any, idx: number) => (
                                            <Text key={idx} variant="bodySm" tone="critical">
                                                Product {err.productId}: {err.error}
                                            </Text>
                                        ))}
                                    </BlockStack>
                                )}
                            </BlockStack>
                        </Banner>
                    ) : null}
                    <Card>
                        <BlockStack gap="400">
                            <Select
                                label="Filter by status"
                                options={filterOptions}
                                value={statusFilter}
                                onChange={setStatusFilter}
                            />
                            <ResourceList
                                resourceName={{ singular: "product", plural: "products" }}
                                items={filteredProducts}
                                selectedItems={selectedItems}
                                onSelectionChange={handleSelectionChange}
                                selectable
                                renderItem={(item) => {
                                    const { id, title, featuredImage } = item;
                                    const asset = assetsMap[id];
                                    const statusInfo = getStatusInfo(asset?.status);

                                    return (
                                        <ResourceList.Item
                                            id={id}
                                            accessibilityLabel={`View details for ${title}`}
                                        >
                                            <InlineStack gap="400" align="start" blockAlign="start" wrap={false}>
                                                {/* Image comparison section */}
                                                <div style={{ 
                                                    display: 'flex', 
                                                    gap: '12px', 
                                                    flexShrink: 0,
                                                    padding: '8px',
                                                    background: '#f6f6f7',
                                                    borderRadius: '8px'
                                                }}>
                                                    {/* Original image */}
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ 
                                                            width: '80px', 
                                                            height: '80px', 
                                                            borderRadius: '6px',
                                                            overflow: 'hidden',
                                                            border: '1px solid #e1e3e5',
                                                            background: 'white'
                                                        }}>
                                                            <img 
                                                                src={featuredImage?.url || ""} 
                                                                alt={featuredImage?.altText || title}
                                                                style={{ 
                                                                    width: '100%', 
                                                                    height: '100%', 
                                                                    objectFit: 'cover' 
                                                                }}
                                                            />
                                                        </div>
                                                        <Text variant="bodySm" tone="subdued" as="p">Original</Text>
                                                    </div>

                                                    {/* Arrow or separator */}
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center',
                                                        color: '#8c9196',
                                                        fontSize: '18px'
                                                    }}>
                                                        →
                                                    </div>

                                                    {/* Prepared image */}
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ 
                                                            width: '80px', 
                                                            height: '80px', 
                                                            borderRadius: '6px',
                                                            overflow: 'hidden',
                                                            border: asset?.status === 'ready' ? '2px solid #008060' : '1px dashed #8c9196',
                                                            background: 'white',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}>
                                                            {asset?.preparedImageUrl ? (
                                                                <img 
                                                                    src={asset.preparedImageUrl} 
                                                                    alt={`Prepared ${title}`}
                                                                    style={{ 
                                                                        width: '100%', 
                                                                        height: '100%', 
                                                                        objectFit: 'cover' 
                                                                    }}
                                                                />
                                                            ) : (
                                                                <Text variant="bodySm" tone="subdued" as="span">—</Text>
                                                            )}
                                                        </div>
                                                        <Text variant="bodySm" tone={asset?.status === 'ready' ? 'success' : 'subdued'} as="p">
                                                            {asset?.status === 'ready' ? '✓ Prepared' : 'Prepared'}
                                                        </Text>
                                                    </div>
                                                </div>

                                                {/* Product info section */}
                                                <BlockStack gap="200" inlineAlign="start">
                                                    <Text variant="bodyMd" fontWeight="bold" as="h3">
                                                        {title}
                                                    </Text>
                                                    <InlineStack gap="200" align="start">
                                                        <Badge tone={statusInfo.tone}>
                                                            {statusInfo.label}
                                                        </Badge>
                                                    </InlineStack>
                                                    {statusInfo.explanation && (
                                                        <Text variant="bodySm" tone="subdued">
                                                            {statusInfo.explanation}
                                                        </Text>
                                                    )}
                                                    {asset?.status === "failed" && asset?.errorMessage && (
                                                        <BlockStack gap="100">
                                                            <Text variant="bodySm" tone="critical" fontWeight="medium">
                                                                Error: {formatErrorMessage(asset.errorMessage)}
                                                            </Text>
                                                            {fetcher.data?.requestId && (
                                                                <Text variant="bodySm" tone="subdued">
                                                                    Request ID: {fetcher.data.requestId}
                                                                </Text>
                                                            )}
                                                        </BlockStack>
                                                    )}
                                                    {asset?.updatedAt && (
                                                        <Text variant="bodySm" tone="subdued">
                                                            Updated: {new Date(asset.updatedAt).toLocaleString()}
                                                        </Text>
                                                    )}
                                                </BlockStack>

                                                {/* Action button - pushed to the right */}
                                                <div style={{ marginLeft: 'auto' }}>
                                                    <fetcher.Form method="post" action="/api/products/prepare">
                                                        <input type="hidden" name="productId" value={id} />
                                                        <input type="hidden" name="imageUrl" value={featuredImage?.url || ""} />
                                                        <input type="hidden" name="imageId" value={featuredImage?.id || ""} />
                                                        <Button 
                                                            submit 
                                                            disabled={statusInfo.buttonDisabled || !featuredImage}
                                                            loading={statusInfo.showSpinner && fetcher.state === "submitting"}
                                                        >
                                                            {statusInfo.buttonLabel}
                                                        </Button>
                                                    </fetcher.Form>
                                                </div>
                                            </InlineStack>
                                        </ResourceList.Item>
                                    );
                                }}
                            />
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}


import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSubmit } from "@remix-run/react";
import { useState, useCallback } from "react";
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

export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    const response = await admin.graphql(
        `#graphql
      query {
        products(first: 20) {
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
          }
        }
      }`
    );

    const responseJson = await response.json();
    const products = responseJson.data.products.edges.map((edge) => edge.node);

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

    const getBadgeInfo = (asset) => {
        if (!asset) return { tone: "new", label: "unprepared", explanation: null };

        const status = asset.status;

        // Check if asset is orphaned (stale + configJson.orphaned flag)
        let configJson = {};
        try {
            configJson = asset.configJson ? JSON.parse(asset.configJson) : {};
        } catch (e) {
            console.error("Failed to parse configJson:", e);
        }

        if (status === "stale" && configJson.orphaned) {
            return {
                tone: "info",
                label: "Orphaned",
                explanation: "Source image no longer exists"
            };
        }

        if (status === "stale") {
            return {
                tone: "warning",
                label: "Stale",
                explanation: "Product image has changed"
            };
        }

        if (status === "ready") return { tone: "success", label: "ready", explanation: null };
        if (status === "pending") return { tone: "attention", label: "pending", explanation: null };
        if (status === "failed") return { tone: "critical", label: "failed", explanation: null };

        return { tone: "new", label: status, explanation: null };
    };

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
                        <Banner tone={fetcher.data.errors?.length > 0 || fetcher.data.error ? "warning" : "success"}>
                            <p>{fetcher.data.message || fetcher.data.error}</p>
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
                                    const badgeInfo = getBadgeInfo(asset);

                                    return (
                                        <ResourceList.Item
                                            id={id}
                                            media={
                                                <Thumbnail
                                                    source={featuredImage?.url || ""}
                                                    alt={featuredImage?.altText || title}
                                                />
                                            }
                                            accessibilityLabel={`View details for ${title}`}
                                        >
                                            <InlineStack align="space-between" blockAlign="center">
                                                <BlockStack gap="200">
                                                    <Text variant="bodyMd" fontWeight="bold" as="h3">
                                                        {title}
                                                    </Text>
                                                    <Badge tone={badgeInfo.tone}>
                                                        {badgeInfo.label}
                                                    </Badge>
                                                    {badgeInfo.explanation && (
                                                        <Text variant="bodySm" tone="subdued">
                                                            {badgeInfo.explanation}
                                                        </Text>
                                                    )}
                                                    {asset?.status === "failed" && asset?.errorMessage && (
                                                        <Text variant="bodySm" tone="critical">
                                                            Error: {asset.errorMessage}
                                                        </Text>
                                                    )}
                                                    {asset?.updatedAt && (
                                                        <Text variant="bodySm" tone="subdued">
                                                            Updated: {new Date(asset.updatedAt).toLocaleString()}
                                                        </Text>
                                                    )}
                                                </BlockStack>
                                                <fetcher.Form method="post" action="/api/products/prepare">
                                                    <input type="hidden" name="productId" value={id} />
                                                    <input type="hidden" name="imageUrl" value={featuredImage?.url || ""} />
                                                    <input type="hidden" name="imageId" value={featuredImage?.id || ""} />
                                                    <Button submit disabled={asset?.status === "pending" || !featuredImage}>
                                                        {asset?.status === "ready" ? "Regenerate" : asset?.status === "pending" ? "Preparing..." : asset?.status === "failed" || asset?.status === "stale" ? "Retry" : "Prepare"}
                                                    </Button>
                                                </fetcher.Form>
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


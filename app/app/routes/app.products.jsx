import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse, useRevalidator, Link } from "@remix-run/react";
import { useState, useCallback, useEffect, useRef } from "react";
import { TitleBar } from "@shopify/app-bridge-react";
import { Modal, BlockStack, InlineStack, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../billing";
import { StorageService } from "../services/storage.server";
import { ManualSegmentModal } from "../components/ManualSegmentModal";
import { PageShell, Button } from "../components/ui";

export const loader = async ({ request }) => {
    const { admin, session, billing } = await authenticate.admin(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction") || "next";
    const filter = url.searchParams.get("filter") || "all";

    const pageSize = 12;
    let queryArgs = { first: pageSize };
    if (cursor) {
        queryArgs = direction === "previous"
            ? { last: pageSize, before: cursor }
            : { first: pageSize, after: cursor };
    }

    const response = await admin.graphql(
        `#graphql
        query getProducts($first: Int, $last: Int, $after: String, $before: String) {
            products(first: $first, last: $last, after: $after, before: $before) {
                edges {
                    node {
                        id
                        title
                        handle
                        featuredImage { id url altText }
                        images(first: 10) { edges { node { id url altText } } }
                    }
                    cursor
                }
                pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            }
        }`,
        { variables: queryArgs }
    );

    const responseJson = await response.json();
    const { edges, pageInfo } = responseJson.data.products;
    const products = edges.map((edge) => edge.node);

    // Billing check
    let planId = PLANS.FREE.id;
    let dailyQuota = PLANS.FREE.dailyQuota;
    let monthlyQuota = PLANS.FREE.monthlyQuota;

    try {
        const { hasActivePayment } = await billing.check({
            plans: [PLANS.PRO.name],
            isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false'
        });
        if (hasActivePayment) {
            planId = PLANS.PRO.id;
            dailyQuota = PLANS.PRO.dailyQuota;
            monthlyQuota = PLANS.PRO.monthlyQuota;
        }
    } catch (e) {
        console.error("Billing check failed", e);
    }

    // Shop sync
    let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) {
        const shopResponse = await admin.graphql(`#graphql query { shop { id } }`);
        const shopData = await shopResponse.json();
        const shopifyShopId = shopData.data.shop.id.replace('gid://shopify/Shop/', '');
        shop = await prisma.shop.create({
            data: {
                shopDomain: session.shop,
                shopifyShopId,
                accessToken: session.accessToken || "pending",
                plan: planId,
                dailyQuota,
                monthlyQuota
            }
        });
    } else if (shop.plan !== planId) {
        shop = await prisma.shop.update({
            where: { id: shop.id },
            data: { plan: planId, dailyQuota, monthlyQuota }
        });
    }

    // Assets map
    let assetsMap = {};
    if (products.length > 0) {
        const normalizedIds = products.map(p => p.id.split('/').pop());
        const assets = await prisma.productAsset.findMany({
            where: { shopId: shop.id, productId: { in: normalizedIds } }
        });

        for (const a of assets) {
            let preparedImageUrlFresh = a.preparedImageUrl;
            if (a.status === "ready" && a.preparedImageKey) {
                try {
                    preparedImageUrlFresh = await StorageService.getSignedReadUrl(a.preparedImageKey, 60 * 60 * 1000);
                } catch (err) {
                    console.error(`Failed to sign URL for asset ${a.id}`);
                }
            }
            assetsMap[`gid://shopify/Product/${a.productId}`] = {
                ...a,
                preparedImageUrlFresh,
                renderInstructions: a.renderInstructions || ""
            };
        }
    }

    // Usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthlyUsageAgg = await prisma.usageDaily.aggregate({
        where: { shopId: shop.id, date: { gte: startOfMonth } },
        _sum: { compositeRenders: true }
    });
    const monthlyUsage = monthlyUsageAgg._sum.compositeRenders || 0;

    // Status counts
    const statusGroups = await prisma.productAsset.groupBy({
        by: ['status'],
        where: { shopId: shop.id },
        _count: { status: true }
    });
    const statusCounts = { ready: 0, pending: 0, failed: 0, processing: 0 };
    statusGroups.forEach(g => { statusCounts[g.status] = g._count.status; });

    return json({
        products,
        assetsMap,
        statusCounts,
        pageInfo,
        usage: { monthly: monthlyUsage },
        quota: { monthly: shop.monthlyQuota },
        isPro: shop.plan === PLANS.PRO.id,
        filter
    });
};

export default function Products() {
    const { products, assetsMap, usage, quota, isPro } = useLoaderData();
    const singleFetcher = useFetcher();
    const revalidator = useRevalidator();

    // UI state
    const [processingId, setProcessingId] = useState(null);
    const [toast, setToast] = useState(null);

    // Image selection modal
    const [modalOpen, setModalOpen] = useState(false);
    const [modalProduct, setModalProduct] = useState(null);
    const [selectedImg, setSelectedImg] = useState(0);

    // Manual adjust modal
    const [adjustProduct, setAdjustProduct] = useState(null);
    const [adjustStartInDraw, setAdjustStartInDraw] = useState(false);

    const prevState = useRef(singleFetcher.state);

    const showToast = useCallback((msg, type = "info") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }, []);

    // Handle API responses
    useEffect(() => {
        if (prevState.current !== "idle" && singleFetcher.state === "idle" && singleFetcher.data) {
            setProcessingId(null);
            if (singleFetcher.data.success) {
                showToast(singleFetcher.data.message || "Background removed!", "success");
            } else if (singleFetcher.data.error) {
                showToast(singleFetcher.data.error, "err");
            }
            setTimeout(() => revalidator.revalidate(), 1200);
        }
        prevState.current = singleFetcher.state;
    }, [singleFetcher.state, singleFetcher.data, showToast, revalidator]);

    // Prepare product (auto background removal)
    const handlePrepare = useCallback((product, imageUrl = null) => {
        const numId = product.id.split('/').pop();
        setProcessingId(product.id);
        const fd = new FormData();
        fd.append("productId", numId);
        if (imageUrl) fd.append("imageUrl", imageUrl);
        singleFetcher.submit(fd, { method: "post", action: "/api/products/remove-background" });
    }, [singleFetcher]);

    // Open image selection modal
    const openImageModal = useCallback((product) => {
        setModalProduct(product);
        setSelectedImg(0);
        setModalOpen(true);
    }, []);

    // Open adjust modal (ManualSegmentModal)
    const openAdjustModal = useCallback((product, startInDraw = true) => {
        setAdjustStartInDraw(startInDraw);
        setAdjustProduct(product);
    }, []);

    return (
        <>
            <TitleBar title="See It Products" />
            <PageShell>
                {/* Header */}
                <div className="flex items-start md:items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 tracking-tight">
                            Products
                        </h1>
                        <p className="text-neutral-500 text-sm mt-0.5">
                            Manage your product visualizations
                        </p>
                    </div>
                    <Button
                        variant="primary"
                        className="flex-shrink-0"
                        onClick={() => revalidator.revalidate()}
                    >
                        Sync Products
                    </Button>
                </div>

                {/* Quota bar */}
                <div className="bg-white rounded-xl border border-neutral-200 p-3 md:p-4 flex items-center justify-between text-sm">
                    <span className="text-neutral-600">
                        <strong className="text-neutral-900">{usage.monthly}</strong> / {quota.monthly} this month
                    </span>
                    {!isPro && (
                        <Link to="/app/billing" className="text-neutral-900 font-medium hover:underline">
                            Upgrade →
                        </Link>
                    )}
                </div>

                {/* Product Grid */}
                <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                    {products.length === 0 ? (
                        <div className="p-10 text-center">
                            <Text tone="subdued" as="p">No products found</Text>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-medium">
                                    <tr>
                                        <th className="px-4 py-3 font-normal w-16">Image</th>
                                        <th className="px-4 py-3 font-normal">Product</th>
                                        <th className="px-4 py-3 font-normal">Status</th>
                                        <th className="px-4 py-3 font-normal text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {products.map((product) => {
                                        let asset = null;
                                        try {
                                            const pid = product.id.split('/').pop();
                                            const key = `gid://shopify/Product/${pid}`;
                                            asset = assetsMap ? assetsMap[key] : null;
                                        } catch (e) {
                                            console.error("Error accessing asset for product", product.id, e);
                                        }

                                        const status = asset?.status || 'pending';
                                        const hasPrepared = !!asset?.preparedImageUrlFresh || !!asset?.preparedImageUrl;

                                        return (
                                            <tr key={product.id} className="hover:bg-neutral-50/50 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="w-10 h-10 rounded-lg border border-neutral-200 overflow-hidden bg-white flex items-center justify-center">
                                                        {product.featuredImage ? (
                                                            <img src={product.featuredImage.url} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-4 h-4 rounded-full bg-neutral-200" />
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-neutral-900">{product.title}</div>
                                                    <div className="text-neutral-500 text-xs truncate max-w-[200px]">
                                                        {product.handle}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${status === 'ready' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                        status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                                                            status === 'processing' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                'bg-neutral-100 text-neutral-600 border-neutral-200'
                                                        }`}>
                                                        {status === 'ready' && hasPrepared ? 'Ready' :
                                                            status === 'ready' ? 'Ready (Original)' :
                                                                status.charAt(0).toUpperCase() + status.slice(1)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {processingId === product.id ? (
                                                            <div className="h-8 px-3 flex items-center text-neutral-400">
                                                                <span className="animate-spin mr-2">⟳</span> Processing...
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={() => openAdjustModal(product, true)}
                                                                >
                                                                    Draw Mask
                                                                </Button>
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={() => openImageModal(product)}
                                                                >
                                                                    Auto-Remove
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Pagination */}
                    <div className="border-t border-neutral-200 p-3 flex justify-center gap-2">
                        {pageInfo?.hasPreviousPage && (
                            <Link to={`?cursor=${pageInfo.startCursor}&direction=previous&filter=${filter}`}>
                                <Button variant="secondary" size="sm">Previous</Button>
                            </Link>
                        )}
                        {pageInfo?.hasNextPage && (
                            <Link to={`?cursor=${pageInfo.endCursor}&direction=next&filter=${filter}`}>
                                <Button variant="secondary" size="sm">Next</Button>
                            </Link>
                        )}
                    </div>
                </div>
            </PageShell>

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg text-sm font-medium text-white z-50 shadow-lg ${toast.type === 'success' ? 'bg-emerald-600' :
                    toast.type === 'err' ? 'bg-red-600' :
                        'bg-neutral-900'
                    }`}>
                    {toast.msg}
                </div>
            )}

            {/* Image Selection Modal - Keep Polaris Modal */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={modalProduct?.title || "Select image"}
            >
                <Modal.Section>
                    {modalProduct && (
                        <BlockStack gap="400">
                            <div className="bg-neutral-50 rounded-xl p-4 flex justify-center min-h-[240px] items-center">
                                {modalProduct.images?.edges?.[selectedImg] ? (
                                    <img
                                        src={modalProduct.images.edges[selectedImg].node.url}
                                        alt=""
                                        className="max-w-full max-h-[300px] object-contain"
                                    />
                                ) : modalProduct.featuredImage ? (
                                    <img
                                        src={modalProduct.featuredImage.url}
                                        alt=""
                                        className="max-w-full max-h-[300px] object-contain"
                                    />
                                ) : (
                                    <Text tone="subdued">No image</Text>
                                )}
                            </div>

                            {modalProduct.images?.edges?.length > 1 && (
                                <div className="flex gap-2 flex-wrap">
                                    {modalProduct.images.edges.map((edge, idx) => (
                                        <div
                                            key={edge.node.id}
                                            onClick={() => setSelectedImg(idx)}
                                            className={`w-14 h-14 rounded-lg overflow-hidden cursor-pointer border-2 ${idx === selectedImg ? 'border-neutral-900' : 'border-neutral-200'
                                                }`}
                                        >
                                            <img
                                                src={edge.node.url}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            <InlineStack align="end" gap="200">
                                <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
                                <Button
                                    variant="primary"
                                    onClick={() => {
                                        handlePrepare(
                                            modalProduct,
                                            modalProduct.images?.edges?.[selectedImg]?.node?.url || modalProduct.featuredImage?.url
                                        );
                                        setModalOpen(false);
                                    }}
                                >
                                    Remove background
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    )}
                </Modal.Section>
            </Modal>

            {/* Manual Adjustment Modal */}
            {adjustProduct && (
                <ManualSegmentModal
                    open={!!adjustProduct}
                    onClose={() => setAdjustProduct(null)}
                    productId={adjustProduct.id.split('/').pop()}
                    productTitle={adjustProduct.title}
                    sourceImageUrl={
                        assetsMap[adjustProduct.id]?.sourceImageUrl ||
                        adjustProduct.featuredImage?.url
                    }
                    productImages={adjustProduct.images?.edges?.map(e => ({
                        url: e.node.url,
                        altText: e.node.altText
                    })) || []}
                    startInDrawMode={adjustStartInDraw}
                    onSuccess={() => {
                        showToast("Background updated!", "success");
                        setTimeout(() => revalidator.revalidate(), 500);
                    }}
                />
            )}
        </>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    let title = "Error";
    let message = "Something went wrong";

    if (isRouteErrorResponse(error)) {
        title = `${error.status}`;
        message = error.data?.message || error.statusText;
    } else if (error instanceof Error) {
        message = error.message;
    }

    return (
        <>
            <TitleBar title="See It Products" />
            <PageShell>
                <div className="bg-white rounded-xl border border-neutral-200 p-6">
                    <div className="space-y-4">
                        <div>
                            <h1 className="text-lg font-semibold text-red-600">{title}</h1>
                            <p className="text-sm text-neutral-600 mt-1">{message}</p>
                        </div>
                        <Button variant="primary" onClick={() => window.location.reload()}>
                            Refresh
                        </Button>
                    </div>
                </div>
            </PageShell>
        </>
    );
}

import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse, useRevalidator, Link } from "@remix-run/react";
import { useState, useCallback, useEffect, useRef } from "react";
import { TitleBar } from "@shopify/app-bridge-react";
import { Modal, BlockStack, InlineStack, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../billing";
import { StorageService } from "../services/storage.server";
import { PageShell, Button } from "../components/ui";
import { ProductDetailPanel } from "../components/ProductDetailPanel";

export const loader = async ({ request }) => {
    const { admin, session, billing } = await authenticate.admin(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction") || "next";
    const statusFilter = url.searchParams.get("status") || "all";
    const searchQuery = url.searchParams.get("q") || "";

    const pageSize = 12;
    let queryArgs = { first: pageSize };
    if (cursor) {
        queryArgs = direction === "previous"
            ? { last: pageSize, before: cursor }
            : { first: pageSize, after: cursor };
    }

    const queryParts = [];
    if (searchQuery) queryParts.push(`title:*${searchQuery}* OR tag:*${searchQuery}*`);
    if (statusFilter !== "all") queryParts.push(`status:${statusFilter}`);
    const finalQuery = queryParts.join(" AND ");

    const response = await admin.graphql(
        `#graphql
        query getProducts($first: Int, $last: Int, $after: String, $before: String, $query: String) {
            products(first: $first, last: $last, after: $after, before: $before, query: $query) {
                edges {
                    node {
                        id
                        title
                        handle
                        status
                        totalInventory
                        description
                        descriptionHtml
                        tags
                        metafields(first: 10) {
                            edges {
                                node {
                                    namespace
                                    key
                                    value
                                    type
                                }
                            }
                        }
                        priceRangeV2 {
                            minVariantPrice { amount currencyCode }
                        }
                        featuredImage { id url altText }
                        images(first: 10) { edges { node { id url altText } } }
                    }
                    cursor
                }
                pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            }
        }`,
        { variables: { ...queryArgs, query: finalQuery } }
    );

    const responseJson = await response.json();
    const { edges, pageInfo } = responseJson.data.products;
    let products = edges.map((edge) => edge.node);

    // Apply custom sort point 7: active -> in-stock -> price desc
    products.sort((a, b) => {
        // 1. Status (ACTIVE > others)
        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
        if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;

        // 2. In stock
        const aInStock = (a.totalInventory || 0) > 0;
        const bInStock = (b.totalInventory || 0) > 0;
        if (aInStock && !bInStock) return -1;
        if (!aInStock && bInStock) return 1;

        // 3. Price desc
        const aPrice = parseFloat(a.priceRangeV2?.minVariantPrice?.amount || '0');
        const bPrice = parseFloat(b.priceRangeV2?.minVariantPrice?.amount || '0');
        return bPrice - aPrice;
    });

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
        statusFilter,
        searchQuery
    });
};

export default function Products() {
    const { products, assetsMap, usage, quota, isPro, pageInfo, statusFilter, searchQuery } = useLoaderData();
    const singleFetcher = useFetcher();
    const revalidator = useRevalidator();

    // UI state
    const [toast, setToast] = useState(null);

    // Detail Panel state
    const [detailPanelOpen, setDetailPanelOpen] = useState(false);
    const [detailPanelProduct, setDetailPanelProduct] = useState(null);

    // Bulk selection state
    const [selectedIds, setSelectedIds] = useState([]);

    const prevState = useRef(singleFetcher.state);

    const showToast = useCallback((msg, type = "info") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }, []);


    // Open detail panel
    const openDetailPanel = useCallback((product) => {
        setDetailPanelProduct(product);
        setDetailPanelOpen(true);
    }, []);

    return (
        <>
            <style>{`
                .checkerboard {
                    background: repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 20px 20px;
                }
            `}</style>
            <TitleBar title="See It Products" />
            <PageShell>
                <div className="space-y-6">
                    {/* Header with Search & Filter */}
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                </svg>
                            </span>
                            <input
                                type="text"
                                placeholder="Search products..."
                                defaultValue={searchQuery}
                                className="w-full pl-9 pr-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900 transition-all"
                                onChange={(e) => {
                                    const params = new URLSearchParams(window.location.search);
                                    if (e.target.value) params.set('q', e.target.value);
                                    else params.delete('q');
                                    params.delete('cursor');
                                    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') revalidator.revalidate();
                                }}
                            />
                        </div>
                        <select
                            defaultValue={statusFilter}
                            className="bg-white border border-neutral-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900 transition-all cursor-pointer"
                            onChange={(e) => {
                                const params = new URLSearchParams(window.location.search);
                                params.set('status', e.target.value);
                                params.delete('cursor');
                                window.location.href = `${window.location.pathname}?${params.toString()}`;
                            }}
                        >
                            <option value="all">All Products</option>
                            <option value="ACTIVE">Active</option>
                            <option value="DRAFT">Draft</option>
                            <option value="ARCHIVED">Archived</option>
                        </select>
                        <Button
                            variant="primary"
                            className="flex-shrink-0"
                            onClick={() => revalidator.revalidate()}
                        >
                            Sync
                        </Button>
                    </div>

                    {/* Bulk Actions Bar */}
                    {selectedIds.length > 0 && (
                        <div className="bg-neutral-900 text-white p-4 rounded-xl flex items-center justify-between shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
                            <div className="flex items-center gap-4">
                                <span className="text-sm font-bold bg-white/20 px-3 py-1 rounded-full">
                                    {selectedIds.length} items selected
                                </span>
                                <div className="h-4 w-[1px] bg-white/20"></div>
                                <Button
                                    variant="primary"
                                    onClick={() => {
                                        if (confirm(`Prepare background removal for ${selectedIds.length} selected products?`)) {
                                            // Bulk prepare logic
                                            showToast(`Preparing ${selectedIds.length} products...`, "info");
                                        }
                                    }}
                                    className="bg-white text-neutral-900 hover:bg-neutral-100 border-none"
                                >
                                    Prepare Selected
                                </Button>
                            </div>
                            <button
                                onClick={() => setSelectedIds([])}
                                className="text-white/60 hover:text-white transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                </svg>
                            </button>
                        </div>
                    )}

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
                                            <th className="px-4 py-3 font-normal w-12">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900/5 cursor-pointer"
                                                    checked={selectedIds.length === products.length && products.length > 0}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setSelectedIds(products.map(p => p.id));
                                                        else setSelectedIds([]);
                                                    }}
                                                />
                                            </th>
                                            <th className="px-4 py-3 font-normal w-24">Images</th>
                                            <th className="px-4 py-3 font-normal">Product</th>
                                            <th className="px-4 py-3 font-normal">Price</th>
                                            <th className="px-4 py-3 font-normal">Status</th>
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
                                            const displayImage = asset?.preparedImageUrlFresh
                                                || asset?.preparedImageUrl
                                                || asset?.sourceImageUrl
                                                || product.featuredImage?.url;
                                            const hasPrepared = !!asset?.preparedImageUrlFresh || !!asset?.preparedImageUrl;
                                            const price = product.priceRangeV2?.minVariantPrice;
                                            const originalImage = product.featuredImage?.url;

                                            return (
                                                <tr
                                                    key={product.id}
                                                    onClick={() => openDetailPanel(product)}
                                                    className={`hover:bg-neutral-50/50 transition-colors cursor-pointer ${selectedIds.includes(product.id) ? 'bg-neutral-50' : ''}`}
                                                >
                                                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900/5 cursor-pointer"
                                                            checked={selectedIds.includes(product.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setSelectedIds([...selectedIds, product.id]);
                                                                else setSelectedIds(selectedIds.filter(id => id !== product.id));
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            {/* Original Image */}
                                                            <div className="w-12 h-12 rounded-lg border border-neutral-200 overflow-hidden bg-neutral-50 flex-shrink-0">
                                                                {originalImage ? (
                                                                    <img src={originalImage} alt="" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="w-4 h-4 rounded-full bg-neutral-200" />
                                                                )}
                                                            </div>
                                                            {/* Arrow + Prepared Image */}
                                                            {hasPrepared && (
                                                                <>
                                                                    <span className="text-neutral-300 text-xs">→</span>
                                                                    <div className="w-12 h-12 rounded-lg border-2 border-emerald-400 overflow-hidden checkerboard flex-shrink-0">
                                                                        <img src={displayImage} alt="" className="w-full h-full object-contain" />
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-neutral-900">{product.title}</div>
                                                        <div className="text-neutral-500 text-xs truncate max-w-[180px]">
                                                            {product.handle}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="text-neutral-900 font-medium whitespace-nowrap">
                                                            {price ? `${parseFloat(price.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${price.currencyCode}` : '—'}
                                                        </div>
                                                        <div className={`text-xs mt-0.5 ${product.totalInventory > 0 ? 'text-neutral-500' : 'text-red-500'}`}>
                                                            {product.totalInventory > 0 ? `${product.totalInventory} in stock` : 'Out of stock'}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${status === 'ready' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                            status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                                                                status === 'processing' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                    'bg-neutral-100 text-neutral-600 border-neutral-200'
                                                            }`}>
                                                            <span className={`w-1.5 h-1.5 rounded-full ${status === 'ready' ? 'bg-emerald-500' :
                                                                status === 'failed' ? 'bg-red-500' :
                                                                    status === 'processing' ? 'bg-blue-500 animate-pulse' :
                                                                        'bg-neutral-400'
                                                                }`}></span>
                                                            {status === 'ready' && hasPrepared ? 'Ready' :
                                                                status === 'ready' ? 'Original' :
                                                                    status.charAt(0).toUpperCase() + status.slice(1)}
                                                        </span>
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
                                <Link to={`?cursor=${pageInfo.startCursor}&direction=previous&q=${searchQuery}&status=${statusFilter}`}>
                                    <Button variant="secondary" size="sm">Previous</Button>
                                </Link>
                            )}
                            {pageInfo?.hasNextPage && (
                                <Link to={`?cursor=${pageInfo.endCursor}&direction=next&q=${searchQuery}&status=${statusFilter}`}>
                                    <Button variant="secondary" size="sm">Next</Button>
                                </Link>
                            )}
                        </div>
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

            {/* Product Detail Panel (One-stop shop) */}
            {detailPanelProduct && (
                <ProductDetailPanel
                    key={detailPanelProduct.id}
                    isOpen={detailPanelOpen}
                    onClose={() => {
                        setDetailPanelOpen(false);
                        revalidator.revalidate(); // Refresh when closed to ensure we have latest image/status
                    }}
                    product={detailPanelProduct}
                    asset={assetsMap[detailPanelProduct.id]}
                    onSave={(metadata) => {
                        showToast("Settings saved!", "success");
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

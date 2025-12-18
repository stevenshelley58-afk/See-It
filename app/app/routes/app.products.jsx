import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useNavigation, useRouteError, isRouteErrorResponse, useRevalidator, Link } from "@remix-run/react";
import { useState, useCallback, useEffect, useRef } from "react";
import { Page, Text, Button, BlockStack, InlineStack, Banner, Modal, Card } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../billing";
import { StorageService } from "../services/storage.server";
import { ManualSegmentModal } from "../components/ManualSegmentModal";

export const loader = async ({ request }) => {
    const { admin, session, billing } = await authenticate.admin(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction") || "next";

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

    // Metrics
    const timesUsed = await prisma.renderJob.count({
        where: { shopId: shop.id, status: "completed" }
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const thisMonth = await prisma.renderJob.count({
        where: { shopId: shop.id, status: "completed", createdAt: { gte: startOfMonth } }
    });

    const startOfLastMonth = new Date(startOfMonth);
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);

    const lastMonth = await prisma.renderJob.count({
        where: { shopId: shop.id, status: "completed", createdAt: { gte: startOfLastMonth, lt: startOfMonth } }
    });

    const trend = lastMonth > 0
        ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
        : thisMonth > 0 ? 100 : 0;

    let uniqueCustomers = 0;
    try {
        const uniqueResult = await prisma.renderJob.groupBy({
            by: ['customerSessionId'],
            where: { shopId: shop.id, status: "completed", customerSessionId: { not: null } }
        });
        uniqueCustomers = uniqueResult.length;
    } catch (e) {
        uniqueCustomers = Math.round(timesUsed * 0.35);
    }

    const usesPerCustomer = uniqueCustomers > 0 ? (timesUsed / uniqueCustomers).toFixed(1) : "0";

    let leadsCollected = 0;
    try {
        leadsCollected = await prisma.leadCapture.count({ where: { shopId: shop.id } });
    } catch (e) {
        leadsCollected = 0;
    }

    const productsReady = await prisma.productAsset.count({
        where: { shopId: shop.id, status: "ready" }
    });

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
                preparedImageUrlFresh
            };
        }
    }

    // Usage
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
        metrics: { timesUsed, trend, uniqueCustomers, usesPerCustomer, leadsCollected, productsReady }
    });
};

const styles = `
.seeit{max-width:1200px;margin:0 auto;padding:16px}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.metric{background:#fff;border-radius:16px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.metric.hero{grid-column:span 2;background:linear-gradient(135deg,#1a1a1a,#333);color:#fff;padding:20px}
.metric-val{font-size:28px;font-weight:700;line-height:1}
.metric.hero .metric-val{font-size:42px;margin-bottom:4px}
.metric-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}
.metric.hero .metric-label{color:rgba(255,255,255,.7);font-size:12px}
.metric-trend{font-size:12px;color:#34a853;margin-top:6px}
.metric-trend.down{color:#ea4335}
.metric.hero .metric-trend{color:#8fff8f}
.quota{background:#fff;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.quota strong{font-weight:600}
.quota a{color:#1a1a1a;text-decoration:none;font-weight:500}
.quota a:hover{text-decoration:underline}
.filters{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;margin-bottom:16px;-webkit-overflow-scrolling:touch}
.filters::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;padding:8px 14px;border-radius:20px;font-size:13px;background:#fff;color:#666;border:none;cursor:pointer;font-family:inherit;box-shadow:0 1px 2px rgba(0,0,0,.06);transition:all .15s}
.chip:hover{background:#f5f5f5}
.chip.active{background:#1a1a1a;color:#fff;box-shadow:none}
.chip .ct{opacity:.6;margin-left:4px}
.products{display:flex;flex-direction:column;gap:12px}
.prod-card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:box-shadow .2s}
.prod-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.12)}
.prod-imgs{display:flex;height:140px}
.prod-side{flex:1;display:flex;align-items:center;justify-content:center;background:#faf9f7;position:relative;padding:12px;cursor:pointer;transition:background .15s}
.prod-side:hover{background:#f5f4f2}
.prod-side img{max-width:100%;max-height:116px;object-fit:contain}
.prod-side.done{background:repeating-conic-gradient(#f0f0f0 0% 25%,#fff 0% 50%) 50%/10px 10px}
.prod-div{width:1px;background:#e8e6e3}
.prod-tag{position:absolute;bottom:6px;left:6px;font-size:9px;text-transform:uppercase;letter-spacing:.3px;background:#fff;padding:2px 6px;border-radius:4px;color:#888}
.prod-tag.ok{background:#e8f5e9;color:#2e7d32}
.prod-tag.err{background:#ffebee;color:#c62828}
.prod-tag.wait{background:#fff8e1;color:#f57c00}
.prod-info{padding:12px 16px;display:flex;align-items:center;gap:10px}
.prod-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.prod-dot.ready{background:#34a853}
.prod-dot.pending{background:#fbbc04}
.prod-dot.failed{background:#ea4335}
.prod-dot.none{background:#e0e0e0}
.prod-name{flex:1;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prod-btn{flex-shrink:0;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:500;border:none;cursor:pointer;font-family:inherit;transition:all .15s}
.prod-btn:hover{opacity:.9}
.prod-btn:active{transform:scale(.98)}
.prod-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.prod-btn.pri{background:#1a1a1a;color:#fff}
.prod-btn.sec{background:#f0f0f0;color:#1a1a1a}
.prod-btn.adj{background:#2563eb;color:#fff}
.prod-btn.err{background:#ea4335;color:#fff}
.prod-placeholder{font-size:11px;color:#999}
.spin{width:20px;height:20px;border:2px solid #e0e0e0;border-top-color:#1a1a1a;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.paging{display:flex;justify-content:center;gap:8px;padding:20px 0}
.paging button{padding:8px 16px;border:1px solid #e0e0e0;border-radius:8px;background:#fff;font-size:13px;cursor:pointer;transition:all .15s}
.paging button:hover:not(:disabled){background:#f5f5f5}
.paging button:disabled{opacity:.4;cursor:not-allowed}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;z-index:1000;animation:fadeUp .3s ease;box-shadow:0 4px 12px rgba(0,0,0,.2)}
.toast.err{background:#c62828}
.toast.success{background:#2e7d32}
@keyframes fadeUp{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.empty{text-align:center;padding:48px 20px;color:#888}
.empty h3{color:#1a1a1a;margin-bottom:8px}
.btn-group{display:flex;gap:6px}
@media(min-width:768px){
    .seeit{padding:24px}
    .metrics{grid-template-columns:repeat(4,1fr);gap:16px}
    .metric.hero{grid-column:span 1}
    .metric.hero .metric-val{font-size:32px}
    .products{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
    .prod-imgs{height:180px}
    .prod-side img{max-height:156px}
}
@media(min-width:1024px){
    .products{grid-template-columns:repeat(3,1fr)}
}
`;

export default function Products() {
    const { products, assetsMap, statusCounts, pageInfo, usage, quota, isPro, metrics } = useLoaderData();
    const singleFetcher = useFetcher();
    const revalidator = useRevalidator();
    const navigation = useNavigation();
    const [params, setParams] = useSearchParams();

    // UI state
    const [statusFilter, setStatusFilter] = useState("all");
    const [processingId, setProcessingId] = useState(null);
    const [toast, setToast] = useState(null);

    // Image selection modal
    const [modalOpen, setModalOpen] = useState(false);
    const [modalProduct, setModalProduct] = useState(null);
    const [selectedImg, setSelectedImg] = useState(0);

    // Manual adjust modal
    const [adjustProduct, setAdjustProduct] = useState(null);

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
    const handlePrepare = useCallback((productId, imageUrl = null) => {
        const numId = productId.split('/').pop();
        setProcessingId(productId);
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
    const openAdjustModal = useCallback((product) => {
        setAdjustProduct(product);
    }, []);

    // Pagination
    const handlePage = useCallback((dir) => {
        const cursor = dir === "next" ? pageInfo.endCursor : pageInfo.startCursor;
        setParams(p => {
            p.set("cursor", cursor);
            p.set("direction", dir);
            return p;
        });
    }, [pageInfo, setParams]);

    // Filter products
    const filtered = products.filter(p => {
        if (statusFilter === "all") return true;
        const a = assetsMap[p.id];
        const status = a?.status || "unprepared";
        if (statusFilter === "pending") return status === "pending" || status === "processing";
        return status === statusFilter;
    });

    const isLoading = navigation.state === "loading";

    return (
        <Page title="See It">
            <style>{styles}</style>
            <div className="seeit">
                {/* Metrics */}
                <div className="metrics">
                    <div className="metric hero">
                        <div className="metric-val">{metrics.timesUsed.toLocaleString()}</div>
                        <div className="metric-label">Times customers used See It</div>
                        {metrics.trend !== 0 && (
                            <div className={`metric-trend ${metrics.trend < 0 ? 'down' : ''}`}>
                                {metrics.trend > 0 ? '↑' : '↓'} {Math.abs(metrics.trend)}% this month
                            </div>
                        )}
                    </div>
                    <div className="metric">
                        <div className="metric-val">{metrics.usesPerCustomer}</div>
                        <div className="metric-label">Uses / customer</div>
                    </div>
                    <div className="metric">
                        <div className="metric-val">{metrics.leadsCollected.toLocaleString()}</div>
                        <div className="metric-label">Leads captured</div>
                    </div>
                    <div className="metric">
                        <div className="metric-val">{metrics.productsReady}</div>
                        <div className="metric-label">Products ready</div>
                    </div>
                </div>

                {/* Quota */}
                <div className="quota">
                    <span><strong>{usage.monthly}</strong> / {quota.monthly} this month</span>
                    {!isPro && <Link to="/app/billing">Upgrade →</Link>}
                </div>

                {/* Filters */}
                <div className="filters">
                    <button
                        className={`chip ${statusFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('all')}
                    >
                        All
                    </button>
                    <button
                        className={`chip ${statusFilter === 'ready' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('ready')}
                    >
                        Ready<span className="ct">{statusCounts.ready}</span>
                    </button>
                    <button
                        className={`chip ${statusFilter === 'pending' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('pending')}
                    >
                        Queued<span className="ct">{statusCounts.pending + (statusCounts.processing || 0)}</span>
                    </button>
                    <button
                        className={`chip ${statusFilter === 'failed' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('failed')}
                    >
                        Errors<span className="ct">{statusCounts.failed}</span>
                    </button>
                </div>

                {/* Products */}
                {isLoading ? (
                    <div className="empty">
                        <div className="spin" style={{ margin: '0 auto' }}></div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="empty">
                        <h3>No products</h3>
                        <p>Try a different filter or add products to your store</p>
                    </div>
                ) : (
                    <div className="products">
                        {filtered.map(product => {
                            const asset = assetsMap[product.id];
                            const status = asset?.status || "unprepared";
                            const isReady = status === "ready";
                            const isBusy = status === "pending" || status === "processing" || processingId === product.id;
                            const isFailed = status === "failed";
                            const hasMulti = product.images?.edges?.length > 1;
                            const sourceUrl = asset?.sourceImageUrl || product.featuredImage?.url;
                            const productImages = product.images?.edges?.map(e => ({
                                url: e.node.url,
                                altText: e.node.altText
                            })) || [];

                            return (
                                <div key={product.id} className="prod-card">
                                    <div className="prod-imgs">
                                        {/* Before */}
                                        <div
                                            className="prod-side"
                                            onClick={() => openImageModal(product)}
                                        >
                                            {product.featuredImage ? (
                                                <img src={product.featuredImage.url} alt={product.title} />
                                            ) : (
                                                <span className="prod-placeholder">No image</span>
                                            )}
                                            <span className="prod-tag">Before</span>
                                        </div>

                                        <div className="prod-div" />

                                        {/* After */}
                                        <div className={`prod-side ${isReady ? 'done' : ''}`}>
                                            {isReady && asset?.preparedImageUrlFresh ? (
                                                <>
                                                    <img src={asset.preparedImageUrlFresh} alt={`${product.title} prepared`} />
                                                    <span className="prod-tag ok">Ready</span>
                                                </>
                                            ) : isBusy ? (
                                                <>
                                                    <div className="spin" />
                                                    <span className="prod-tag wait">Processing</span>
                                                </>
                                            ) : isFailed ? (
                                                <>
                                                    <span className="prod-placeholder">Failed</span>
                                                    <span className="prod-tag err">Error</span>
                                                </>
                                            ) : (
                                                <span className="prod-placeholder">Not ready</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Info bar */}
                                    <div className="prod-info">
                                        <span className={`prod-dot ${isReady ? 'ready' : isBusy ? 'pending' : isFailed ? 'failed' : 'none'}`} />
                                        <span className="prod-name">{product.title}</span>

                                        {product.featuredImage && (
                                            <div className="btn-group">
                                                {/* Ready: Adjust + Redo */}
                                                {isReady && (
                                                    <>
                                                        <button
                                                            className="prod-btn adj"
                                                            onClick={() => openAdjustModal(product)}
                                                        >
                                                            Adjust
                                                        </button>
                                                        <button
                                                            className="prod-btn sec"
                                                            onClick={() => hasMulti ? openImageModal(product) : handlePrepare(product.id)}
                                                            disabled={isBusy}
                                                        >
                                                            Redo
                                                        </button>
                                                    </>
                                                )}

                                                {/* Failed: Retry + Adjust */}
                                                {isFailed && (
                                                    <>
                                                        <button
                                                            className="prod-btn err"
                                                            onClick={() => hasMulti ? openImageModal(product) : handlePrepare(product.id)}
                                                            disabled={isBusy}
                                                        >
                                                            Retry
                                                        </button>
                                                        <button
                                                            className="prod-btn adj"
                                                            onClick={() => openAdjustModal(product)}
                                                        >
                                                            Manual
                                                        </button>
                                                    </>
                                                )}

                                                {/* Not ready: Prepare/Choose */}
                                                {!isReady && !isFailed && (
                                                    <button
                                                        className="prod-btn pri"
                                                        onClick={() => hasMulti ? openImageModal(product) : handlePrepare(product.id)}
                                                        disabled={isBusy}
                                                    >
                                                        {isBusy ? '...' : hasMulti ? 'Choose' : 'Prepare'}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Pagination */}
                <div className="paging">
                    <button
                        onClick={() => handlePage("previous")}
                        disabled={!pageInfo.hasPreviousPage || isLoading}
                    >
                        ← Prev
                    </button>
                    <button
                        onClick={() => handlePage("next")}
                        disabled={!pageInfo.hasNextPage || isLoading}
                    >
                        Next →
                    </button>
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className={`toast ${toast.type}`}>{toast.msg}</div>
            )}

            {/* Image Selection Modal */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={modalProduct?.title || "Select image"}
            >
                <Modal.Section>
                    {modalProduct && (
                        <BlockStack gap="400">
                            <div style={{
                                background: '#faf9f7',
                                borderRadius: '12px',
                                padding: '16px',
                                display: 'flex',
                                justifyContent: 'center',
                                minHeight: '240px',
                                alignItems: 'center'
                            }}>
                                {modalProduct.images?.edges?.[selectedImg] ? (
                                    <img
                                        src={modalProduct.images.edges[selectedImg].node.url}
                                        alt=""
                                        style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }}
                                    />
                                ) : modalProduct.featuredImage ? (
                                    <img
                                        src={modalProduct.featuredImage.url}
                                        alt=""
                                        style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }}
                                    />
                                ) : (
                                    <Text tone="subdued">No image</Text>
                                )}
                            </div>

                            {modalProduct.images?.edges?.length > 1 && (
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {modalProduct.images.edges.map((edge, idx) => (
                                        <div
                                            key={edge.node.id}
                                            onClick={() => setSelectedImg(idx)}
                                            style={{
                                                width: '56px',
                                                height: '56px',
                                                borderRadius: '8px',
                                                overflow: 'hidden',
                                                border: idx === selectedImg ? '2px solid #1a1a1a' : '1px solid #e0e0e0',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <img
                                                src={edge.node.url}
                                                alt=""
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            <InlineStack align="end" gap="200">
                                <Button onClick={() => setModalOpen(false)}>Cancel</Button>
                                <Button
                                    variant="primary"
                                    onClick={() => {
                                        handlePrepare(
                                            modalProduct.id,
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
                    onSuccess={() => {
                        showToast("Background updated!", "success");
                        setTimeout(() => revalidator.revalidate(), 500);
                    }}
                />
            )}
        </Page>
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
        <Page title="See It">
            <Card>
                <BlockStack gap="400">
                    <Banner title={title} tone="critical">
                        <p>{message}</p>
                    </Banner>
                    <Button onClick={() => window.location.reload()}>Refresh</Button>
                </BlockStack>
            </Card>
        </Page>
    );
}

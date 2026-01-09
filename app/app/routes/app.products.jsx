import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse, useRevalidator, Link, useNavigate } from "@remix-run/react";
import { useState, useCallback, useEffect, useRef } from "react";
import { TitleBar } from "@shopify/app-bridge-react";
import { Modal, BlockStack, InlineStack, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../billing";
import { StorageService } from "../services/storage.server";
import { PageShell, Button } from "../components/ui";
import { ProductDetailPanel } from "../components/ProductDetailPanel";
import { writeFile } from "fs/promises";
import { join } from "path";

export const loader = async ({ request }) => {
    try {
        // #region agent log
        console.error('[DEBUG] Loader entry', request.url);
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:13',message:'Loader entry',data:{url:request.url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>console.error('[DEBUG] Log fetch failed:',e));
        // #endregion
        let admin, session, billing;
    try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:14',message:'Before authenticate',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        const authResult = await authenticate.admin(request);
        admin = authResult.admin;
        session = authResult.session;
        billing = authResult.billing;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:14',message:'After authenticate',data:{shop:session?.shop,hasAdmin:!!admin,hasBilling:!!billing},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:14',message:'Authenticate error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        throw error;
    }
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction") || "next";
    const statusFilter = url.searchParams.get("status") || "all"; // Default to "all" to match Shopify
    const searchQuery = url.searchParams.get("q") || "";
    const sortField = url.searchParams.get("sort") || "manual"; // title, price, manual
    const sortDir = url.searchParams.get("sortDir") || "asc";

    const pageSize = 12;
    let queryArgs = { first: pageSize };
    if (cursor) {
        queryArgs = direction === "previous"
            ? { last: pageSize, before: cursor }
            : { first: pageSize, after: cursor };
    }

    let sortKey = "ID"; // Default
    let reverse = false;

    // Note: Only TITLE, CREATED_AT, UPDATED_AT, PRODUCT_TYPE, VENDOR, INVENTORY_TOTAL, PUBLISHED_AT, RELEVANCE, ID
    // are valid ProductSortKeys for Admin API. PRICE is only valid in Storefront API.
    if (sortField === 'title') {
        sortKey = "TITLE";
        reverse = sortDir === 'desc';
    }
    // Price sorting is handled client-side after fetch since PRICE is not a valid Admin API sort key

    const queryParts = [];
    if (searchQuery) queryParts.push(`title:*${searchQuery}* OR tag:*${searchQuery}*`);
    if (statusFilter !== "all") queryParts.push(`status:${statusFilter}`);
    const finalQuery = queryParts.join(" AND ");

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:47',message:'Before GraphQL query',data:{queryArgs,query:finalQuery,sortKey,reverse},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    let response;
    try {
        response = await admin.graphql(
        `#graphql
        query getProducts($first: Int, $last: Int, $after: String, $before: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
            products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
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
        { variables: { ...queryArgs, query: finalQuery, sortKey, reverse } }
    );
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:83',message:'After GraphQL query',data:{hasResponse:!!response,status:response?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:47',message:'GraphQL query error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        throw error;
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:85',message:'Before response.json',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    let responseJson;
    try {
        responseJson = await response.json();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:85',message:'After response.json',data:{hasData:!!responseJson?.data,hasProducts:!!responseJson?.data?.products,hasErrors:!!responseJson?.errors,errors:responseJson?.errors?.map(e=>e?.message)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:85',message:'response.json error',data:{error:error?.message,errorName:error?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        throw error;
    }
    // #region agent log
    console.error('[DEBUG] GraphQL response received, has data:', !!responseJson?.data, 'has products:', !!responseJson?.data?.products, 'has errors:', !!responseJson?.errors);
    if (responseJson?.errors) {
        console.error('[DEBUG] GraphQL errors:', responseJson.errors);
    }
    // #endregion
    if (!responseJson?.data?.products) {
        // #region agent log
        const errorMsg = responseJson?.errors?.[0]?.message || 'Unknown error';
        const fullResponse = JSON.stringify(responseJson, null, 2).substring(0, 1000);
        console.error('[DEBUG] GraphQL response missing products data. Full response:', fullResponse);
        console.error('[DEBUG] GraphQL errors:', responseJson?.errors);
        // #endregion
        throw new Error(`GraphQL query failed: ${errorMsg}. Response: ${fullResponse.substring(0, 200)}`);
    }
    const { edges, pageInfo } = responseJson.data.products;
    if (!edges || !Array.isArray(edges)) {
        // #region agent log
        console.error('[DEBUG] GraphQL response missing edges array. edges:', edges, 'pageInfo:', pageInfo);
        // #endregion
        throw new Error(`GraphQL query returned invalid data: edges is not an array. Got: ${typeof edges}`);
    }
    let products = edges.map((edge) => {
        if (!edge?.node) {
            console.error('[DEBUG] Edge missing node:', edge);
            return null;
        }
        return edge.node;
    }).filter(Boolean);

    // Apply custom sort point 7: active -> in-stock -> price desc
    // ONLY if we are in "manual" sort mode (default) OR explicitly sorting by status (which we hack here for now)
    if (sortField === 'manual' || sortField === 'status') {
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

        // If specific status sort requested, we might want to flip it
        if (sortField === 'status' && sortDir === 'desc') {
            products.reverse();
        }
    }

    // Handle price sorting client-side (PRICE is not a valid Admin API sort key)
    if (sortField === 'price') {
        products.sort((a, b) => {
            const aPrice = parseFloat(a.priceRangeV2?.minVariantPrice?.amount || '0');
            const bPrice = parseFloat(b.priceRangeV2?.minVariantPrice?.amount || '0');
            return sortDir === 'asc' ? aPrice - bPrice : bPrice - aPrice;
        });
    }

    // Billing check - wrapped in try-catch to prevent crashes
    let planId = PLANS.FREE.id;
    let dailyQuota = PLANS.FREE.dailyQuota;
    let monthlyQuota = PLANS.FREE.monthlyQuota;

    // #region agent log
    console.error('[DEBUG] Before billing check, hasBilling:', !!billing, 'billing type:', typeof billing);
    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:203',message:'Before billing check',data:{hasBilling:!!billing,billingType:typeof billing},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    // Safely check billing - if it fails, just use free plan
    try {
        if (billing && typeof billing.check === 'function') {
            try {
                const billingResult = await billing.check({
                    plans: [PLANS.PRO.name],
                    isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false'
                });
                // #region agent log
                console.error('[DEBUG] After billing check, result:', billingResult);
                fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:214',message:'After billing check',data:{hasActivePayment:billingResult?.hasActivePayment},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                // #endregion
                if (billingResult?.hasActivePayment) {
                    planId = PLANS.PRO.id;
                    dailyQuota = PLANS.PRO.dailyQuota;
                    monthlyQuota = PLANS.PRO.monthlyQuota;
                }
            } catch (billingError) {
                // #region agent log
                console.error('[DEBUG] Billing check error:', billingError);
                fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:214',message:'Billing check error',data:{error:billingError?.message,errorName:billingError?.name,stack:billingError?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                // #endregion
                console.error("Billing check failed, using free plan", billingError);
                // Continue with free plan - don't throw
            }
        } else {
            // #region agent log
            console.error('[DEBUG] Billing is not available or check method missing, skipping check');
            fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:203',message:'Billing not available',data:{hasBilling:!!billing,hasCheckMethod:!!(billing && typeof billing.check === 'function')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
        }
    } catch (outerBillingError) {
        // #region agent log
        console.error('[DEBUG] Outer billing check error:', outerBillingError);
        // #endregion
        console.error("Billing check outer error, using free plan", outerBillingError);
        // Continue with free plan - don't throw
    }

    // Shop sync
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:144',message:'Before shop lookup',data:{shopDomain:session?.shop},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    let shop;
    try {
        shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:144',message:'After shop lookup',data:{found:!!shop,shopId:shop?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:144',message:'Shop lookup error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        throw error;
    }
    if (!shop) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:146',message:'Creating new shop',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        try {
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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:149',message:'Shop created',data:{shopId:shop?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
        } catch (error) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:146',message:'Shop create error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            throw error;
        }
    } else if (shop.plan !== planId) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:159',message:'Updating shop plan',data:{oldPlan:shop.plan,newPlan:planId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        try {
            shop = await prisma.shop.update({
                where: { id: shop.id },
                data: { plan: planId, dailyQuota, monthlyQuota }
            });
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:160',message:'Shop updated',data:{shopId:shop?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
        } catch (error) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:159',message:'Shop update error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            throw error;
        }
    }

    // Assets map
    let assetsMap = {};
    if (!shop) {
        // #region agent log
        console.error('[DEBUG] Shop is undefined after shop sync!');
        // #endregion
        throw new Error('Shop not found or could not be created');
    }
    if (products.length > 0) {
        // #region agent log
        console.error('[DEBUG] Before assets query, productCount:', products.length, 'shopId:', shop.id);
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:168',message:'Before assets query',data:{productCount:products.length,shopId:shop?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        const normalizedIds = products.map(p => p.id.split('/').pop());
        let assets;
        try {
            assets = await prisma.productAsset.findMany({
                where: { shopId: shop.id, productId: { in: normalizedIds } }
            });
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:170',message:'After assets query',data:{assetCount:assets?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
        } catch (error) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:170',message:'Assets query error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            throw error;
        }

        for (const a of assets) {
            let preparedImageUrlFresh = a.preparedImageUrl;
            if (a.status === "ready" && a.preparedImageKey) {
                // #region agent log
                console.error('[DEBUG] Before storage URL, assetId:', a.id, 'key:', a.preparedImageKey);
                fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:177',message:'Before storage URL',data:{assetId:a.id,key:a.preparedImageKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                try {
                    preparedImageUrlFresh = await StorageService.getSignedReadUrl(a.preparedImageKey, 60 * 60 * 1000);
                    // #region agent log
                    console.error('[DEBUG] After storage URL, assetId:', a.id, 'hasUrl:', !!preparedImageUrlFresh);
                    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:178',message:'After storage URL',data:{assetId:a.id,hasUrl:!!preparedImageUrlFresh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                    // #endregion
                } catch (err) {
                    // #region agent log
                    console.error('[DEBUG] Storage URL error, assetId:', a.id, 'error:', err);
                    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:177',message:'Storage URL error',data:{assetId:a.id,error:err?.message,errorName:err?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                    // #endregion
                    console.error(`Failed to sign URL for asset ${a.id}`, err);
                }
            }
            if (a.productId) {
                assetsMap[`gid://shopify/Product/${a.productId}`] = {
                    ...a,
                    preparedImageUrlFresh,
                    renderInstructions: a.renderInstructions || ""
                };
            }
        }
    }

    // Usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:197',message:'Before usage aggregate',data:{shopId:shop?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    let monthlyUsageAgg;
    try {
        monthlyUsageAgg = await prisma.usageDaily.aggregate({
            where: { shopId: shop.id, date: { gte: startOfMonth } },
            _sum: { compositeRenders: true }
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:197',message:'After usage aggregate',data:{usage:monthlyUsageAgg?._sum?.compositeRenders},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:197',message:'Usage aggregate error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        throw error;
    }
    const monthlyUsage = monthlyUsageAgg._sum.compositeRenders || 0;

    // Status counts
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:204',message:'Before status groupBy',data:{shopId:shop?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    let statusGroups;
    try {
        statusGroups = await prisma.productAsset.groupBy({
            by: ['status'],
            where: { shopId: shop.id },
            _count: { status: true }
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:204',message:'After status groupBy',data:{groupCount:statusGroups?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:204',message:'Status groupBy error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        throw error;
    }
    const statusCounts = { ready: 0, pending: 0, failed: 0, processing: 0 };
    statusGroups.forEach(g => { statusCounts[g.status] = g._count.status; });

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:212',message:'Before return json',data:{productCount:products.length,assetCount:Object.keys(assetsMap).length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    try {
        return json({
            products,
            assetsMap,
            statusCounts,
            pageInfo,
            usage: { monthly: monthlyUsage },
            quota: { monthly: shop.monthlyQuota },
            isPro: shop.plan === PLANS.PRO.id,
            statusFilter,
            searchQuery,
            sortField,
            sortDir
        });
    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.products.jsx:212',message:'Return json error',data:{error:error?.message,errorName:error?.name,stack:error?.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        throw error;
    }
    } catch (topLevelError) {
        // #region agent log
        const errorDetails = {
            message: topLevelError?.message || 'Unknown error',
            name: topLevelError?.name || 'Error',
            stack: topLevelError?.stack || 'No stack trace',
            cause: topLevelError?.cause
        };
        console.error('========================================');
        console.error('[DEBUG] TOP-LEVEL LOADER ERROR');
        console.error('========================================');
        console.error('Error Message:', errorDetails.message);
        console.error('Error Name:', errorDetails.name);
        console.error('Error Stack:', errorDetails.stack.substring(0, 1000));
        console.error('Full Error Object:', topLevelError);
        console.error('========================================');
        const logEntry = JSON.stringify({location:'app.products.jsx:13',message:'Top-level loader error',data:errorDetails,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'}) + '\n';
        fetch('http://127.0.0.1:7242/ingest/43512e6b-5e64-468d-9c1d-7f1af7167e38',{method:'POST',headers:{'Content-Type':'application/json'},body:logEntry.trim()}).catch(async (e)=>{
            console.error('[DEBUG] Log fetch failed:',e);
            try {
                await writeFile(join(process.cwd(), '.cursor', 'debug.log'), logEntry, { flag: 'a' });
            } catch (fileErr) {
                console.error('[DEBUG] File log also failed:', fileErr);
            }
        });
        // #endregion
        // Re-throw with more context
        const enhancedError = new Error(`Products loader failed: ${errorDetails.message}`);
        enhancedError.cause = topLevelError;
        throw enhancedError;
    }
};

export default function Products() {
    const { products, assetsMap, usage, quota, isPro, pageInfo, statusFilter, searchQuery, sortField, sortDir } = useLoaderData();
    const singleFetcher = useFetcher();
    const revalidator = useRevalidator();
    const navigate = useNavigate();

    // UI state
    const [toast, setToast] = useState(null);

    // Detail Panel state
    const [detailPanelOpen, setDetailPanelOpen] = useState(false);
    const [detailPanelProduct, setDetailPanelProduct] = useState(null);

    // Bulk selection state
    const [selectedIds, setSelectedIds] = useState([]);
    // Bulk progress state
    const [bulkProgress, setBulkProgress] = useState(null);
    // Shape: { current: 0, total: 0, status: 'idle' | 'running' | 'done', successCount: 0, failCount: 0 }

    // Search overlay state
    const [searchInput, setSearchInput] = useState(searchQuery || "");
    const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
    const [searchResults, setSearchResults] = useState({ products: [], orders: [], draftOrders: [] });
    const [searchLoading, setSearchLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("products");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const showToast = useCallback((msg, type = "info") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }, []);

    // Search handler with debouncing
    const handleSearchChange = useCallback((value: string) => {
        setSearchInput(value);
        
        // Clear existing timeout
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (value.length < 2) {
            setSearchOverlayOpen(false);
            setSearchResults({ products: [], orders: [], draftOrders: [] });
            return;
        }

        // Show overlay immediately
        setSearchOverlayOpen(true);
        setSearchLoading(true);

        // Debounce API call
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const response = await fetch(`/api/products/search?q=${encodeURIComponent(value)}&limit=10`);
                const data = await response.json();
                setSearchResults(data);
                setSearchLoading(false);
            } catch (error) {
                console.error("Search error:", error);
                setSearchLoading(false);
            }
        }, 300);
    }, []);

    // Handle search input focus
    const handleSearchFocus = useCallback(() => {
        if (searchInput.length >= 2) {
            setSearchOverlayOpen(true);
        }
    }, [searchInput]);

    // Handle clicking outside to close overlay
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
                const target = event.target as HTMLElement;
                if (!target.closest('.search-overlay')) {
                    setSearchOverlayOpen(false);
                }
            }
        };

        if (searchOverlayOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [searchOverlayOpen]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    // Sync search input with URL parameter
    useEffect(() => {
        if (searchQuery && searchQuery !== searchInput) {
            setSearchInput(searchQuery);
        }
    }, [searchQuery]);


    // Open detail panel
    const openDetailPanel = useCallback((product) => {
        setDetailPanelProduct(product);
        setDetailPanelOpen(true);
    }, []);

    // Bulk prepare handler - uses batch endpoint for better performance
    const handleBulkPrepare = async () => {
        const total = selectedIds.length;
        setBulkProgress({ current: 0, total, status: 'running', successCount: 0, failCount: 0, errors: [] });

        try {
            // Extract product IDs from GID format
            const productIds = selectedIds.map(id => id.split('/').pop());
            const formData = new FormData();
            formData.append("productIds", JSON.stringify(productIds));

            const res = await fetch('/api/products/batch-prepare', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (res.ok) {
                const queued = data.queued || data.processed || 0;
                const errors = data.errors || [];
                const failCount = errors.length;
                const successCount = queued;

                setBulkProgress({
                    current: total,
                    total,
                    status: 'done',
                    successCount,
                    failCount,
                    errors: errors // Store errors for display
                });
            } else {
                // Handle quota or other errors
                const errorMsg = data.error || data.message || 'Batch prepare failed';
                setBulkProgress({
                    current: total,
                    total,
                    status: 'done',
                    successCount: 0,
                    failCount: total,
                    errors: [{ error: errorMsg }]
                });
                showToast(errorMsg, 'err');
            }
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : 'Network error';
            setBulkProgress({
                current: total,
                total,
                status: 'done',
                successCount: 0,
                failCount: total,
                errors: [{ error: errorMsg }]
            });
            showToast('Failed to prepare products', 'err');
        }

        // Update list immediately so user sees "Pending" or "Ready" badges update behind the banner
        revalidator.revalidate();

        // Show done state for 5 seconds (longer to see errors), then reset
        setTimeout(() => {
            setBulkProgress(null);
            setSelectedIds([]);
        }, 5000);
    };

    const handleSort = (field) => {
        const params = new URLSearchParams(window.location.search);
        // Default to asc if new field, toggle if same
        let newDir = 'asc';
        if (field === sortField) {
            newDir = sortDir === 'asc' ? 'desc' : 'asc';
        }
        params.set('sort', field);
        params.set('sortDir', newDir);
        params.delete('cursor'); // Reset pagination on sort change
        navigate(`${window.location.pathname}?${params.toString()}`);
    };

    const SortHeader = ({ label, field }) => (
        <th
            className="px-3 md:px-4 py-2.5 md:py-3 font-normal cursor-pointer hover:bg-neutral-100 transition-colors select-none"
            onClick={() => handleSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                {sortField === field && (
                    <span className="text-xs text-neutral-400">
                        {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                )}
            </div>
        </th>
    );

    return (
        <>
            <style dangerouslySetInnerHTML={{
                __html: `
                .checkerboard {
                    background: repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 20px 20px;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
            `}} />
            <TitleBar title="See It Products" />
            <PageShell>
                <div className="space-y-4">
                    {/* Header with Search & Status Tabs */}
                    <div className="flex flex-col gap-3">
                        {/* Shopify-style Search Bar */}
                        <div className="relative" ref={searchInputRef}>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                    </svg>
                                </span>
                                <input
                                    type="text"
                                    value={searchInput}
                                    onChange={(e) => handleSearchChange(e.target.value)}
                                    onFocus={handleSearchFocus}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                            setSearchOverlayOpen(false);
                                        } else if (e.key === 'Enter' && searchInput) {
                                            const params = new URLSearchParams(window.location.search);
                                            params.set('q', searchInput);
                                            params.delete('cursor');
                                            navigate(`${window.location.pathname}?${params.toString()}`);
                                            setSearchOverlayOpen(false);
                                        }
                                    }}
                                    placeholder="Search products..."
                                    className="w-full pl-9 pr-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900 transition-all"
                                />
                                {searchInput && (
                                    <button
                                        onClick={() => {
                                            setSearchInput("");
                                            setSearchOverlayOpen(false);
                                            const params = new URLSearchParams(window.location.search);
                                            params.delete('q');
                                            navigate(`${window.location.pathname}?${params.toString()}`);
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            {/* Search Overlay */}
                            {searchOverlayOpen && searchInput.length >= 2 && (
                                <>
                                    {/* Backdrop */}
                                    <div 
                                        className="fixed inset-0 bg-black/20 z-40"
                                        onClick={() => setSearchOverlayOpen(false)}
                                    />
                                    <div className="search-overlay absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-lg shadow-xl z-50 max-h-[600px] overflow-hidden flex flex-col">
                                    {/* Search Query Header */}
                                    <div className="px-4 py-3 border-b border-neutral-200">
                                        <div className="text-sm font-medium text-neutral-900">
                                            Search results for "{searchInput}"
                                        </div>
                                    </div>

                                    {/* Tabs */}
                                    <div className="flex border-b border-neutral-200">
                                        {[
                                            { key: 'products', label: 'Products', count: searchResults.products.length },
                                            { key: 'orders', label: 'Orders', count: searchResults.orders.length },
                                            { key: 'draftOrders', label: 'Draft orders', count: searchResults.draftOrders.length }
                                        ].map((tab) => {
                                            const isActive = activeTab === tab.key;
                                            return (
                                                <button
                                                    key={tab.key}
                                                    onClick={() => setActiveTab(tab.key)}
                                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                                        isActive
                                                            ? 'border-neutral-900 text-neutral-900'
                                                            : 'border-transparent text-neutral-600 hover:text-neutral-900'
                                                    }`}
                                                >
                                                    {tab.label} {tab.count > 0 && ` ${tab.count}`}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Results */}
                                    <div className="flex-1 overflow-y-auto">
                                        {searchLoading ? (
                                            <div className="px-4 py-8 text-center text-sm text-neutral-500">
                                                Searching...
                                            </div>
                                        ) : activeTab === 'products' && searchResults.products.length > 0 ? (
                                            <div className="divide-y divide-neutral-100">
                                                {searchResults.products.map((product: any) => {
                                                    const price = product.priceRangeV2?.minVariantPrice;
                                                    return (
                                                        <button
                                                            key={product.id}
                                                            onClick={() => {
                                                                const params = new URLSearchParams(window.location.search);
                                                                params.set('q', product.title);
                                                                params.delete('cursor');
                                                                navigate(`${window.location.pathname}?${params.toString()}`);
                                                                setSearchInput(product.title);
                                                                setSearchOverlayOpen(false);
                                                            }}
                                                            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-50 transition-colors text-left"
                                                        >
                                                            <div className="w-12 h-12 rounded-lg border border-neutral-200 overflow-hidden bg-neutral-50 flex-shrink-0">
                                                                {product.featuredImage?.url ? (
                                                                    <img src={product.featuredImage.url} alt={product.title} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="w-full h-full bg-neutral-200" />
                                                                )}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-medium text-neutral-900 truncate">{product.title}</div>
                                                                <div className="text-xs text-neutral-500 mt-0.5">
                                                                    {product.status === 'ACTIVE' ? (
                                                                        <span className="inline-flex items-center gap-1">
                                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                                            Active
                                                                        </span>
                                                                    ) : product.status === 'DRAFT' ? (
                                                                        <span>Draft</span>
                                                                    ) : (
                                                                        <span>Archived</span>
                                                                    )}
                                                                    {price && (
                                                                        <span className="ml-2">
                                                                            {parseFloat(price.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} {price.currencyCode}
                                                                        </span>
                                                                    )}
                                                                    {product.totalInventory !== undefined && (
                                                                        <span className="ml-2">
                                                                            {product.totalInventory > 0 ? `${product.totalInventory} available` : 'Out of stock'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : activeTab === 'orders' && searchResults.orders.length > 0 ? (
                                            <div className="px-4 py-8 text-center text-sm text-neutral-500">
                                                Orders search coming soon
                                            </div>
                                        ) : activeTab === 'draftOrders' && searchResults.draftOrders.length > 0 ? (
                                            <div className="px-4 py-8 text-center text-sm text-neutral-500">
                                                Draft orders search coming soon
                                            </div>
                                        ) : (
                                            <div className="px-4 py-8 text-center text-sm text-neutral-500">
                                                No {activeTab === 'products' ? 'products' : activeTab === 'orders' ? 'orders' : 'draft orders'} found
                                            </div>
                                        )}
                                    </div>

                                    {/* Footer Actions */}
                                    {searchInput && (
                                        <div className="px-4 py-3 border-t border-neutral-200 bg-neutral-50">
                                            <button
                                                onClick={() => {
                                                    const params = new URLSearchParams(window.location.search);
                                                    params.set('q', searchInput);
                                                    params.delete('cursor');
                                                    navigate(`${window.location.pathname}?${params.toString()}`);
                                                    setSearchOverlayOpen(false);
                                                }}
                                                className="text-sm text-neutral-900 hover:underline"
                                            >
                                                View all results for "{searchInput}"
                                            </button>
                                        </div>
                                    )}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Shopify-style Status Tabs */}
                        <div className="border-b border-neutral-200 -mx-1 px-1">
                            <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                                {[
                                    { value: 'all', label: 'All' },
                                    { value: 'ACTIVE', label: 'Active' },
                                    { value: 'DRAFT', label: 'Draft' },
                                    { value: 'ARCHIVED', label: 'Archived' }
                                ].map((tab) => {
                                    const isActive = statusFilter === tab.value;
                                    return (
                                        <button
                                            key={tab.value}
                                            onClick={() => {
                                                const params = new URLSearchParams(window.location.search);
                                                params.set('status', tab.value);
                                                params.delete('cursor');
                                                navigate(`${window.location.pathname}?${params.toString()}`);
                                            }}
                                            className={`
                                                px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors
                                                relative -mb-px
                                                ${isActive
                                                    ? 'text-neutral-900 border-b-2 border-neutral-900'
                                                    : 'text-neutral-600 hover:text-neutral-900 border-b-2 border-transparent hover:border-neutral-300'
                                                }
                                            `}
                                        >
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Bulk Actions Bar */}
                    {selectedIds.length > 0 && (
                        <div className="bg-neutral-900 text-white p-4 rounded-xl flex items-center justify-between shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
                            <div className="flex items-center gap-3">
                                {!bulkProgress ? (
                                    <>
                                        <span className="text-sm font-semibold bg-white/20 px-3 py-1.5 rounded-full">
                                            {selectedIds.length} selected
                                        </span>
                                        <button
                                            onClick={handleBulkPrepare}
                                            className="px-4 py-2 bg-white text-neutral-900 text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-colors"
                                        >
                                            Prepare Selected
                                        </button>
                                    </>
                                ) : bulkProgress.status === 'running' ? (
                                    <div className="flex items-center gap-3">
                                        <div className="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-white transition-all duration-300"
                                                style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-sm">
                                            Preparing {bulkProgress.current}/{bulkProgress.total}...
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <span className="text-sm font-medium">
                                            Done! {bulkProgress.successCount} queued{bulkProgress.failCount > 0 ? `, ${bulkProgress.failCount} failed` : ''}
                                        </span>
                                        {bulkProgress.errors && bulkProgress.errors.length > 0 && (
                                            <details className="text-xs text-white/80">
                                                <summary className="cursor-pointer hover:text-white">Show errors ({bulkProgress.errors.length})</summary>
                                                <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                                                    {bulkProgress.errors.slice(0, 5).map((err, idx) => (
                                                        <li key={idx} className="pl-2 border-l-2 border-white/20">
                                                            {err.productId ? `Product ${err.productId}: ` : ''}{err.error}
                                                        </li>
                                                    ))}
                                                    {bulkProgress.errors.length > 5 && (
                                                        <li className="text-white/60">... and {bulkProgress.errors.length - 5} more</li>
                                                    )}
                                                </ul>
                                            </details>
                                        )}
                                    </div>
                                )}
                            </div>
                            {!bulkProgress && (
                                <button
                                    onClick={() => setSelectedIds([])}
                                    className="p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    )}

                    {/* Divider */}
                    <div className="border-t border-neutral-200"></div>

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
                                            <th className="px-3 md:px-4 py-2.5 md:py-3 font-normal w-12">
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
                                            <th className="px-3 md:px-4 py-2.5 md:py-3 font-normal w-24">Images</th>
                                            <SortHeader label="Product" field="title" />
                                            <SortHeader label="Price" field="price" />
                                            <SortHeader label="Status" field="status" />
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
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3" onClick={(e) => e.stopPropagation()}>
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
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3">
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
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3">
                                                        <div className="font-bold text-neutral-900">{product.title}</div>
                                                        <div className="text-neutral-500 text-xs truncate max-w-[180px]">
                                                            {product.handle}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3">
                                                        <div className="text-neutral-900 font-medium whitespace-nowrap">
                                                            {price ? `${parseFloat(price.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${price.currencyCode}` : '—'}
                                                        </div>
                                                        <div className={`text-xs mt-0.5 ${product.totalInventory > 0 ? 'text-neutral-500' : 'text-red-500'}`}>
                                                            {product.totalInventory > 0 ? `${product.totalInventory} in stock` : 'Out of stock'}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3">
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
                                <Link to={`?cursor=${pageInfo.startCursor}&direction=previous&q=${searchQuery}&status=${statusFilter}&sort=${sortField}&sortDir=${sortDir}`}>
                                    <Button variant="secondary" size="sm">Previous</Button>
                                </Link>
                            )}
                            {pageInfo?.hasNextPage && (
                                <Link to={`?cursor=${pageInfo.endCursor}&direction=next&q=${searchQuery}&status=${statusFilter}&sort=${sortField}&sortDir=${sortDir}`}>
                                    <Button variant="secondary" size="sm">Next</Button>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            </PageShell >

            {/* Toast */}
            {
                toast && (
                    <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg text-sm font-medium text-white z-50 shadow-lg ${toast.type === 'success' ? 'bg-emerald-600' :
                        toast.type === 'err' ? 'bg-red-600' :
                            'bg-neutral-900'
                        }`}>
                        {toast.msg}
                    </div>
                )
            }

            {/* Product Detail Panel (One-stop shop) */}
            {
                detailPanelProduct && (
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
                )
            }
        </>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    let title = "Error";
    let message = "Something went wrong";
    let errorDetails = null;

    if (isRouteErrorResponse(error)) {
        title = `${error.status}`;
        message = error.data?.message || error.statusText || "Unexpected Server Error";
        errorDetails = error.data;
    } else if (error instanceof Error) {
        message = error.message || "Unexpected Server Error";
        errorDetails = {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause
        };
    } else {
        message = String(error) || "Unexpected Server Error";
        errorDetails = { raw: error };
    }

    // Always show error details in development, and also show a simplified version in production
    const isDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    return (
        <>
            <TitleBar title="See It Products" />
            <PageShell>
                <div className="bg-white rounded-xl border border-red-200 p-6">
                    <div className="space-y-4">
                        <div>
                            <h1 className="text-lg font-semibold text-red-600">{title}</h1>
                            <p className="text-sm text-neutral-600 mt-1 font-medium">{message}</p>
                            {(errorDetails || isDev) && (
                                <details className="mt-4 text-xs" open={isDev}>
                                    <summary className="cursor-pointer text-neutral-500 hover:text-neutral-900 font-medium">
                                        Error Details {isDev ? '(Development Mode)' : '(Click to expand)'}
                                    </summary>
                                    <pre className="mt-2 p-3 bg-neutral-50 rounded overflow-auto max-h-96 text-xs border border-neutral-200">
                                        {JSON.stringify(errorDetails || error, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <Button variant="primary" onClick={() => window.location.reload()}>
                                Refresh
                            </Button>
                            <Button variant="secondary" onClick={() => window.location.href = '/app'}>
                                Go to Dashboard
                            </Button>
                        </div>
                    </div>
                </div>
            </PageShell>
        </>
    );
}

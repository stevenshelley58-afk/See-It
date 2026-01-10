// Single-product prepare endpoint
// Path: POST /api/products/prepare
// Used by app.products.jsx for individual product preparation
// Accepts just productId and fetches image details from Shopify

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId, addRequestIdHeader } from "../utils/request-context.server";
import { getShopFromSession } from "../utils/shop.server";
import { validateShopifyUrl } from "../utils/validate-shopify-url.server";

export const action = async ({ request }) => {
    const requestId = getRequestId(request);

    try {
        const { admin, session } = await authenticate.admin(request);
        const { shopId } = await getShopFromSession(session, request, "prepare");
        const formData = await request.formData();
        const productId = formData.get("productId");

        if (!productId) {
            return addRequestIdHeader(
                json({ error: "Missing required field: productId", message: "Product ID is required", requestId }, { status: 400 }),
                requestId
            );
        }

        logger.info(
            createLogContext("prepare", requestId, "single-start", { shopId, productId }),
            `Single prepare started for product ${productId}`
        );

        // Convert numeric ID to GID format if needed
        const productGid = String(productId).startsWith('gid://')
            ? productId
            : `gid://shopify/Product/${productId}`;

        // Fetch product details from Shopify GraphQL
        const response = await admin.graphql(
            `#graphql
            query getProduct($id: ID!) {
              product(id: $id) {
                id
                title
                productType
                featuredImage {
                  id
                  url
                }
              }
            }`,
            {
                variables: { id: productGid }
            }
        );

        const responseJson = await response.json();
        const product = responseJson.data?.product;

        // Check for GraphQL errors
        if (responseJson.errors?.length > 0) {
            const gqlError = responseJson.errors[0]?.message || "GraphQL error";
            logger.error(
                createLogContext("prepare", requestId, "graphql-error", { shopId, productId, productGid }),
                `Shopify GraphQL error: ${gqlError}`,
                { graphqlErrors: responseJson.errors }
            );
            return addRequestIdHeader(
                json({ error: gqlError, message: "Failed to fetch product from Shopify", requestId }, { status: 400 }),
                requestId
            );
        }

        if (!product) {
            logger.warn(
                createLogContext("prepare", requestId, "product-not-found", { shopId, productId, productGid }),
                `Product not found in Shopify (may be deleted or ID mismatch)`
            );
            return addRequestIdHeader(
                json({ error: "Product not found", message: "Product not found in Shopify", requestId }, { status: 404 }),
                requestId
            );
        }

        if (!product.featuredImage) {
            logger.warn(
                createLogContext("prepare", requestId, "no-image", { shopId, productId }),
                `Product has no featured image - cannot prepare`
            );
            return addRequestIdHeader(
                json({ error: "No image", message: "Product has no featured image - upload an image first", requestId }, { status: 400 }),
                requestId
            );
        }

        const imageId = product.featuredImage.id;
        const imageUrl = product.featuredImage.url;
        const productTitle = product.title || null;
        const productType = product.productType || null;

        logger.info(
            createLogContext("prepare", requestId, "fetch-title", { shopId, productId }),
            `Fetched product title: "${productTitle}", productType: "${productType}"`
        );

        // Validate image URL to prevent SSRF attacks
        try {
            validateShopifyUrl(imageUrl, "product image URL");
        } catch (error) {
            logger.error(
                createLogContext("prepare", requestId, "validation", { shopId, productId }),
                "Invalid image URL (potential SSRF attempt)",
                error
            );
            return addRequestIdHeader(
                json({
                    error: "Invalid image URL",
                    message: error instanceof Error ? error.message : "URL must be from Shopify CDN",
                    requestId
                }, { status: 400 }),
                requestId
            );
        }

        // Enforce quota for single preparation
        try {
            await enforceQuota(shopId, "prep", 1);
        } catch (error) {
            if (error instanceof Response) {
                const data = await error.json();
                return json(data, { status: 429 });
            }
            throw error;
        }

        // Create or Update asset to "pending" - use transaction for atomicity
        await prisma.$transaction(async (tx) => {
            const existing = await tx.productAsset.findFirst({
                where: {
                    shopId,
                    productId: String(productId)
                }
            });

            if (existing) {
                await tx.productAsset.update({
                    where: { id: existing.id },
                    data: {
                        status: "preparing",
                        enabled: false,
                        prepStrategy: "manual",
                        sourceImageUrl: String(imageUrl),
                        sourceImageId: String(imageId),
                        productTitle: productTitle,
                        productType: productType,
                        retryCount: 0, // Reset retry count so processor picks it up
                        errorMessage: null, // Clear previous error
                        updatedAt: new Date()
                    }
                });
            } else {
                await tx.productAsset.create({
                    data: {
                        shopId,
                        productId: String(productId),
                        productTitle: productTitle,
                        productType: productType,
                        sourceImageId: String(imageId),
                        sourceImageUrl: String(imageUrl),
                        status: "preparing",
                        enabled: false,
                        prepStrategy: "manual",
                        promptVersion: 1,
                        createdAt: new Date()
                    }
                });
            }
        });

        logger.info(
            createLogContext("prepare", requestId, "queued", { shopId, productId }),
            `Product ${productId} queued for background processing`
        );

        return addRequestIdHeader(
            json({
                success: true,
                queued: 1,
                message: `Queued "${product.title}" for background removal`,
                requestId
            }),
            requestId
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            createLogContext("prepare", requestId, "error", {}),
            "Prepare route failed with unhandled error",
            error
        );

        return addRequestIdHeader(
            json({
                error: errorMessage,
                message: "Failed to queue product for processing",
                requestId
            }, { status: 500 }),
            requestId
        );
    }
};

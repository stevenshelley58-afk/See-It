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
        const productIdsJson = formData.get("productIds");

        if (!productIdsJson) {
            return addRequestIdHeader(
                json({ error: "Missing productIds", requestId }, { status: 400 }),
                requestId
            );
        }

        let productIds;
        try {
            productIds = JSON.parse(productIdsJson);
        } catch (e) {
            return addRequestIdHeader(
                json({ error: "Invalid productIds format", requestId }, { status: 400 }),
                requestId
            );
        }

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return addRequestIdHeader(
                json({ error: "productIds must be a non-empty array", requestId }, { status: 400 }),
                requestId
            );
        }

        logger.info(
            createLogContext("prepare", requestId, "batch-start", { shopId, count: productIds.length }),
            `Batch prepare started: ${productIds.length} products [${productIds.slice(0, 3).join(', ')}${productIds.length > 3 ? '...' : ''}]`
        );

        // Enforce quota for the entire batch
        try {
            await enforceQuota(shopId, "prep", productIds.length);
        } catch (error) {
            if (error instanceof Response) {
                const data = await error.json();
                return json(data, { status: 429 });
            }
            throw error;
        }

        let queued = 0;
        const errors = [];

        // Convert all product IDs to GID format
        const productGids = productIds.map(id => 
            String(id).startsWith('gid://') ? id : `gid://shopify/Product/${id}`
        );

        // Batch fetch all products in a single GraphQL query (fixes N+1 problem)
        const response = await admin.graphql(
            `#graphql
            query getProducts($ids: [ID!]!) {
                nodes(ids: $ids) {
                    ... on Product {
                        id
                        title
                        featuredImage {
                            id
                            url
                        }
                    }
                }
            }`,
            {
                variables: { ids: productGids }
            }
        );

        const responseJson = await response.json();
        const products = responseJson.data?.nodes || [];

        // Check for GraphQL errors
        if (responseJson.errors?.length > 0) {
            const gqlError = responseJson.errors[0]?.message || "GraphQL error";
            logger.error(
                createLogContext("prepare", requestId, "batch-graphql-error", { shopId }),
                `Shopify GraphQL batch error: ${gqlError}`,
                { graphqlErrors: responseJson.errors }
            );
            // If batch query fails entirely, mark all as errors
            productIds.forEach(productId => {
                errors.push({ productId, error: `GraphQL: ${gqlError}` });
            });
        } else {
            // Create a map of GID -> product for quick lookup
            const productMap = new Map();
            products.forEach(product => {
                if (product && product.id) {
                    // Extract numeric ID from GID for mapping
                    const numericId = product.id.split('/').pop();
                    productMap.set(numericId, product);
                }
            });

            // Process each product
            for (const productId of productIds) {
                try {
                    const product = productMap.get(String(productId));

                    if (!product) {
                        logger.warn(
                            createLogContext("prepare", requestId, "batch-product-not-found", { shopId, productId }),
                            `Product not found in Shopify (may be deleted or ID mismatch)`
                        );
                        errors.push({ productId, error: "Product not found in Shopify" });
                        continue;
                    }

                    if (!product.featuredImage) {
                        logger.warn(
                            createLogContext("prepare", requestId, "batch-no-image", { shopId, productId }),
                            `Product has no featured image - cannot prepare`
                        );
                        errors.push({ productId, error: "No featured image - upload an image first" });
                        continue;
                    }

                    const imageId = product.featuredImage.id;
                    const imageUrl = product.featuredImage.url;
                    const productTitle = product.title; // For Grounded SAM text-prompted segmentation

                    // Validate image URL
                    try {
                        validateShopifyUrl(imageUrl, "product image URL");
                    } catch (urlError) {
                        logger.error(
                            createLogContext("prepare", requestId, "batch-validation", { shopId, productId }),
                            "Invalid image URL from Shopify GraphQL (unexpected)",
                            urlError
                        );
                        errors.push({ productId, error: "Invalid image URL from Shopify" });
                        continue;
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
                                    status: "pending",
                                    prepStrategy: "batch",
                                    sourceImageUrl: String(imageUrl),
                                    sourceImageId: String(imageId),
                                    productTitle: productTitle, // Store for Grounded SAM
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
                                    productTitle: productTitle, // Store for Grounded SAM
                                    sourceImageId: String(imageId),
                                    sourceImageUrl: String(imageUrl),
                                    status: "pending",
                                    prepStrategy: "batch",
                                    promptVersion: 1,
                                    createdAt: new Date()
                                }
                            });
                        }
                    });

                    queued++;

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    logger.error(
                        createLogContext("prepare", requestId, "batch-item-queue", {
                            shopId,
                            productId: String(productId),
                        }),
                        "Error queuing product for batch",
                        error
                    );
                    errors.push({
                        productId,
                        error: errorMessage
                    });
                }
            }
        }

        logger.info(
            createLogContext("prepare", requestId, "batch-complete", { shopId }),
            `Batch queued: ${queued} queued, ${errors.length} failed init`
        );

        return addRequestIdHeader(
            json({
                processed: queued, // Keep 'processed' key for frontend compatibility logic
                queued,
                errors,
                message: `Queued ${queued} products for background processing${errors.length > 0 ? `, ${errors.length} failed to queue` : ''}`,
                requestId
            }),
            requestId
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            createLogContext("prepare", requestId, "batch-error", {}),
            "Batch prepare route failed with unhandled error",
            error
        );

        return addRequestIdHeader(
            json({
                error: errorMessage,
                message: "Batch preparation failed",
                requestId
            }, { status: 500 }),
            requestId
        );
    }
};

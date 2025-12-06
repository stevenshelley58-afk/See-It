import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";
import { prepareProduct } from "../services/gemini.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId, addRequestIdHeader } from "../utils/request-context.server";
import { getShopFromSession } from "../utils/shop.server";

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

        let processed = 0;
        const errors = [];

    for (const productId of productIds) {
        try {
            // Fetch product details from Shopify GraphQL
            const response = await admin.graphql(
                `#graphql
                query getProduct($id: ID!) {
                  product(id: $id) {
                    id
                    featuredImage {
                      id
                      url
                    }
                  }
                }`,
                {
                    variables: { id: productId }
                }
            );

            const responseJson = await response.json();
            const product = responseJson.data?.product;

            if (!product || !product.featuredImage) {
                errors.push({ productId, error: "No featured image found" });
                continue;
            }

            const imageId = product.featuredImage.id;
            const imageUrl = product.featuredImage.url;

            // Check if asset already exists
            let assetId;
            const existing = await prisma.productAsset.findFirst({
                where: {
                    shopId,
                    productId: String(productId)
                }
            });

            if (existing) {
                assetId = existing.id;
                // Update existing asset to pending with batch strategy
                await prisma.productAsset.update({
                    where: { id: existing.id },
                    data: {
                        status: "pending",
                        prepStrategy: "batch",
                        sourceImageUrl: String(imageUrl),
                        sourceImageId: String(imageId),
                        updatedAt: new Date()
                    }
                });
            } else {
                // Create new asset with batch strategy
                const newAsset = await prisma.productAsset.create({
                    data: {
                        shopId,
                        productId: String(productId),
                        sourceImageId: String(imageId),
                        sourceImageUrl: String(imageUrl),
                        status: "pending",
                        prepStrategy: "batch",
                        promptVersion: 1,
                        createdAt: new Date()
                    }
                });
                assetId = newAsset.id;
            }

            // Process the image immediately using local Gemini service
            const preparedImageUrl = await prepareProduct(
                String(imageUrl),
                shopId,
                String(productId),
                assetId,
                requestId
            );

            // Update as ready
            await prisma.productAsset.update({
                where: { id: assetId },
                data: {
                    status: "ready",
                    preparedImageUrl: preparedImageUrl,
                    updatedAt: new Date()
                }
            });

            processed++;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error(
                createLogContext("prepare", requestId, "batch-item", {
                    shopId,
                    productId: String(productId),
                    assetId,
                }),
                "Error processing product in batch",
                error
            );
            
            // Update asset status to failed
            try {
                await prisma.productAsset.update({
                    where: { id: assetId },
                    data: {
                        status: "failed",
                        errorMessage: errorMessage.substring(0, 500)
                    }
                });
            } catch (dbError) {
                // Ignore DB errors in batch context
            }
            
            errors.push({
                productId,
                error: errorMessage
            });
        }
    }

        logger.info(
            createLogContext("prepare", requestId, "batch-complete", { shopId }),
            `Batch prepare completed: ${processed} processed, ${errors.length} failed`
        );

        return addRequestIdHeader(
            json({
                processed,
                errors,
                message: `Processed ${processed} products${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
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

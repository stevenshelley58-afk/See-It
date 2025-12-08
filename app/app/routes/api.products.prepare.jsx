// Legacy single-product prepare endpoint
// Path: POST /api/products/prepare
// Used by app.products.jsx for individual product preparation

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";
import { prepareProduct } from "../services/gemini.server";
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
        const imageUrl = formData.get("imageUrl");
        const imageId = formData.get("imageId");

        if (!productId || !imageUrl || !imageId) {
            return addRequestIdHeader(
                json({ error: "Missing required fields: productId, imageUrl, imageId", requestId }, { status: 400 }),
                requestId
            );
        }

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
            // Update existing asset to pending with manual strategy
            await prisma.productAsset.update({
                where: { id: existing.id },
                data: {
                    status: "pending",
                    prepStrategy: "manual",
                    sourceImageUrl: String(imageUrl),
                    sourceImageId: String(imageId),
                    updatedAt: new Date()
                }
            });
        } else {
            // Create new asset with manual strategy
            const newAsset = await prisma.productAsset.create({
                data: {
                    shopId,
                    productId: String(productId),
                    sourceImageId: String(imageId),
                    sourceImageUrl: String(imageUrl),
                    status: "pending",
                    prepStrategy: "manual",
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

        logger.info(
            createLogContext("prepare", requestId, "complete", { shopId, productId, assetId }),
            "Product preparation completed successfully"
        );

        return addRequestIdHeader(
            json({
                success: true,
                assetId,
                preparedImageUrl,
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
                message: "Preparation failed",
                requestId
            }, { status: 500 }),
            requestId
        );
    }
};

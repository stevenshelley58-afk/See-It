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
    let shopId: string | null = null;
    let productId: string | null = null;
    let assetId: string | null = null;

    try {
        const { session } = await authenticate.admin(request);
        const { shopId: resolvedShopId } = await getShopFromSession(session, request, "prepare");
        shopId = resolvedShopId;

        const formData = await request.formData();
        productId = formData.get("productId")?.toString() || null;
        const imageUrl = formData.get("imageUrl")?.toString();
        const imageId = formData.get("imageId")?.toString();

        if (!productId || !imageUrl) {
            logger.warn(
                createLogContext("prepare", requestId, "validation", { shopId, productId }),
                "Missing required fields: productId or imageUrl"
            );
            return addRequestIdHeader(
                json({ error: "Missing data", requestId }, { status: 400 }),
                requestId
            );
        }

        // Check for existing asset and idempotency
        const existing = await prisma.productAsset.findFirst({
            where: { shopId, productId: String(productId) }
        });

        // If asset is already ready, return it unless explicitly re-preparing
        if (existing && existing.status === "ready" && existing.preparedImageUrl) {
            logger.info(
                createLogContext("prepare", requestId, "idempotency-check", {
                    shopId,
                    productId,
                    assetId: existing.id,
                }),
                "Asset already prepared, returning existing"
            );
            return addRequestIdHeader(
                json({
                    success: true,
                    preparedImageUrl: existing.preparedImageUrl,
                    requestId,
                    alreadyPrepared: true,
                }),
                requestId
            );
        }

        // Enforce quota
        try {
            await enforceQuota(shopId, "prep", 1);
        } catch (error) {
            if (error instanceof Response) {
                const data = await error.json();
                logger.warn(
                    createLogContext("prepare", requestId, "quota", { shopId, productId }),
                    "Quota exceeded"
                );
                return addRequestIdHeader(
                    json({ ...data, requestId }, { status: 429 }),
                    requestId
                );
            }
            throw error;
        }

        // 1. Create/Update record as PENDING
        if (existing) {
            assetId = existing.id;
            // Only update if not already processing (avoid race conditions)
            if (existing.status !== "processing") {
                await prisma.productAsset.update({
                    where: { id: existing.id },
                    data: { status: "pending", sourceImageUrl: String(imageUrl) }
                });
            } else {
                logger.info(
                    createLogContext("prepare", requestId, "db-update", {
                        shopId,
                        productId,
                        assetId,
                    }),
                    "Asset already processing, skipping update"
                );
            }
        } else {
            const newAsset = await prisma.productAsset.create({
                data: {
                    shopId,
                    productId: String(productId),
                    sourceImageId: String(imageId) || "unknown",
                    sourceImageUrl: String(imageUrl),
                    status: "pending",
                    prepStrategy: "manual",
                    promptVersion: 1,
                    createdAt: new Date()
                }
            });
            assetId = newAsset.id;
        }

        logger.info(
            createLogContext("prepare", requestId, "db-update", {
                shopId,
                productId,
                assetId,
            }),
            "Asset record created/updated, starting preparation"
        );

        // 2. Process image using local Gemini service
        const preparedImageUrl = await prepareProduct(
            String(imageUrl),
            shopId,
            String(productId),
            assetId,
            requestId
        );

        if (!preparedImageUrl) {
            throw new Error("prepareProduct returned no URL");
        }

        // 3. Update record as READY
        await prisma.productAsset.update({
            where: { id: assetId },
            data: { 
                status: "ready", 
                preparedImageUrl: preparedImageUrl 
            }
        });

        logger.info(
            createLogContext("prepare", requestId, "complete", {
                shopId,
                productId,
                assetId,
            }),
            "Asset preparation completed successfully"
        );

        return addRequestIdHeader(
            json({ success: true, preparedImageUrl: preparedImageUrl, requestId }),
            requestId
        );

    } catch (error) {
        logger.error(
            createLogContext("prepare", requestId, "error-boundary", {
                shopId,
                productId,
                assetId,
            }),
            "Prepare action failed",
            error
        );

        // Update record as FAILED if we have an assetId
        if (assetId) {
            try {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await prisma.productAsset.update({
                    where: { id: assetId },
                    data: {
                        status: "failed",
                        errorMessage: errorMessage.substring(0, 500) // Limit length
                    }
                });
            } catch (dbError) {
                logger.error(
                    createLogContext("prepare", requestId, "db-update", {
                        shopId,
                        productId,
                        assetId,
                    }),
                    "Failed to update asset status to failed",
                    dbError
                );
            }
        }

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return addRequestIdHeader(
            json(
                {
                    error: errorMessage,
                    requestId,
                    ...(assetId && { assetId }),
                },
                { status: 500 }
            ),
            requestId
        );
    }
};

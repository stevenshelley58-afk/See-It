import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { removeBackgroundFast } from "../services/background-remover.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { emitPrepEvent } from "../services/prep-events.server";
import { trimTransparentPaddingPng } from "../services/image-prep/trim-alpha.server";
import sharp from "sharp";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_SOURCE_EDGE_PX = 4096;

/**
 * Extract image ID from Shopify CDN URL
 * e.g., "https://cdn.shopify.com/s/files/.../double-iron-caddy-900895.jpg?v=1729945400"
 * returns "double-iron-caddy-900895" or a hash of the URL
 */
function extractImageId(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        // Get filename without extension
        const filename = pathname.split('/').pop()?.split('.')[0];
        return filename || null;
    } catch {
        return null;
    }
}

/**
 * POST /api/products/remove-background
 *
 * One-click background removal using PhotoRoom
 *
 * Body:
 * - productId: Shopify product ID
 */
export const action = async ({ request }) => {
    const requestId = `bg-remove-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "remove-background", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopId = session.shop;

        // Clone request to handle potential stream reading issues if needed, though usually standard for formData
        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();
        const imageUrl = formData.get("imageUrl")?.toString();
        const file = formData.get("file");

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        logger.info(logContext, `Background removal request: productId=${productId}, hasFile=${!!file}, hasUrl=${!!imageUrl}`);

        // Get shop record
        const shop = await prisma.shop.findUnique({
            where: { shopDomain: shopId },
        });

        if (!shop) {
            return json({ success: false, error: "Shop not found" }, { status: 404 });
        }

        // Get existing asset or create one
        let asset = await prisma.productAsset.findFirst({
            where: {
                shopId: shop.id,
                productId: productId,
            },
        });

        let sourceImageUrl = imageUrl || asset?.sourceImageUrl;

        // HANDLE FILE UPLOAD
        if (file && typeof file !== 'string') {
            logger.info(logContext, `Processing file upload: ${file.name} (${file.size} bytes)`);
            if (typeof file.size === "number" && file.size > MAX_UPLOAD_BYTES) {
                return json({ success: false, error: `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.` }, { status: 400 });
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            let normalized;
            try {
                // Normalize orientation + size and encode as JPEG for consistent downstream processing.
                normalized = await sharp(buffer)
                    .rotate()
                    .resize({
                        width: MAX_SOURCE_EDGE_PX,
                        height: MAX_SOURCE_EDGE_PX,
                        fit: "inside",
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 90 })
                    .toBuffer();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.warn(logContext, `Failed to decode/normalize uploaded file: ${message}`);
                return json({ success: false, error: "Unsupported image format. Please upload a JPG, PNG, or WebP under 10MB." }, { status: 400 });
            }

            const filename = `shops/${shop.id}/products/${productId}/source-${Date.now()}.jpg`;

            // Upload source file to storage
            sourceImageUrl = await StorageService.uploadBuffer(
                normalized,
                filename,
                'image/jpeg'
            );
            logger.info(logContext, `Uploaded source image to: ${sourceImageUrl}`);
        }

        if (!sourceImageUrl) {
            return json({ success: false, error: "No image provided (URL or File)" }, { status: 400 });
        }

        // Create asset if it doesn't exist
        if (!asset) {
            const sourceImageId = extractImageId(sourceImageUrl) || `img-${Date.now()}`;

            asset = await prisma.productAsset.create({
                data: {
                    shopId: shop.id,
                    productId: productId,
                    sourceImageId: sourceImageId,
                    sourceImageUrl: sourceImageUrl,
                    status: "processing",
                    prepStrategy: "manual",
                    promptVersion: 1,
                    createdAt: new Date(),
                },
            });
            logger.info(logContext, `Created new ProductAsset for product ${productId}`);
        } else if (sourceImageUrl !== asset.sourceImageUrl) {
            // Update source if a different image was selected or uploaded
            await prisma.productAsset.update({
                where: { id: asset.id },
                data: { sourceImageUrl: sourceImageUrl },
            });
        }

        // Remove background with PhotoRoom
        logger.info({ ...logContext, stage: "processing" }, `Removing background with PhotoRoom...`);

        const result = await removeBackgroundFast(sourceImageUrl, requestId);

        // CRITICAL: Trim transparent padding from the prepared PNG.
        // Some background removal outputs keep the original canvas size with large transparent margins.
        // That causes "scale is off" because we size/measure based on the PNG bounding box.
        let preparedBuffer = result.imageBuffer;
        try {
            const beforeMeta = await sharp(preparedBuffer).metadata();
            const trimmed = await trimTransparentPaddingPng(preparedBuffer);
            const afterMeta = await sharp(trimmed).metadata();

            if (afterMeta.width && afterMeta.height && beforeMeta.width && beforeMeta.height) {
                if (afterMeta.width <= beforeMeta.width && afterMeta.height <= beforeMeta.height && trimmed.length > 0) {
                    preparedBuffer = trimmed;
                    logger.info(
                        { ...logContext, stage: "trim" },
                        `Trimmed transparent padding: ${beforeMeta.width}×${beforeMeta.height} → ${afterMeta.width}×${afterMeta.height}`
                    );
                }
            }
        } catch (trimError) {
            logger.warn(
                { ...logContext, stage: "trim" },
                "Failed to trim transparent padding (continuing with untrimmed PNG)",
                trimError
            );
        }

        // Upload to GCS
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-${Date.now()}.png`;

        const preparedImageUrl = await StorageService.uploadBuffer(
            preparedBuffer,
            preparedImageKey,
            'image/png'
        );

        // If this product is already enabled/live, do not regress it back to "ready"
        const nextStatus = asset.enabled || asset.status === "live" ? "live" : "ready";

        // Update the asset
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                preparedImageKey,
                preparedImageUrl,
                status: nextStatus,
                errorMessage: null,
                updatedAt: new Date(),
            },
        });

        // Emit manual_cutout_applied event
        await emitPrepEvent(
            {
                assetId: asset.id,
                productId: productId,
                shopId: shop.id,
                eventType: "manual_cutout_applied",
                actorType: "merchant",
                payload: {
                    source: "manual",
                    preparedImageKey,
                    processingTimeMs: result.processingTimeMs,
                },
            },
            session,
            requestId
        ).catch(() => {
            // Non-critical
        });

        logger.info(
            { ...logContext, stage: "complete" },
            `Background removed in ${result.processingTimeMs}ms`
        );

        // Return fresh signed URL
        const signedUrl = await StorageService.getSignedReadUrl(preparedImageKey, 60 * 60 * 1000);

        return json({
            success: true,
            preparedImageUrl: signedUrl,
            processingTimeMs: result.processingTimeMs,
            message: "Background removed successfully",
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Background removal failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

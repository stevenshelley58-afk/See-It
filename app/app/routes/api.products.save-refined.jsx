import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /api/products/save-refined
 *
 * Save a refined image (after user edited with smart brush)
 *
 * Body:
 * - productId: Shopify product ID
 * - imageDataUrl: Base64 data URL of the refined image (PNG with transparency)
 */
export const action = async ({ request }) => {
    const requestId = `save-refined-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "save-refined", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopId = session.shop;

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();
        const imageDataUrl = formData.get("imageDataUrl")?.toString();

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        if (!imageDataUrl) {
            return json({ success: false, error: "Missing imageDataUrl" }, { status: 400 });
        }

        logger.info(logContext, `Save refined request: productId=${productId}`);

        // Get shop record
        const shop = await prisma.shop.findUnique({
            where: { shopDomain: shopId },
        });

        if (!shop) {
            return json({ success: false, error: "Shop not found" }, { status: 404 });
        }

        // Get existing asset
        const asset = await prisma.productAsset.findFirst({
            where: {
                shopId: shop.id,
                productId: productId,
            },
        });

        if (!asset) {
            return json({ success: false, error: "Product asset not found" }, { status: 404 });
        }

        const startTime = Date.now();

        // Parse image from data URL
        const base64Data = imageDataUrl.split(',')[1];
        if (!base64Data) {
            return json({ success: false, error: "Invalid image data URL format" }, { status: 400 });
        }
        let imageBuffer = Buffer.from(base64Data, 'base64');

        // CRITICAL: Trim transparent padding so sizing is based on visible product content
        // Without this, a user-refined cutout can include transparent edges,
        // causing the product to appear too small during placement and in final renders.
        try {
            const beforeMeta = await sharp(imageBuffer).metadata();
            const trimmed = await sharp(imageBuffer)
                .trim() // Removes transparent edges
                .png()
                .toBuffer();
            const afterMeta = await sharp(trimmed).metadata();

            if (afterMeta.width && afterMeta.height && beforeMeta.width && beforeMeta.height) {
                if (afterMeta.width <= beforeMeta.width && afterMeta.height <= beforeMeta.height && trimmed.length > 0) {
                    imageBuffer = trimmed;
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
        logger.info({ ...logContext, stage: "uploading" }, "Uploading refined image...");
        const preparedImageKey = `shops/${shop.id}/products/${productId}/refined-${Date.now()}.png`;

        const preparedImageUrl = await StorageService.uploadBuffer(
            imageBuffer,
            preparedImageKey,
            'image/png'
        );

        // Update asset
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                preparedImageKey,
                preparedImageUrl,
                // If this product is already enabled/live, do not regress it back to "ready"
                status: asset.enabled || asset.status === "live" ? "live" : "ready",
                errorMessage: null,
                // Prepared product image changed: bump version and invalidate cached Gemini file
                preparedProductImageVersion: { increment: 1 },
                preparedProductImageUpdatedAt: new Date(),
                geminiFileUri: null,
                geminiFileExpiresAt: null,
                updatedAt: new Date(),
            },
        });

        const processingTimeMs = Date.now() - startTime;
        logger.info(
            { ...logContext, stage: "complete" },
            `Refined image saved in ${processingTimeMs}ms`
        );

        // Return fresh signed URL
        const signedUrl = await StorageService.getSignedReadUrl(preparedImageKey, 60 * 60 * 1000);

        return json({
            success: true,
            preparedImageUrl: signedUrl,
            processingTimeMs,
            message: "Refined image saved successfully",
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Save refined failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

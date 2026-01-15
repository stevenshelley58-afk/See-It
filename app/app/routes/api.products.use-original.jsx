import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import sharp from "sharp";

const MAX_ORIGINAL_EDGE_PX = 4096;

/**
 * POST /api/products/use-original
 *
 * Skip background removal and use the original product image as-is.
 * Used when the product image already has a suitable background
 * or background removal consistently fails.
 *
 * Body:
 * - productId: Shopify product ID (numeric)
 */
export const action = async ({ request }) => {
    const requestId = `use-original-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "use-original", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopId = session.shop;

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();

        logger.info(logContext, `Use original image request: productId=${productId}`);

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        // Get shop record
        const shop = await prisma.shop.findUnique({
            where: { shopDomain: shopId },
        });

        if (!shop) {
            return json({ success: false, error: "Shop not found" }, { status: 404 });
        }

        // Get existing asset for this product
        const asset = await prisma.productAsset.findFirst({
            where: {
                shopId: shop.id,
                productId: productId,
            },
        });

        if (!asset) {
            return json({ success: false, error: "Product asset not found. Please prepare the product first." }, { status: 404 });
        }

        if (!asset.sourceImageUrl) {
            return json({ success: false, error: "No source image URL found for this product" }, { status: 400 });
        }

        logger.info({ ...logContext, stage: "download" }, `Downloading original image`);

        // Download the original image
        const response = await fetch(asset.sourceImageUrl);
        if (!response.ok) {
            throw new Error(`Failed to download original image: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);

        // Convert to PNG (for consistency)
        let pngBuffer = await sharp(inputBuffer)
            .rotate()
            .resize({
                width: MAX_ORIGINAL_EDGE_PX,
                height: MAX_ORIGINAL_EDGE_PX,
                fit: "inside",
                withoutEnlargement: true
            })
            .ensureAlpha()
            .png()
            .toBuffer();

        // CRITICAL: Trim transparent padding so sizing is based on visible product content
        // Even if using original image, it may have transparent edges that cause sizing drift.
        try {
            const beforeMeta = await sharp(pngBuffer).metadata();
            const trimmed = await sharp(pngBuffer)
                .trim() // Removes transparent edges
                .png()
                .toBuffer();
            const afterMeta = await sharp(trimmed).metadata();

            if (afterMeta.width && afterMeta.height && beforeMeta.width && beforeMeta.height) {
                if (afterMeta.width <= beforeMeta.width && afterMeta.height <= beforeMeta.height && trimmed.length > 0) {
                    pngBuffer = trimmed;
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

        // Upload to GCS as the "prepared" image (even though it's unmodified)
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-original-${Date.now()}.png`;

        logger.info({ ...logContext, stage: "upload" }, `Uploading original as prepared: ${preparedImageKey}`);

        const preparedImageUrl = await StorageService.uploadBuffer(
            pngBuffer,
            preparedImageKey,
            'image/png'
        );

        // Update the asset - mark as ready with a flag indicating it's using original
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                preparedImageKey,
                preparedImageUrl,
                // If this product is already enabled/live, do not regress it back to "ready"
                status: asset.enabled || asset.status === "live" ? "live" : "ready",
                errorMessage: null,
                updatedAt: new Date(),
            },
        });

        logger.info({ ...logContext, stage: "complete" }, `Original image set as prepared successfully`);

        // Return fresh signed URL for preview
        const signedUrl = await StorageService.getSignedReadUrl(preparedImageKey, 60 * 60 * 1000);

        return json({
            success: true,
            preparedImageUrl: signedUrl,
            message: "Original image set as prepared",
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Use original image failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

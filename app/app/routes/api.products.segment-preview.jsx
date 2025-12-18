import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getMultiPointMask } from "../services/grounded-sam.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import sharp from "sharp";

/**
 * POST /api/products/segment-preview
 *
 * Generate a mask preview overlay for multi-point segmentation.
 * Shows what will be selected before actually applying.
 *
 * Body:
 * - productId: Shopify product ID
 * - points: JSON array of { x, y, label } where label is 1 (include) or 0 (exclude)
 */
export const action = async ({ request }) => {
    const requestId = `segment-preview-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "segment-preview", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopId = session.shop;

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();
        const pointsJson = formData.get("points")?.toString();

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        if (!pointsJson) {
            return json({ success: false, error: "Missing points" }, { status: 400 });
        }

        let points;
        try {
            points = JSON.parse(pointsJson);
        } catch {
            return json({ success: false, error: "Invalid points JSON" }, { status: 400 });
        }

        if (!Array.isArray(points) || points.length === 0) {
            return json({ success: false, error: "Points must be a non-empty array" }, { status: 400 });
        }

        logger.info(logContext, `Preview request: productId=${productId}, ${points.length} points`);

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

        if (!asset?.sourceImageUrl) {
            return json({ success: false, error: "Product asset not found" }, { status: 404 });
        }

        // Get mask from SAM
        logger.info({ ...logContext, stage: "sam" }, `Getting mask from SAM with ${points.length} points`);

        const { maskBuffer, originalBuffer, width, height } = await getMultiPointMask(
            asset.sourceImageUrl,
            points,
            requestId
        );

        // Create overlay: original image with green tint where mask is white
        logger.info({ ...logContext, stage: "overlay" }, `Creating mask overlay ${width}x${height}`);

        const originalRgba = await sharp(originalBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer();

        const maskGray = await sharp(maskBuffer)
            .resize({ width, height, fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer();

        // Create overlay buffer
        const overlayBuffer = Buffer.alloc(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            const r = originalRgba[i * 4];
            const g = originalRgba[i * 4 + 1];
            const b = originalRgba[i * 4 + 2];
            const maskValue = maskGray[i];

            if (maskValue > 128) {
                // Selected area: add green tint
                overlayBuffer[i * 4] = Math.min(255, Math.round(r * 0.7));
                overlayBuffer[i * 4 + 1] = Math.min(255, Math.round(g * 0.7 + 80));
                overlayBuffer[i * 4 + 2] = Math.min(255, Math.round(b * 0.7));
                overlayBuffer[i * 4 + 3] = 255;
            } else {
                // Not selected: dim and add red tint
                overlayBuffer[i * 4] = Math.min(255, Math.round(r * 0.5 + 40));
                overlayBuffer[i * 4 + 1] = Math.round(g * 0.5);
                overlayBuffer[i * 4 + 2] = Math.round(b * 0.5);
                overlayBuffer[i * 4 + 3] = 255;
            }
        }

        const overlayImage = await sharp(overlayBuffer, {
            raw: { width, height, channels: 4 }
        })
            .png()
            .toBuffer();

        // Upload overlay to GCS (temporary)
        const overlayKey = `shops/${shop.id}/products/${productId}/mask-preview-${Date.now()}.png`;
        const overlayUrl = await StorageService.uploadBuffer(overlayImage, overlayKey, 'image/png');

        logger.info({ ...logContext, stage: "complete" }, `Mask preview created`);

        return json({
            success: true,
            maskOverlayUrl: overlayUrl,
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Preview failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

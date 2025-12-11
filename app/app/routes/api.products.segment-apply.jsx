import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { applyMultiPointMask } from "../services/grounded-sam.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /api/products/segment-apply
 *
 * Apply multi-point segmentation and create final transparent PNG.
 *
 * Body:
 * - productId: Shopify product ID
 * - points: JSON array of { x, y, label } where label is 1 (include) or 0 (exclude)
 */
export const action = async ({ request }) => {
    const requestId = `segment-apply-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "segment-apply", {});

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

        logger.info(logContext, `Apply request: productId=${productId}, ${points.length} points`);

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

        // Apply mask and create transparent image
        logger.info({ ...logContext, stage: "apply" }, `Applying mask with ${points.length} points`);

        const result = await applyMultiPointMask(
            asset.sourceImageUrl,
            points,
            requestId
        );

        // Upload result to GCS
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-${Date.now()}.png`;
        const imageBuffer = Buffer.from(result.imageBase64, 'base64');

        const preparedImageUrl = await StorageService.uploadBuffer(
            imageBuffer,
            preparedImageKey,
            'image/png'
        );

        // Update the asset
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                preparedImageKey,
                preparedImageUrl,
                status: "ready",
                errorMessage: null,
                updatedAt: new Date(),
            },
        });

        logger.info({ ...logContext, stage: "complete" }, `Segmentation applied successfully`);

        // Return fresh signed URL for preview
        const signedUrl = await StorageService.getSignedReadUrl(preparedImageKey, 60 * 60 * 1000);

        return json({
            success: true,
            preparedImageUrl: signedUrl,
            message: "Background removed successfully",
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Apply failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

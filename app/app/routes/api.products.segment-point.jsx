import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { segmentWithPointPrompt } from "../services/grounded-sam.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /api/products/segment-point
 *
 * Segment a product image using a click point (SAM point prompt).
 * Used when auto-detection fails and user manually clicks on the product.
 *
 * Body:
 * - productId: Shopify product ID (numeric)
 * - clickX: X coordinate (0-1 normalized)
 * - clickY: Y coordinate (0-1 normalized)
 */
export const action = async ({ request }) => {
    const requestId = `segment-point-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "segment-point", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopId = session.shop;

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();
        const clickX = parseFloat(formData.get("clickX")?.toString() || "0");
        const clickY = parseFloat(formData.get("clickY")?.toString() || "0");

        logger.info(logContext, `Point segmentation request: productId=${productId}, click=(${clickX}, ${clickY})`);

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        if (isNaN(clickX) || isNaN(clickY) || clickX < 0 || clickX > 1 || clickY < 0 || clickY > 1) {
            return json({ success: false, error: "Invalid click coordinates (must be 0-1)" }, { status: 400 });
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

        // Perform point-based segmentation
        logger.info({ ...logContext, stage: "segment" }, `Starting SAM point segmentation`);

        const result = await segmentWithPointPrompt(
            asset.sourceImageUrl,
            clickX,
            clickY,
            requestId
        );

        // Upload the result to GCS
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-${Date.now()}.png`;
        const imageBuffer = Buffer.from(result.imageBase64, 'base64');

        logger.info({ ...logContext, stage: "upload" }, `Uploading segmented image to GCS`);

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

        logger.info({ ...logContext, stage: "complete" }, `Point segmentation completed successfully`);

        // Return fresh signed URL for preview
        const signedUrl = await StorageService.getSignedReadUrl(preparedImageKey, 60 * 60 * 1000);

        return json({
            success: true,
            preparedImageUrl: signedUrl,
            message: "Product segmented successfully",
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Point segmentation failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

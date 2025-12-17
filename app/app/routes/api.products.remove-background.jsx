import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { removeBackgroundFast } from "../services/background-remover.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /api/products/remove-background
 *
 * One-click background removal - fast and simple
 * Uses 851-labs/background-remover (~3 seconds, ~$0.0005/image)
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

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        logger.info(logContext, `Background removal request: productId=${productId}`);

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

        // Remove background - fast!
        logger.info({ ...logContext, stage: "processing" }, `Removing background...`);

        const result = await removeBackgroundFast(asset.sourceImageUrl, requestId);

        // Download the result and upload to our GCS
        const response = await fetch(result.imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to download processed image: ${response.status}`);
        }

        const imageBuffer = Buffer.from(await response.arrayBuffer());
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-${Date.now()}.png`;

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

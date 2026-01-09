import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { removeBackgroundFast } from "../services/background-remover.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { emitPrepEvent } from "../services/prep-events.server";

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
 * One-click background removal using Prodia API
 * - 190ms latency
 * - $0.0025/image
 * - BiRefNet 2 model
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
            const buffer = Buffer.from(await file.arrayBuffer());
            const filename = `shops/${shop.id}/products/${productId}/source-${Date.now()}-${file.name}`;

            // Upload source file to storage
            sourceImageUrl = await StorageService.uploadBuffer(
                buffer,
                filename,
                file.type || 'image/png'
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

        // Remove background with Prodia - fast!
        logger.info({ ...logContext, stage: "processing" }, `Removing background with Prodia...`);

        const result = await removeBackgroundFast(sourceImageUrl, requestId);

        // Upload to GCS
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-${Date.now()}.png`;

        const preparedImageUrl = await StorageService.uploadBuffer(
            result.imageBuffer,
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

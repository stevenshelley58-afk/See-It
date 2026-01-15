import { json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import sharp from "sharp";

const MAX_PREPARED_EDGE_PX = 4096;

/**
 * POST /api/products/upload-prepared
 *
 * Upload a custom prepared image (with transparent background) for a product.
 * Used when auto-detection and click-to-select both fail.
 *
 * Body (multipart/form-data):
 * - productId: Shopify product ID (numeric)
 * - image: PNG file with transparent background
 */
export const action = async ({ request }) => {
    const requestId = `upload-prepared-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "upload-prepared", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopId = session.shop;

        // Parse multipart form data with size limit (10MB)
        const uploadHandler = unstable_createMemoryUploadHandler({
            maxPartSize: 10 * 1024 * 1024, // 10MB
        });

        const formData = await unstable_parseMultipartFormData(request, uploadHandler);
        const productId = formData.get("productId")?.toString();
        const imageFile = formData.get("image");

        logger.info(logContext, `Upload prepared image request: productId=${productId}`);

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        if (!imageFile || !(imageFile instanceof File)) {
            return json({ success: false, error: "Missing image file" }, { status: 400 });
        }

        // Validate file type
        if (!imageFile.type.startsWith("image/")) {
            return json({ success: false, error: "File must be an image" }, { status: 400 });
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

        // Read and process the uploaded image
        const arrayBuffer = await imageFile.arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);

        logger.info({ ...logContext, stage: "process" }, `Processing uploaded image: ${imageFile.size} bytes`);

        // Convert to PNG with alpha channel (ensure transparency is preserved)
        // IMPORTANT: .rotate() with no args auto-orients based on EXIF and removes the tag
        // This fixes rotation issues with phone photos that have EXIF orientation metadata
        let processedBuffer;
        try {
            processedBuffer = await sharp(inputBuffer)
                .rotate() // Auto-orient based on EXIF, then strip EXIF orientation tag
                .resize({
                    width: MAX_PREPARED_EDGE_PX,
                    height: MAX_PREPARED_EDGE_PX,
                    fit: "inside",
                    withoutEnlargement: true,
                })
                .ensureAlpha()
                .png()
                .toBuffer();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn({ ...logContext, stage: "process" }, `Failed to decode/normalize uploaded image: ${message}`);
            return json({ success: false, error: "Unsupported image format. Please upload a JPG, PNG, or WebP under 10MB." }, { status: 400 });
        }

        // Verify the image has content (not empty)
        const metadata = await sharp(processedBuffer).metadata();
        if (!metadata.width || !metadata.height) {
            return json({ success: false, error: "Invalid image file" }, { status: 400 });
        }

        logger.info({ ...logContext, stage: "process" }, `Image processed: ${metadata.width}x${metadata.height}`);

        // CRITICAL: Trim transparent padding so sizing is based on visible product content
        // User-uploaded prepared images may include transparent edges that cause sizing drift.
        try {
            const beforeMeta = await sharp(processedBuffer).metadata();
            const trimmed = await sharp(processedBuffer)
                .trim() // Removes transparent edges
                .png()
                .toBuffer();
            const afterMeta = await sharp(trimmed).metadata();

            if (afterMeta.width && afterMeta.height && beforeMeta.width && beforeMeta.height) {
                if (afterMeta.width <= beforeMeta.width && afterMeta.height <= beforeMeta.height && trimmed.length > 0) {
                    processedBuffer = trimmed;
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
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-custom-${Date.now()}.png`;

        logger.info({ ...logContext, stage: "upload" }, `Uploading to GCS: ${preparedImageKey}`);

        const preparedImageUrl = await StorageService.uploadBuffer(
            processedBuffer,
            preparedImageKey,
            'image/png'
        );

        // Update the asset
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

        logger.info({ ...logContext, stage: "complete" }, `Custom prepared image uploaded successfully`);

        // Return fresh signed URL for preview
        const signedUrl = await StorageService.getSignedReadUrl(preparedImageKey, 60 * 60 * 1000);

        return json({
            success: true,
            preparedImageUrl: signedUrl,
            message: "Custom image uploaded successfully",
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Upload prepared image failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

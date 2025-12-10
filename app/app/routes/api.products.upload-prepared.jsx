import { json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import sharp from "sharp";

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
        const processedBuffer = await sharp(inputBuffer)
            .ensureAlpha()
            .png()
            .toBuffer();

        // Verify the image has content (not empty)
        const metadata = await sharp(processedBuffer).metadata();
        if (!metadata.width || !metadata.height) {
            return json({ success: false, error: "Invalid image file" }, { status: 400 });
        }

        logger.info({ ...logContext, stage: "process" }, `Image processed: ${metadata.width}x${metadata.height}`);

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
                status: "ready",
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

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import sharp from "sharp";

/**
 * POST /api/products/apply-mask
 *
 * Apply a user-painted mask to remove background.
 * Much simpler and faster than SAM - user IS the segmentation model!
 *
 * Body:
 * - productId: Shopify product ID
 * - maskDataUrl: Base64 data URL of the mask (white = keep, black = remove)
 * - imageUrl: (optional) Source image URL if different from asset
 */
export const action = async ({ request }) => {
    const requestId = `apply-mask-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "apply-mask", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopId = session.shop;

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();
        const maskDataUrl = formData.get("maskDataUrl")?.toString();
        const customImageUrl = formData.get("imageUrl")?.toString();

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        if (!maskDataUrl) {
            return json({ success: false, error: "Missing maskDataUrl" }, { status: 400 });
        }

        logger.info(logContext, `Apply mask request: productId=${productId}`);

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

        const sourceImageUrl = customImageUrl || asset?.sourceImageUrl;
        if (!sourceImageUrl) {
            return json({ success: false, error: "Product asset not found" }, { status: 404 });
        }

        const startTime = Date.now();

        // Download source image
        logger.info({ ...logContext, stage: "downloading" }, "Downloading source image...");
        const imageResponse = await fetch(sourceImageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to download source image: ${imageResponse.status}`);
        }
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

        // Parse mask from data URL
        const maskBase64 = maskDataUrl.split(',')[1];
        if (!maskBase64) {
            return json({ success: false, error: "Invalid mask data URL format" }, { status: 400 });
        }
        const maskBuffer = Buffer.from(maskBase64, 'base64');

        logger.info({ ...logContext, stage: "processing" }, "Processing image with mask...");

        // Get image dimensions
        const imageMetadata = await sharp(imageBuffer).metadata();
        const { width, height } = imageMetadata;

        // Process mask - resize to match image and extract as grayscale
        const processedMask = await sharp(maskBuffer)
            .resize({ width, height, fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer();

        // Get image as RGBA
        const imageRgba = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer();

        // Apply mask as alpha channel (white = opaque, black = transparent)
        const outputBuffer = Buffer.alloc(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            const rgbaIdx = i * 4;
            outputBuffer[rgbaIdx] = imageRgba[rgbaIdx];         // R
            outputBuffer[rgbaIdx + 1] = imageRgba[rgbaIdx + 1]; // G
            outputBuffer[rgbaIdx + 2] = imageRgba[rgbaIdx + 2]; // B
            outputBuffer[rgbaIdx + 3] = processedMask[i];       // A from mask
        }

        // Create final PNG
        const resultBuffer = await sharp(outputBuffer, {
            raw: { width, height, channels: 4 }
        })
            .png()
            .toBuffer();

        const processingTimeMs = Date.now() - startTime;

        // Upload to GCS
        logger.info({ ...logContext, stage: "uploading" }, "Uploading result...");
        const preparedImageKey = `shops/${shop.id}/products/${productId}/prepared-${Date.now()}.png`;

        const preparedImageUrl = await StorageService.uploadBuffer(
            resultBuffer,
            preparedImageKey,
            'image/png'
        );

        // Update or create asset
        if (asset) {
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
        } else {
            await prisma.productAsset.create({
                data: {
                    shopId: shop.id,
                    productId,
                    sourceImageUrl,
                    preparedImageKey,
                    preparedImageUrl,
                    status: "ready",
                },
            });
        }

        logger.info(
            { ...logContext, stage: "complete" },
            `Mask applied in ${processingTimeMs}ms`
        );

        // Return fresh signed URL
        const signedUrl = await StorageService.getSignedReadUrl(preparedImageKey, 60 * 60 * 1000);

        return json({
            success: true,
            preparedImageUrl: signedUrl,
            processingTimeMs,
            message: "Background removed successfully",
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Apply mask failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

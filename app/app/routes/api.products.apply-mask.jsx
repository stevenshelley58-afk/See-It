import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { removeBackgroundFast, isBackgroundRemoverAvailable } from "../services/background-remover.server";
import { emitPrepEvent } from "../services/prep-events.server";
import sharp from "sharp";

/**
 * Extract image ID from Shopify CDN URL
 */
function extractImageId(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop()?.split('.')[0];
        return filename || null;
    } catch {
        return null;
    }
}

/**
 * POST /api/products/apply-mask
 *
 * SMART mask application - combines user's rough selection with AI edge detection.
 *
 * How it works:
 * 1. User paints roughly over the product they want to keep
 * 2. We run Prodia AI to get clean, precise edges
 * 3. We intersect: Prodia's clean edges + user's expanded rough region
 *
 * Result: Clean AI edges, constrained to user's selected area.
 * This handles cases where Prodia keeps multiple objects but user only wants one.
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

        // Emit manual_cutout_started event
        await emitPrepEvent(
            {
                assetId: asset?.id || "unknown",
                productId: productId,
                shopId: shop.id,
                eventType: "manual_cutout_started",
                actorType: "merchant",
                payload: {
                    source: "manual",
                },
            },
            session,
            requestId
        ).catch(() => {
            // Non-critical
        });

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

        // Get image dimensions
        const imageMetadata = await sharp(imageBuffer).metadata();
        const { width, height } = imageMetadata;

        // Process user's rough mask - resize to match image
        logger.info({ ...logContext, stage: "processing-mask" }, "Processing user mask...");
        const userMaskGray = await sharp(maskBuffer)
            .resize({ width, height, fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer();

        // Dilate/expand user's mask by ~30px to be generous with selection
        // This ensures we capture the full object even with rough painting
        logger.info({ ...logContext, stage: "dilating" }, "Expanding user selection...");
        const dilatedMask = await sharp(userMaskGray, { raw: { width, height, channels: 1 } })
            .blur(15)  // Blur expands the mask edges
            .normalize()  // Re-normalize to 0-255
            .raw()
            .toBuffer();

        // Threshold the dilated mask - anything > 10 becomes 255 (generous expansion)
        const expandedMask = Buffer.alloc(width * height);
        for (let i = 0; i < width * height; i++) {
            expandedMask[i] = dilatedMask[i] > 10 ? 255 : 0;
        }

        let finalAlpha;
        let resultBuffer;

        // Try to use Prodia for clean edges
        if (isBackgroundRemoverAvailable()) {
            logger.info({ ...logContext, stage: "prodia" }, "Running Prodia AI for clean edges...");

            try {
                // Run Prodia to get clean AI-detected edges
                const prodiaResult = await removeBackgroundFast(sourceImageUrl, requestId);

                // Extract alpha channel from Prodia result
                const prodiaRgba = await sharp(prodiaResult.imageBuffer)
                    .ensureAlpha()
                    .resize({ width, height, fit: 'fill' })
                    .raw()
                    .toBuffer();

                // Extract Prodia's alpha channel
                const prodiaAlpha = Buffer.alloc(width * height);
                for (let i = 0; i < width * height; i++) {
                    prodiaAlpha[i] = prodiaRgba[i * 4 + 3];  // Alpha is 4th channel
                }

                // INTERSECT: final = Prodia's clean edges AND user's expanded region
                // This keeps Prodia's precise edges but only in the area user highlighted
                logger.info({ ...logContext, stage: "intersecting" }, "Combining AI edges with user selection...");
                finalAlpha = Buffer.alloc(width * height);
                for (let i = 0; i < width * height; i++) {
                    // Keep pixel only if BOTH Prodia thinks it's foreground AND user selected this region
                    finalAlpha[i] = Math.min(prodiaAlpha[i], expandedMask[i]);
                }

                logger.info({ ...logContext, stage: "prodia-success" }, "Smart edge detection complete");

            } catch (prodiaError) {
                // Prodia failed - fall back to user's mask directly with some smoothing
                logger.warn(
                    { ...logContext, stage: "prodia-fallback" },
                    `Prodia failed, using direct mask: ${prodiaError.message}`
                );

                // Apply slight blur to user's mask for softer edges
                const smoothedMask = await sharp(userMaskGray, { raw: { width, height, channels: 1 } })
                    .blur(2)
                    .raw()
                    .toBuffer();
                finalAlpha = smoothedMask;
            }
        } else {
            // No Prodia available - use user's mask directly with smoothing
            logger.info({ ...logContext, stage: "no-prodia" }, "Prodia not available, using direct mask");
            const smoothedMask = await sharp(userMaskGray, { raw: { width, height, channels: 1 } })
                .blur(2)
                .raw()
                .toBuffer();
            finalAlpha = smoothedMask;
        }

        // Get original image as RGBA
        const imageRgba = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer();

        // Apply final alpha channel
        const outputBuffer = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const rgbaIdx = i * 4;
            outputBuffer[rgbaIdx] = imageRgba[rgbaIdx];         // R
            outputBuffer[rgbaIdx + 1] = imageRgba[rgbaIdx + 1]; // G
            outputBuffer[rgbaIdx + 2] = imageRgba[rgbaIdx + 2]; // B
            outputBuffer[rgbaIdx + 3] = finalAlpha[i];          // A from smart mask
        }

        // Create final PNG
        resultBuffer = await sharp(outputBuffer, {
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
        let finalAssetId = asset?.id;
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
            finalAssetId = asset.id;
        } else {
            const sourceImageId = extractImageId(sourceImageUrl) || `img-${Date.now()}`;
            const newAsset = await prisma.productAsset.create({
                data: {
                    shopId: shop.id,
                    productId,
                    sourceImageId,
                    sourceImageUrl,
                    preparedImageKey,
                    preparedImageUrl,
                    status: "ready",
                    prepStrategy: "manual",
                    promptVersion: 1,
                    createdAt: new Date(),
                },
            });
            finalAssetId = newAsset.id;
        }

        // Emit manual_cutout_applied event
        if (finalAssetId) {
            await emitPrepEvent(
                {
                    assetId: finalAssetId,
                    productId: productId,
                    shopId: shop.id,
                    eventType: "manual_cutout_applied",
                    actorType: "merchant",
                    payload: {
                        source: "manual",
                        preparedImageKey,
                        processingTimeMs,
                    },
                },
                session,
                requestId
            ).catch(() => {
                // Non-critical
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

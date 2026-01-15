import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { removeBackgroundFast, isBackgroundRemoverAvailable } from "../services/background-remover.server";
import { emitPrepEvent } from "../services/prep-events.server";
import sharp from "sharp";

const MAX_EDIT_EDGE_PX = 4096;

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
        const editPreparedRaw = formData.get("editPrepared")?.toString();

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

        // Emit manual_cutout_started event (best-effort; must not break flow)
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

        const wantsEditPrepared =
            editPreparedRaw === "true" || editPreparedRaw === "1" || editPreparedRaw === "yes";

        // If the client is editing an already-prepared PNG, prefer the stored GCS key.
        // This avoids failures from stale signed URLs and ensures we always fetch the latest prepared asset.
        let sourceImageUrl = customImageUrl || asset?.sourceImageUrl;
        if (wantsEditPrepared) {
            if (asset?.preparedImageKey) {
                sourceImageUrl = await StorageService.getSignedReadUrl(asset.preparedImageKey, 60 * 60 * 1000);
            } else if (asset?.preparedImageUrl) {
                sourceImageUrl = asset.preparedImageUrl;
            }
        }

        if (!sourceImageUrl) {
            return json({ success: false, error: "Product asset not found" }, { status: 404 });
        }

        const startTime = Date.now();

        // Download source image with timeout
        logger.info({ ...logContext, stage: "downloading" }, "Downloading source image...");
        
        let imageBuffer;
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
        
        try {
            const imageResponse = await fetch(sourceImageUrl, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!imageResponse.ok) {
                throw new Error(`Failed to download source image: ${imageResponse.status} ${imageResponse.statusText}`);
            }
            imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                throw new Error('Image download timed out after 20 seconds. The image URL may be invalid or the server is slow.');
            }
            throw new Error(`Failed to download source image: ${fetchError.message}`);
        }

        // Parse mask from data URL
        const maskBase64 = maskDataUrl.split(',')[1];
        if (!maskBase64) {
            return json({ success: false, error: "Invalid mask data URL format" }, { status: 400 });
        }
        const maskBuffer = Buffer.from(maskBase64, 'base64');

        // Get image dimensions
        const imageMetadata = await sharp(imageBuffer).metadata();
        const srcWidth = imageMetadata.width || 0;
        const srcHeight = imageMetadata.height || 0;
        if (!srcWidth || !srcHeight) {
            return json({ success: false, error: "Unsupported image format. Please try a different image." }, { status: 400 });
        }

        // Cap extremely large images to avoid memory/time blowups.
        let width = srcWidth;
        let height = srcHeight;
        const maxEdge = Math.max(srcWidth, srcHeight);
        if (maxEdge > MAX_EDIT_EDGE_PX) {
            const scale = MAX_EDIT_EDGE_PX / maxEdge;
            width = Math.max(1, Math.round(srcWidth * scale));
            height = Math.max(1, Math.round(srcHeight * scale));
            logger.info(
                { ...logContext, stage: "downscale" },
                `Downscaling source image for edit: ${srcWidth}×${srcHeight} → ${width}×${height}`
            );
        }

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

        // When editing a prepared image (already transparent), we treat the mask as a "keep" mask and
        // apply it on top of the existing alpha so transparency is preserved (no background reappears).
        const isEditingPreparedImage = wantsEditPrepared;
        
        if (isEditingPreparedImage) {
            // Fast path: editing prepared image - skip Prodia, use user's mask directly
            logger.info({ ...logContext, stage: "fast-path" }, "Editing prepared image - skipping Prodia for speed");
            const smoothedMask = await sharp(userMaskGray, { raw: { width, height, channels: 1 } })
                .blur(2)
                .raw()
                .toBuffer();
            finalAlpha = smoothedMask;
        } else if (isBackgroundRemoverAvailable()) {
            // Full path: editing original image - use Prodia for clean edges
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

        // Get original image as RGBA (resize if needed)
        const imageRgba = await sharp(imageBuffer)
            .ensureAlpha()
            .resize({ width, height, fit: "fill" })
            .raw()
            .toBuffer();

        // Apply final alpha channel
        const outputBuffer = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const rgbaIdx = i * 4;
            outputBuffer[rgbaIdx] = imageRgba[rgbaIdx];         // R
            outputBuffer[rgbaIdx + 1] = imageRgba[rgbaIdx + 1]; // G
            outputBuffer[rgbaIdx + 2] = imageRgba[rgbaIdx + 2]; // B
            if (isEditingPreparedImage) {
                // Preserve existing transparency by combining alphas (multiply in 0..255 space)
                const existingA = imageRgba[rgbaIdx + 3];
                const maskA = finalAlpha[i];
                outputBuffer[rgbaIdx + 3] = Math.round((existingA * maskA) / 255);
            } else {
                outputBuffer[rgbaIdx + 3] = finalAlpha[i]; // A from smart mask (keep-mask)
            }
        }

        // Create final PNG
        resultBuffer = await sharp(outputBuffer, {
            raw: { width, height, channels: 4 }
        })
            .png()
            .toBuffer();

        // CRITICAL: Trim transparent padding so sizing is based on visible product content.
        // Without this, a user-selected cutout (e.g. mirror) can occupy only a small area
        // inside a full-size source image canvas, causing the product to appear too small
        // during placement and in final renders.
        try {
            const beforeMeta = await sharp(resultBuffer).metadata();
            const trimmed = await sharp(resultBuffer)
                .trim() // removes fully-transparent edges (top-left is transparent)
                .png()
                .toBuffer();
            const afterMeta = await sharp(trimmed).metadata();

            if (afterMeta.width && afterMeta.height && beforeMeta.width && beforeMeta.height) {
                // Only accept the trimmed result if it is valid and smaller (or equal) dimensions.
                if (afterMeta.width <= beforeMeta.width && afterMeta.height <= beforeMeta.height && trimmed.length > 0) {
                    resultBuffer = trimmed;
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
            // If this product is already enabled/live, do not regress it back to "ready"
            const nextStatus = asset.enabled || asset.status === "live" ? "live" : "ready";
            await prisma.productAsset.update({
                where: { id: asset.id },
                data: {
                    preparedImageKey,
                    preparedImageUrl,
                    status: nextStatus,
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

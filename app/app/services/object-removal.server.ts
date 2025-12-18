/**
 * Object Removal Service - Mask-Driven Inpainting
 *
 * WHAT THIS IS:
 * - Mask-driven object removal via inpainting
 * - User mask is the absolute source of truth
 * - Speed first, quality second
 *
 * WHAT THIS IS NOT:
 * - Background removal
 * - Scene segmentation
 * - Auto object detection
 *
 * PERFORMANCE TARGETS:
 * - First visual result: ≤800ms average
 * - P95: ≤1.5 seconds
 * - Absolute max: 3 seconds
 */

import sharp from "sharp";
import { logger, createLogContext } from "../utils/logger.server";

const PRODIA_API_URL = "https://inference.prodia.com/v2/job";

// Configuration
const CONFIG = {
    // Mask processing
    MASK_EXPANSION_PX: 12,      // Expand mask by this many pixels
    MASK_FEATHER_SIGMA: 4,      // Gaussian blur sigma for feathering
    MASK_THRESHOLD: 128,        // Threshold for binary mask (0-255)

    // Prodia settings
    INPAINT_STEPS: 4,           // Schnell optimized for 2-4 steps
    INPAINT_PROMPT: "clean empty background, seamless natural fill, match surrounding textures",

    // Limits
    MAX_IMAGE_DIMENSION: 2048,  // Resize if larger
    MIN_MASK_COVERAGE: 0.001,   // 0.1% minimum mask coverage
    MAX_MASK_COVERAGE: 0.8,     // 80% maximum - something's wrong if more
};

export interface ObjectRemovalResult {
    imageBuffer: Buffer;
    processingTimeMs: number;
    maskCoveragePercent: number;
    imageDimensions: { width: number; height: number };
}

export interface ObjectRemovalInput {
    imageBuffer: Buffer;
    maskBuffer: Buffer;
    requestId?: string;
    options?: {
        expansionPx?: number;
        featherSigma?: number;
    };
}

/**
 * Process mask: expand, feather, and ensure correct dimensions
 */
async function processMask(
    maskBuffer: Buffer,
    targetWidth: number,
    targetHeight: number,
    options: { expansionPx: number; featherSigma: number },
    logContext: ReturnType<typeof createLogContext>
): Promise<{ processedMask: Buffer; coveragePercent: number }> {
    const { expansionPx, featherSigma } = options;

    logger.info(
        { ...logContext, stage: "mask-process-start" },
        `Processing mask: target ${targetWidth}x${targetHeight}, expand=${expansionPx}px, feather=${featherSigma}`
    );

    // Get mask metadata
    const maskMeta = await sharp(maskBuffer).metadata();
    logger.info(
        { ...logContext, stage: "mask-metadata" },
        `Input mask: ${maskMeta.width}x${maskMeta.height}, channels=${maskMeta.channels}, format=${maskMeta.format}`
    );

    // Step 1: Resize mask to match image dimensions if needed
    let processedMask = sharp(maskBuffer);

    if (maskMeta.width !== targetWidth || maskMeta.height !== targetHeight) {
        logger.info(
            { ...logContext, stage: "mask-resize" },
            `Resizing mask from ${maskMeta.width}x${maskMeta.height} to ${targetWidth}x${targetHeight}`
        );
        processedMask = processedMask.resize(targetWidth, targetHeight, {
            fit: 'fill',
            kernel: 'nearest'  // Preserve hard edges during resize
        });
    }

    // Step 2: Convert to grayscale and extract single channel
    processedMask = processedMask
        .grayscale()
        .removeAlpha();

    // Step 3: Threshold to binary (ensure pure black/white)
    // This handles any color artifacts from the mask
    processedMask = processedMask
        .threshold(CONFIG.MASK_THRESHOLD);

    // Step 4: Expand mask (dilate) using blur + threshold trick
    // Blur expands white regions, then threshold snaps back to binary
    if (expansionPx > 0) {
        const dilateBlur = Math.max(1, Math.round(expansionPx * 0.7));
        processedMask = processedMask
            .blur(dilateBlur)
            .threshold(64);  // Lower threshold = more expansion
    }

    // Step 5: Feather edges with Gaussian blur
    if (featherSigma > 0) {
        processedMask = processedMask.blur(featherSigma);
    }

    // Get the final mask buffer
    const finalMaskBuffer = await processedMask
        .png()
        .toBuffer();

    // Calculate mask coverage
    const rawData = await sharp(finalMaskBuffer)
        .raw()
        .toBuffer({ resolveWithObject: true });

    let whitePixels = 0;
    const totalPixels = rawData.info.width * rawData.info.height;

    for (let i = 0; i < rawData.data.length; i++) {
        if (rawData.data[i] > 128) whitePixels++;
    }

    const coveragePercent = (whitePixels / totalPixels) * 100;

    logger.info(
        { ...logContext, stage: "mask-process-complete" },
        `Mask processed: coverage=${coveragePercent.toFixed(2)}%, white=${whitePixels}/${totalPixels}`
    );

    return { processedMask: finalMaskBuffer, coveragePercent };
}

/**
 * Call Prodia API for inpainting
 */
async function callProdiaInpaint(
    imageBuffer: Buffer,
    maskBuffer: Buffer,
    logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
    const apiToken = process.env.PRODIA_API_TOKEN;
    if (!apiToken) {
        throw new Error("PRODIA_API_TOKEN environment variable is not set");
    }

    // Build multipart form data
    const boundary = `----ProdiaInpaint${Date.now()}`;

    const jobConfig = JSON.stringify({
        type: "inference.flux.schnell.inpainting.v2",
        config: {
            prompt: CONFIG.INPAINT_PROMPT,
            steps: CONFIG.INPAINT_STEPS,
        }
    });

    // Construct multipart body
    const parts: Buffer[] = [];

    // Job config part
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="job"; filename="job.json"\r\n` +
        `Content-Type: application/json\r\n\r\n`
    ));
    parts.push(Buffer.from(jobConfig));
    parts.push(Buffer.from('\r\n'));

    // Image input part
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="input"; filename="image.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
    ));
    parts.push(imageBuffer);
    parts.push(Buffer.from('\r\n'));

    // Mask input part
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="input"; filename="mask.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
    ));
    parts.push(maskBuffer);
    parts.push(Buffer.from('\r\n'));

    // End boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    logger.info(
        { ...logContext, stage: "prodia-call" },
        `Calling Prodia API (body: ${body.length} bytes, model: flux.schnell.inpainting.v2)`
    );

    const response = await fetch(PRODIA_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Accept": "image/png",
        },
        body,
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error(
            { ...logContext, stage: "prodia-error" },
            `Prodia API error: ${response.status} - ${errorText}`
        );
        throw new Error(`Prodia API error: ${response.status} - ${errorText}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

/**
 * Remove objects from an image using mask-driven inpainting
 *
 * @param input.imageBuffer - Source image buffer
 * @param input.maskBuffer - Mask buffer (white = areas to remove)
 * @param input.requestId - For logging/tracking
 * @param input.options - Optional mask processing parameters
 */
export async function removeObjects(input: ObjectRemovalInput): Promise<ObjectRemovalResult> {
    const {
        imageBuffer,
        maskBuffer,
        requestId = "object-removal",
        options = {}
    } = input;

    const logContext = createLogContext("cleanup", requestId, "object-removal-start", {});
    const startTime = Date.now();

    const expansionPx = options.expansionPx ?? CONFIG.MASK_EXPANSION_PX;
    const featherSigma = options.featherSigma ?? CONFIG.MASK_FEATHER_SIGMA;

    logger.info(
        logContext,
        `Starting object removal (image: ${imageBuffer.length} bytes, mask: ${maskBuffer.length} bytes)`
    );

    try {
        // Step 1: Get image dimensions and prepare image
        const imageMeta = await sharp(imageBuffer).metadata();
        let width = imageMeta.width!;
        let height = imageMeta.height!;

        logger.info(
            { ...logContext, stage: "image-metadata" },
            `Source image: ${width}x${height}, format=${imageMeta.format}`
        );

        // Resize if too large
        let preparedImage = imageBuffer;
        if (width > CONFIG.MAX_IMAGE_DIMENSION || height > CONFIG.MAX_IMAGE_DIMENSION) {
            logger.info(
                { ...logContext, stage: "image-resize" },
                `Resizing image from ${width}x${height} to fit ${CONFIG.MAX_IMAGE_DIMENSION}px`
            );

            const resized = await sharp(imageBuffer)
                .resize(CONFIG.MAX_IMAGE_DIMENSION, CONFIG.MAX_IMAGE_DIMENSION, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .png()
                .toBuffer({ resolveWithObject: true });

            preparedImage = resized.data;
            width = resized.info.width;
            height = resized.info.height;
        } else {
            // Ensure PNG format
            preparedImage = await sharp(imageBuffer).png().toBuffer();
        }

        // Step 2: Process mask (resize, expand, feather)
        const { processedMask, coveragePercent } = await processMask(
            maskBuffer,
            width,
            height,
            { expansionPx, featherSigma },
            logContext
        );

        // Validate mask coverage
        if (coveragePercent < CONFIG.MIN_MASK_COVERAGE) {
            logger.warn(
                { ...logContext, stage: "mask-validation" },
                `Mask coverage too low: ${coveragePercent.toFixed(2)}% < ${CONFIG.MIN_MASK_COVERAGE}%`
            );
            // Return original image if mask is essentially empty
            return {
                imageBuffer: preparedImage,
                processingTimeMs: Date.now() - startTime,
                maskCoveragePercent: coveragePercent,
                imageDimensions: { width, height }
            };
        }

        if (coveragePercent > CONFIG.MAX_MASK_COVERAGE) {
            logger.warn(
                { ...logContext, stage: "mask-validation" },
                `Mask coverage suspiciously high: ${coveragePercent.toFixed(2)}% > ${CONFIG.MAX_MASK_COVERAGE * 100}%`
            );
        }

        // Step 3: Call Prodia for inpainting
        const resultBuffer = await callProdiaInpaint(preparedImage, processedMask, logContext);

        const processingTimeMs = Date.now() - startTime;

        logger.info(
            { ...logContext, stage: "complete" },
            `Object removal complete: time=${processingTimeMs}ms, coverage=${coveragePercent.toFixed(2)}%, dimensions=${width}x${height}, output=${resultBuffer.length} bytes`
        );

        return {
            imageBuffer: resultBuffer,
            processingTimeMs,
            maskCoveragePercent: coveragePercent,
            imageDimensions: { width, height }
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            { ...logContext, stage: "error" },
            `Object removal failed: ${errorMessage}`,
            error
        );
        throw error;
    }
}

/**
 * Remove objects from image URL with mask data URL
 * Convenience wrapper that handles downloading/parsing
 */
export async function removeObjectsFromUrl(
    imageUrl: string,
    maskDataUrl: string,
    requestId: string = "object-removal"
): Promise<ObjectRemovalResult> {
    const logContext = createLogContext("cleanup", requestId, "object-removal-download", {});

    // Download source image
    logger.info(
        { ...logContext, stage: "download-image" },
        `Downloading image from: ${imageUrl.substring(0, 80)}...`
    );

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
        throw new Error(`Failed to download source image: ${imageResponse.status}`);
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Parse mask from data URL
    const maskMatch = maskDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
    if (!maskMatch) {
        throw new Error("Invalid mask data URL format - expected data:image/xxx;base64,xxx");
    }
    const maskBuffer = Buffer.from(maskMatch[1], 'base64');

    logger.info(
        { ...logContext, stage: "downloaded" },
        `Downloaded image: ${imageBuffer.length} bytes, parsed mask: ${maskBuffer.length} bytes`
    );

    return removeObjects({
        imageBuffer,
        maskBuffer,
        requestId
    });
}

/**
 * Check if object removal service is available
 */
export function isObjectRemovalAvailable(): boolean {
    return !!process.env.PRODIA_API_TOKEN;
}

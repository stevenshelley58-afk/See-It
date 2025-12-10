// Grounded SAM service - uses Replicate API for text-prompted segmentation
// This replaces @imgly/background-removal-node for more accurate product isolation

import Replicate from "replicate";
import sharp from "sharp";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * Validate that an image has actual content (not just transparent pixels).
 * Returns false if the image is mostly/entirely transparent.
 */
async function validateImageHasContent(
    imageBuffer: Buffer,
    logContext: ReturnType<typeof createLogContext>
): Promise<boolean> {
    try {
        const { data, info } = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const pixelCount = info.width * info.height;
        let opaquePixels = 0;

        // Count pixels that have some opacity (alpha > 10)
        // Data is in RGBA format, so every 4th byte is alpha
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 10) {
                opaquePixels++;
            }
        }

        const opaquePercentage = (opaquePixels / pixelCount) * 100;

        logger.info(
            { ...logContext, stage: "validate" },
            `Image validation: ${opaquePixels}/${pixelCount} opaque pixels (${opaquePercentage.toFixed(1)}%)`
        );

        // If less than 1% of pixels are opaque, consider it empty/failed
        if (opaquePercentage < 1) {
            logger.warn(
                { ...logContext, stage: "validate" },
                `Image appears empty/transparent (${opaquePercentage.toFixed(1)}% opaque)`
            );
            return false;
        }

        return true;
    } catch (error) {
        logger.warn(
            { ...logContext, stage: "validate" },
            "Failed to validate image content, assuming valid",
            error
        );
        return true; // Assume valid if we can't check
    }
}

/**
 * Clean up product title to create a better prompt for Grounded SAM.
 *
 * Strategy: Remove trailing numbers, SKUs, and common suffixes while
 * preserving the meaningful product description.
 *
 * Examples:
 *   "Mirror 2" -> "mirror"
 *   "Snowboard Pro 500" -> "snowboard pro"
 *   "Beautiful Wall Clock" -> "beautiful wall clock"
 *   "SKU-12345 Lamp" -> "lamp"
 */
export function extractObjectType(productTitle: string): string {
    let cleaned = productTitle
        .toLowerCase()
        .trim()
        // Remove common SKU patterns at start (SKU-123, PROD-456, etc.)
        .replace(/^[a-z]{2,4}[-_]?\d+\s*/i, '')
        // Remove trailing numbers (Mirror 2, Chair 3, etc.)
        .replace(/\s+\d+$/, '')
        // Remove common size/variant suffixes
        .replace(/\s+(small|medium|large|xl|xxl|xs|s|m|l)$/i, '')
        // Remove trailing parentheses content (Chair (Red), Mirror (Large))
        .replace(/\s*\([^)]*\)\s*$/, '')
        // Remove extra whitespace
        .replace(/\s+/g, ' ')
        .trim();

    // If we stripped everything, fall back to original
    if (!cleaned || cleaned.length < 2) {
        cleaned = productTitle.toLowerCase().trim();
    }

    return cleaned;
}

// Lazy initialize Replicate client
let replicate: Replicate | null = null;

function getReplicateClient(): Replicate {
    if (!replicate) {
        if (!process.env.REPLICATE_API_TOKEN) {
            throw new Error('REPLICATE_API_TOKEN environment variable is not set');
        }
        replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
        });
        logger.info(
            createLogContext("system", "init", "replicate-client", {}),
            "Replicate client initialized"
        );
    }
    return replicate;
}

export interface GroundedSamResult {
    /** Base64 encoded PNG with transparent background */
    imageBase64: string;
    /** Detected bounding boxes for the prompt */
    boundingBoxes?: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * Use Grounded SAM to segment a specific object from an image based on text prompt
 *
 * @param imageUrl - URL of the source image (must be publicly accessible)
 * @param prompt - Text description of what to segment (e.g., "Mirror", "Snowboard")
 * @param requestId - Request ID for logging
 * @returns Base64 encoded PNG with the segmented object on transparent background
 */
export async function segmentWithGroundedSam(
    imageUrl: string,
    prompt: string,
    requestId: string = "grounded-sam"
): Promise<GroundedSamResult> {
    const logContext = createLogContext("segment", requestId, "start", { prompt });

    logger.info(logContext, `Starting Grounded SAM segmentation with prompt: "${prompt}"`);

    const client = getReplicateClient();

    try {
        // Call Grounded SAM on Replicate
        // Model: schananas/grounded_sam
        // This model combines GroundingDINO (text -> bounding box) + SAM (bounding box -> mask)
        const output = await client.run(
            "schananas/grounded_sam:ee871c19efb1941f55f66a3f2ef7a6b8fcd7a0721eba89c85ce3de57c7e6b0b5",
            {
                input: {
                    image: imageUrl,
                    prompt: prompt,
                    // Use high thresholds for precise detection
                    box_threshold: 0.25,
                    text_threshold: 0.25,
                    // Return the masked image (product on transparent background)
                    output_format: "png",
                }
            }
        );

        logger.info(
            { ...logContext, stage: "api-complete" },
            `Grounded SAM API call completed`
        );

        // The output structure from grounded_sam can vary
        // It typically returns an object with 'output_image' or similar
        let outputUrl: string | null = null;

        if (typeof output === 'string') {
            // Direct URL string
            outputUrl = output;
        } else if (Array.isArray(output) && output.length > 0) {
            // Array of URLs - take the first one (usually the masked output)
            outputUrl = output[0];
        } else if (output && typeof output === 'object') {
            // Object with output_image or similar field
            const outputObj = output as Record<string, unknown>;
            outputUrl = (outputObj.output_image || outputObj.image || outputObj.result) as string;
        }

        if (!outputUrl) {
            logger.error(
                { ...logContext, stage: "parse-error" },
                `Unexpected output format from Grounded SAM`,
                { output }
            );
            throw new Error("No output image returned from Grounded SAM");
        }

        logger.info(
            { ...logContext, stage: "download" },
            `Downloading segmented image from: ${outputUrl.substring(0, 80)}...`
        );

        // Download the output image and convert to base64
        const response = await fetch(outputUrl);
        if (!response.ok) {
            throw new Error(`Failed to download segmented image: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);

        // Validate the image has actual content (not just transparent)
        const isValid = await validateImageHasContent(imageBuffer, logContext);
        if (!isValid) {
            throw new Error("Grounded SAM returned an empty/transparent image - object not detected");
        }

        const imageBase64 = imageBuffer.toString('base64');

        logger.info(
            { ...logContext, stage: "complete" },
            `Grounded SAM segmentation completed, output size: ${arrayBuffer.byteLength} bytes`
        );

        return {
            imageBase64,
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        logger.error(
            { ...logContext, stage: "error" },
            `Grounded SAM segmentation failed: ${errorMessage}`,
            error
        );

        throw error;
    }
}

/**
 * Check if Grounded SAM is available (API token configured)
 */
export function isGroundedSamAvailable(): boolean {
    return !!process.env.REPLICATE_API_TOKEN;
}

/**
 * Use SAM to segment an object at a specific point (click coordinates)
 *
 * @param imageUrl - URL of the source image (must be publicly accessible)
 * @param clickX - X coordinate of the click (0-1 normalized)
 * @param clickY - Y coordinate of the click (0-1 normalized)
 * @param requestId - Request ID for logging
 * @returns Base64 encoded PNG with the segmented object on transparent background
 */
export async function segmentWithPointPrompt(
    imageUrl: string,
    clickX: number,
    clickY: number,
    requestId: string = "point-segment"
): Promise<GroundedSamResult> {
    const logContext = createLogContext("segment", requestId, "start", { clickX, clickY });

    logger.info(logContext, `Starting SAM point segmentation at (${clickX.toFixed(3)}, ${clickY.toFixed(3)})`);

    const client = getReplicateClient();

    try {
        // Download image to get dimensions for converting normalized coords to pixels
        const imgResponse = await fetch(imageUrl);
        const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
        const metadata = await sharp(imgBuffer).metadata();

        const pixelX = Math.round(clickX * (metadata.width || 1000));
        const pixelY = Math.round(clickY * (metadata.height || 1000));

        logger.info(
            { ...logContext, stage: "coords" },
            `Converted normalized (${clickX}, ${clickY}) to pixels (${pixelX}, ${pixelY}) for image ${metadata.width}x${metadata.height}`
        );

        // Use official Meta SAM 2 model with point prompt
        // Model: meta/sam-2 on Replicate
        const output = await client.run(
            "meta/sam-2",
            {
                input: {
                    image: imageUrl,
                    point_coords: [[pixelX, pixelY]], // Array of [x, y] points
                    point_labels: [1], // 1 = foreground point
                }
            }
        );

        logger.info(
            { ...logContext, stage: "api-complete" },
            `SAM point API call completed`
        );

        // SAM returns different output formats
        let maskUrl: string | null = null;
        let combinedUrl: string | null = null;

        if (Array.isArray(output)) {
            // Array format: [mask_url, combined_url] or just [url]
            if (output.length >= 2) {
                combinedUrl = output[1]; // Second is usually combined/cutout
            }
            maskUrl = output[0];
        } else if (output && typeof output === 'object') {
            const outputObj = output as Record<string, unknown>;
            maskUrl = (outputObj.mask || outputObj.masks) as string;
            combinedUrl = (outputObj.combined || outputObj.cutout || outputObj.output) as string;
        } else if (typeof output === 'string') {
            maskUrl = output;
        }

        // Prefer combined/cutout if available, otherwise we need to apply mask ourselves
        const outputUrl = combinedUrl || maskUrl;

        if (!outputUrl) {
            logger.error(
                { ...logContext, stage: "parse-error" },
                `Unexpected output format from SAM`,
                { output }
            );
            throw new Error("No output returned from SAM point segmentation");
        }

        logger.info(
            { ...logContext, stage: "download" },
            `Downloading segmented image from: ${outputUrl.substring(0, 80)}...`
        );

        // If we only got a mask, we need to apply it to the original image
        if (!combinedUrl && maskUrl) {
            // Download both mask and original, then composite
            const [maskResponse, originalResponse] = await Promise.all([
                fetch(maskUrl),
                fetch(imageUrl)
            ]);

            if (!maskResponse.ok || !originalResponse.ok) {
                throw new Error(`Failed to download images for compositing`);
            }

            const maskBuffer = Buffer.from(await maskResponse.arrayBuffer());
            const originalBuffer = Buffer.from(await originalResponse.arrayBuffer());

            // Apply mask to original image
            const result = await sharp(originalBuffer)
                .ensureAlpha()
                .composite([{
                    input: await sharp(maskBuffer)
                        .resize({ width: (await sharp(originalBuffer).metadata()).width })
                        .toBuffer(),
                    blend: 'dest-in'
                }])
                .png()
                .toBuffer();

            const isValid = await validateImageHasContent(result, logContext);
            if (!isValid) {
                throw new Error("SAM returned an empty mask - object not detected at click point");
            }

            logger.info(
                { ...logContext, stage: "complete" },
                `SAM point segmentation completed (with mask compositing), output size: ${result.length} bytes`
            );

            return {
                imageBase64: result.toString('base64'),
            };
        }

        // Direct download of combined/cutout image
        const response = await fetch(outputUrl);
        if (!response.ok) {
            throw new Error(`Failed to download segmented image: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);

        const isValid = await validateImageHasContent(imageBuffer, logContext);
        if (!isValid) {
            throw new Error("SAM returned an empty image - object not detected at click point");
        }

        const imageBase64 = imageBuffer.toString('base64');

        logger.info(
            { ...logContext, stage: "complete" },
            `SAM point segmentation completed, output size: ${arrayBuffer.byteLength} bytes`
        );

        return {
            imageBase64,
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        logger.error(
            { ...logContext, stage: "error" },
            `SAM point segmentation failed: ${errorMessage}`,
            error
        );

        throw error;
    }
}

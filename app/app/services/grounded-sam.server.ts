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
        // Full model ID with version hash from https://replicate.com/meta/sam-2/versions
        const output = await client.run(
            "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
            {
                input: {
                    image: imageUrl,
                    point_coords: `[${pixelX},${pixelY}]`, // String format: "[x,y]"
                    point_labels: "1", // 1 = foreground point
                }
            }
        );

        logger.info(
            { ...logContext, stage: "api-complete" },
            `SAM point API call completed`
        );

        // SAM 2 returns: { combined_mask: FileOutput, individual_masks: FileOutput[] }
        // FileOutput objects from Replicate SDK need to be converted to URL strings
        let maskUrl: string | null = null;

        // Helper to extract URL from FileOutput objects or strings
        const extractUrl = (value: unknown): string | null => {
            if (typeof value === 'string') {
                return value;
            }
            if (value && typeof value === 'object') {
                const obj = value as Record<string, unknown>;
                // FileOutput has .url() method or .href property
                if (typeof obj.url === 'function') {
                    const url = (obj.url as () => string)();
                    if (typeof url === 'string') return url;
                }
                if (typeof obj.href === 'string') {
                    return obj.href;
                }
                if (typeof obj.url === 'string') {
                    return obj.url;
                }
                // Try toString() which FileOutput implements
                const str = String(value);
                if (str && str.startsWith('http')) {
                    return str;
                }
            }
            return null;
        };

        // Log raw output for debugging
        logger.info(
            { ...logContext, stage: "parse-output" },
            `SAM raw output type: ${typeof output}, value: ${JSON.stringify(output).substring(0, 500)}`
        );

        if (output && typeof output === 'object' && !Array.isArray(output)) {
            const outputObj = output as Record<string, unknown>;
            logger.info(
                { ...logContext, stage: "parse-output" },
                `SAM output keys: ${JSON.stringify(Object.keys(outputObj))}`
            );

            // Log the actual types of the mask fields
            logger.info(
                { ...logContext, stage: "parse-output" },
                `combined_mask type: ${typeof outputObj.combined_mask}, constructor: ${outputObj.combined_mask?.constructor?.name}`
            );

            // SAM 2 specific output format - handle FileOutput objects
            if (outputObj.combined_mask) {
                maskUrl = extractUrl(outputObj.combined_mask);
                logger.info(
                    { ...logContext, stage: "parse-output" },
                    `Extracted from combined_mask: ${maskUrl?.substring(0, 100) || 'null'}`
                );
            }

            if (!maskUrl && outputObj.individual_masks && Array.isArray(outputObj.individual_masks) && outputObj.individual_masks.length > 0) {
                maskUrl = extractUrl(outputObj.individual_masks[0]);
                logger.info(
                    { ...logContext, stage: "parse-output" },
                    `Extracted from individual_masks[0]: ${maskUrl?.substring(0, 100) || 'null'}`
                );
            }

            // Fallback for other possible field names
            if (!maskUrl) {
                const possibleFields = ['mask', 'masks', 'output', 'image', 'segmentation'];
                for (const field of possibleFields) {
                    const value = outputObj[field];
                    maskUrl = extractUrl(value);
                    if (maskUrl) {
                        logger.info(
                            { ...logContext, stage: "parse-output" },
                            `Extracted from ${field}: ${maskUrl.substring(0, 100)}`
                        );
                        break;
                    }
                    if (Array.isArray(value) && value.length > 0) {
                        maskUrl = extractUrl(value[0]);
                        if (maskUrl) {
                            logger.info(
                                { ...logContext, stage: "parse-output" },
                                `Extracted from ${field}[0]: ${maskUrl.substring(0, 100)}`
                            );
                            break;
                        }
                    }
                }
            }
        } else if (Array.isArray(output) && output.length > 0) {
            maskUrl = extractUrl(output[0]);
        } else {
            maskUrl = extractUrl(output);
        }

        if (!maskUrl || typeof maskUrl !== 'string') {
            logger.error(
                { ...logContext, stage: "parse-error" },
                `Could not extract mask URL from SAM output`,
                { output: JSON.stringify(output), maskUrlType: typeof maskUrl }
            );
            throw new Error("No valid mask URL returned from SAM point segmentation");
        }

        logger.info(
            { ...logContext, stage: "download" },
            `Downloading mask from: ${maskUrl.substring(0, 100)}...`
        );

        // SAM 2 returns masks (white = object, black = background)
        // We need to apply the mask to the original image to get transparent background
        const [maskResponse] = await Promise.all([
            fetch(maskUrl),
        ]);

        if (!maskResponse.ok) {
            throw new Error(`Failed to download mask: ${maskResponse.status}`);
        }

        const maskBuffer = Buffer.from(await maskResponse.arrayBuffer());

        // Convert SAM grayscale mask to alpha channel
        // SAM mask: white (255) = object to keep, black (0) = background to remove
        const maskImage = sharp(maskBuffer).resize({
            width: metadata.width,
            height: metadata.height,
            fit: 'fill'
        });

        // Extract grayscale values to use as alpha
        const grayscaleMask = await maskImage
            .grayscale()
            .raw()
            .toBuffer();

        // Get original image as raw RGBA
        const originalRgba = await sharp(imgBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer();

        const width = metadata.width!;
        const height = metadata.height!;

        // Apply mask as alpha channel
        const resultBuffer = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            resultBuffer[i * 4] = originalRgba[i * 4];         // R
            resultBuffer[i * 4 + 1] = originalRgba[i * 4 + 1]; // G
            resultBuffer[i * 4 + 2] = originalRgba[i * 4 + 2]; // B
            resultBuffer[i * 4 + 3] = grayscaleMask[i];        // A from mask
        }

        const result = await sharp(resultBuffer, {
            raw: {
                width,
                height,
                channels: 4
            }
        })
            .png()
            .toBuffer();

        logger.info(
            { ...logContext, stage: "mask-applied" },
            `Applied mask to image: ${width}x${height}, result size: ${result.length} bytes`
        );

        const isValid = await validateImageHasContent(result, logContext);
        if (!isValid) {
            throw new Error("SAM returned an empty mask - object not detected at click point");
        }

        logger.info(
            { ...logContext, stage: "complete" },
            `SAM point segmentation completed, output size: ${result.length} bytes`
        );

        return {
            imageBase64: result.toString('base64'),
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

/**
 * Point with coordinates and label
 */
interface PointInput {
    x: number;  // 0-1 normalized
    y: number;  // 0-1 normalized
    label: number;  // 1 = include, 0 = exclude
}

/**
 * Get mask from SAM using multiple points (for preview).
 * Returns the raw mask buffer and original image buffer.
 */
export async function getMultiPointMask(
    imageUrl: string,
    points: PointInput[],
    requestId: string = "multi-point-mask"
): Promise<{ maskBuffer: Buffer; originalBuffer: Buffer; width: number; height: number }> {
    const logContext = createLogContext("segment", requestId, "multi-point-mask", {});

    logger.info(
        { ...logContext, stage: "start" },
        `Getting mask for ${points.length} points`
    );

    const client = getReplicateClient();

    // Download image to get dimensions
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) {
        throw new Error(`Failed to download image: ${imgResponse.status}`);
    }

    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const metadata = await sharp(imgBuffer).metadata();
    const width = metadata.width || 1000;
    const height = metadata.height || 1000;

    // Convert normalized coords to pixels
    const pointCoords = points.map(p => [
        Math.round(p.x * width),
        Math.round(p.y * height)
    ]);
    const pointLabels = points.map(p => p.label);

    logger.info(
        { ...logContext, stage: "coords" },
        `Points: ${JSON.stringify(pointCoords)}, Labels: ${JSON.stringify(pointLabels)}`
    );

    // Call SAM 2
    const output = await client.run(
        "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
        {
            input: {
                image: imageUrl,
                point_coords: JSON.stringify(pointCoords),
                point_labels: pointLabels.join(","),
            }
        }
    );

    logger.info(
        { ...logContext, stage: "api-complete" },
        `SAM API returned`
    );

    // Extract mask URL
    const maskUrl = extractMaskUrl(output, logContext);

    if (!maskUrl) {
        throw new Error("No mask returned from SAM");
    }

    // Download mask
    const maskResponse = await fetch(maskUrl);
    if (!maskResponse.ok) {
        throw new Error(`Failed to download mask: ${maskResponse.status}`);
    }

    const maskBuffer = Buffer.from(await maskResponse.arrayBuffer());

    return {
        maskBuffer,
        originalBuffer: imgBuffer,
        width,
        height,
    };
}

/**
 * Apply multi-point mask to create transparent PNG.
 */
export async function applyMultiPointMask(
    imageUrl: string,
    points: PointInput[],
    requestId: string = "apply-mask"
): Promise<GroundedSamResult> {
    const logContext = createLogContext("segment", requestId, "apply-mask", {});

    logger.info(
        { ...logContext, stage: "start" },
        `Applying mask for ${points.length} points`
    );

    const { maskBuffer, originalBuffer, width, height } = await getMultiPointMask(
        imageUrl,
        points,
        requestId
    );

    // Convert mask to alpha channel
    const grayscaleMask = await sharp(maskBuffer)
        .resize({ width, height, fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

    const originalRgba = await sharp(originalBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer();

    // Apply mask as alpha channel
    const resultBuffer = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        resultBuffer[i * 4] = originalRgba[i * 4];         // R
        resultBuffer[i * 4 + 1] = originalRgba[i * 4 + 1]; // G
        resultBuffer[i * 4 + 2] = originalRgba[i * 4 + 2]; // B
        resultBuffer[i * 4 + 3] = grayscaleMask[i];        // A from mask
    }

    const result = await sharp(resultBuffer, {
        raw: { width, height, channels: 4 }
    })
        .png()
        .toBuffer();

    logger.info(
        { ...logContext, stage: "complete" },
        `Mask applied, result size: ${result.length} bytes`
    );

    return {
        imageBase64: result.toString('base64'),
    };
}

/**
 * Helper to extract mask URL from SAM output (handles FileOutput objects)
 */
function extractMaskUrl(output: unknown, logContext: ReturnType<typeof createLogContext>): string | null {
    const extractUrl = (value: unknown): string | null => {
        if (typeof value === 'string') {
            return value;
        }
        if (value && typeof value === 'object') {
            const obj = value as Record<string, unknown>;
            if (typeof obj.url === 'function') {
                const url = (obj.url as () => string)();
                if (typeof url === 'string') return url;
            }
            if (typeof obj.href === 'string') return obj.href;
            if (typeof obj.url === 'string') return obj.url;
            const str = String(value);
            if (str && str.startsWith('http')) return str;
        }
        return null;
    };

    if (output && typeof output === 'object' && !Array.isArray(output)) {
        const outputObj = output as Record<string, unknown>;

        if (outputObj.combined_mask) {
            const url = extractUrl(outputObj.combined_mask);
            if (url) return url;
        }

        if (outputObj.individual_masks && Array.isArray(outputObj.individual_masks) && outputObj.individual_masks.length > 0) {
            const url = extractUrl(outputObj.individual_masks[0]);
            if (url) return url;
        }
    }

    if (Array.isArray(output) && output.length > 0) {
        return extractUrl(output[0]);
    }

    return extractUrl(output);
}

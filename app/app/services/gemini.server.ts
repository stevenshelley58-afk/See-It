// Gemini AI service - runs directly in Railway, no separate Cloud Run service
import { GoogleGenAI } from "@google/genai";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";
import { logger, createLogContext } from "../utils/logger.server";
import { validateShopifyUrl, validateTrustedUrl } from "../utils/validate-shopify-url.server";
import { segmentWithGroundedSam, isGroundedSamAvailable, extractObjectType } from "./grounded-sam.server";

// ============================================================================
// 🔒 LOCKED MODEL IMPORTS - DO NOT DEFINE MODEL NAMES HERE
// Import from the centralized config to prevent accidental changes.
// See: app/config/ai-models.config.ts
// ============================================================================
import {
    GEMINI_IMAGE_MODEL_PRO,
    GEMINI_IMAGE_MODEL_FAST
} from "~/config/ai-models.config";

// Alias for local use (keeps existing code working)
const IMAGE_MODEL_PRO = GEMINI_IMAGE_MODEL_PRO;
const IMAGE_MODEL_FAST = GEMINI_IMAGE_MODEL_FAST;

// Timeout configuration for Gemini API calls
const GEMINI_TIMEOUT_MS = 60000; // 60 seconds

// ============================================================================
// ASPECT RATIO NORMALIZATION (Gemini-compatible)
// ============================================================================
const GEMINI_SUPPORTED_RATIOS = [
    { label: '1:1', value: 1.0 },
    { label: '4:5', value: 0.8 },
    { label: '5:4', value: 1.25 },
    { label: '3:4', value: 0.75 },
    { label: '4:3', value: 4 / 3 },
    { label: '2:3', value: 2 / 3 },
    { label: '3:2', value: 1.5 },
    { label: '9:16', value: 9 / 16 },
    { label: '16:9', value: 16 / 9 },
    { label: '21:9', value: 21 / 9 },
];

function findClosestGeminiRatio(width: number, height: number): { label: string; value: number } {
    const inputRatio = width / height;
    let closest = GEMINI_SUPPORTED_RATIOS[0];
    let minDiff = Math.abs(inputRatio - closest.value);

    for (const r of GEMINI_SUPPORTED_RATIOS) {
        const diff = Math.abs(inputRatio - r.value);
        if (diff < minDiff) {
            minDiff = diff;
            closest = r;
        }
    }
    return closest;
}

// ============================================================================
// NARRATIVE PROMPT BUILDER
// Converts prose product description + placement into Gemini-optimized prompt
// ============================================================================

/**
 * Convert normalized coordinates to natural language position description
 */
function describePosition(placement: { x: number; y: number }): string {
    const { x, y } = placement;

    // Horizontal position
    const h =
        x < 0.2 ? 'on the far left' :
            x < 0.35 ? 'on the left side' :
                x > 0.8 ? 'on the far right' :
                    x > 0.65 ? 'on the right side' :
                        'centrally positioned';

    // Depth/vertical position (y in image correlates to depth in room photography)
    const v =
        y > 0.75 ? 'close to the camera in the foreground' :
            y > 0.55 ? 'in the foreground' :
                y < 0.25 ? 'deep in the background' :
                    y < 0.4 ? 'in the background' :
                        'at a comfortable middle distance';

    return `${h}, ${v}`;
}

/**
 * Build the narrative prompt for Gemini image compositing
 * 
 * This prompt describes the DESIRED OUTPUT as a photograph that already exists.
 * Per Google's Gemini documentation: "A narrative, descriptive paragraph will
 * almost always produce a better, more coherent image than a simple list."
 * 
 * Key insight: Describe the FINAL PHOTO, not the compositing process.
 */
function buildCompositePrompt(
    productDescription: string,
    placement: { x: number; y: number; scale?: number; productWidthFraction?: number }
): string {
    const position = describePosition(placement);

    // If no product description, use minimal fallback
    if (!productDescription) {
        return `A professionally photographed interior scene. The furniture piece from the reference image sits naturally ${position} within the room. Natural contact shadows anchor it to the surface. The ambient lighting wraps consistently around all objects in the frame. Shot with a wide-angle lens, sharp focus throughout, the kind of image you'd see in an interior design magazine.`;
    }

    // Build the full narrative prompt - written as if describing an existing photograph
    // No instructions, no technical language about compositing - just the final image
    return `A professionally photographed interior scene for a home furnishings catalogue.

${productDescription}

The piece sits ${position} in the room, grounded naturally on its surface with a soft contact shadow beneath. The room's existing ambient light wraps around the product consistently - highlights fall where expected, shadows have the same softness and direction as everything else in the frame. Any reflective or glossy surfaces pick up subtle hints of the surrounding environment.

The photograph has the polished, editorial quality of Architectural Digest or Elle Decor - technically perfect, naturally lit, effortlessly composed. A single cohesive image where every element belongs together.`;
}

/**
 * Error thrown when a Gemini API call times out
 */
export class GeminiTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Gemini API call timed out after ${timeoutMs}ms`);
        this.name = 'GeminiTimeoutError';
    }
}

/**
 * Wrap a promise with a timeout
 * @param promise The promise to wrap
 * @param timeoutMs Timeout in milliseconds
 * @param operation Description of the operation for error messages
 */
function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string = "operation"
): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new GeminiTimeoutError(timeoutMs));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    });
}

// Lazy initialize Gemini (prevents crash if API key missing at module load time)
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
    if (!ai) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        logger.info(
            createLogContext("system", "init", "gemini-client", {}),
            "Gemini client initialized"
        );
    }
    return ai;
}

// Use centralized GCS client
const storage = getGcsClient();

async function downloadToBuffer(
    url: string,
    logContext: ReturnType<typeof createLogContext>,
    maxDimension: number = 2048
): Promise<Buffer> {
    // Validate URL to prevent SSRF attacks
    // Allow both Shopify CDN (product images) and GCS (processed/room images)
    try {
        validateTrustedUrl(url, "image URL");
    } catch (error) {
        logger.error(
            { ...logContext, stage: "download" },
            "URL validation failed - must be from Shopify CDN or GCS",
            error
        );
        throw error;
    }

    logger.info(
        { ...logContext, stage: "download" },
        `Downloading image from trusted source: ${url.substring(0, 80)}...`
    );

    const response = await fetch(url);

    if (!response.ok) {
        const error = new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        logger.error(
            { ...logContext, stage: "download" },
            "Failed to download image from CDN",
            error
        );
        throw error;
    }

    try {
        // Use arrayBuffer() to avoid ReadableStream compatibility issues
        // between Node.js and Web Streams APIs
        const arrayBuffer = await response.arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);

        // Resize pipeline: Buffer -> Sharp (Resize) -> Buffer
        // IMPORTANT: .rotate() with no args auto-orients based on EXIF and removes the tag
        // This fixes rotation issues with phone photos that have EXIF orientation metadata
        const buffer = await sharp(inputBuffer)
            .rotate() // Auto-orient based on EXIF, then strip EXIF orientation tag
            .resize({
                width: maxDimension,
                height: maxDimension,
                fit: 'inside',
                withoutEnlargement: true
            })
            // Convert to PNG by default to standardize internal processing
            .png({ force: true })
            .toBuffer();

        logger.info(
            { ...logContext, stage: "download-optimize" },
            `Downloaded & Optimized: ${buffer.length} bytes (max ${maxDimension}px)`
        );

        return buffer;
    } catch (error) {
        logger.error(
            { ...logContext, stage: "download-error" },
            "Failed to process download stream",
            error
        );
        throw error;
    }
}

async function uploadToGCS(
    key: string,
    buffer: Buffer,
    contentType: string,
    logContext: ReturnType<typeof createLogContext>
): Promise<string> {
    logger.info(
        { ...logContext, stage: "upload" },
        `Uploading to GCS bucket ${GCS_BUCKET}, key: ${key}, size: ${buffer.length} bytes`
    );

    const bucket = storage.bucket(GCS_BUCKET);
    const file = bucket.file(key);

    try {
        await file.save(buffer, { contentType, resumable: false });

        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });

        logger.info(
            { ...logContext, stage: "upload" },
            `Upload successful, signed URL generated: ${signedUrl.substring(0, 80)}...`
        );

        return signedUrl;
    } catch (error) {
        logger.error(
            { ...logContext, stage: "upload" },
            `Failed to upload to GCS bucket ${GCS_BUCKET}, key: ${key}`,
            error
        );
        throw error;
    }
}

async function callGemini(
    prompt: string,
    imageBuffers: Buffer | Buffer[],
    options: { model?: string; aspectRatio?: string; logContext?: ReturnType<typeof createLogContext>; timeoutMs?: number } = {}
): Promise<string> {
    const { model = IMAGE_MODEL_FAST, aspectRatio, logContext, timeoutMs = GEMINI_TIMEOUT_MS } = options;
    const context = logContext || createLogContext("system", "api-call", "start", {});
    logger.info(context, `Calling Gemini model: ${model} (timeout: ${timeoutMs}ms)`);

    const parts: any[] = [{ text: prompt }];

    const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];
    for (const buffer of buffers) {
        if (buffer) {
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: buffer.toString('base64')
                }
            });
        }
    }

    // Per Gemini docs: include TEXT alongside IMAGE for better results
    const config: any = { responseModalities: ['TEXT', 'IMAGE'] };
    if (aspectRatio) {
        config.imageConfig = { aspectRatio };
    }

    const startTime = Date.now();

    try {
        const client = getGeminiClient();

        // Wrap the API call with a timeout to prevent indefinite hangs
        const response = await withTimeout(
            client.models.generateContent({
                model,
                contents: parts,
                config,
            }),
            timeoutMs,
            `Gemini ${model} API call`
        );

        const duration = Date.now() - startTime;
        logger.info(
            { ...context, stage: "api-complete" },
            `Gemini API call completed in ${duration}ms`
        );

        // Extract image from response
        const candidates = response.candidates;
        if (candidates?.[0]?.content?.parts) {
            for (const part of candidates[0].content.parts) {
                if (part.inlineData?.data) {
                    return part.inlineData.data;
                }
            }
        }

        // Try alternate structure
        if ((response as any).parts) {
            for (const part of (response as any).parts) {
                if (part.inlineData) {
                    return part.inlineData.data;
                }
            }
        }

        // Log response structure for debugging
        logger.error(
            { ...context, stage: "response-parse-failed" },
            `No image in Gemini response. Response structure: candidates=${!!candidates}, firstCandidate=${!!candidates?.[0]}, content=${!!candidates?.[0]?.content}, parts=${JSON.stringify(candidates?.[0]?.content?.parts?.map((p: any) => Object.keys(p)) || 'none')}`
        );
        throw new Error("No image in response - Gemini may have returned text only or blocked the request");
    } catch (error: any) {
        const duration = Date.now() - startTime;

        // Log timeout errors with extra context
        if (error instanceof GeminiTimeoutError) {
            logger.error(
                { ...context, stage: "timeout" },
                `Gemini API call timed out after ${duration}ms (limit: ${timeoutMs}ms)`,
                error
            );
        } else {
            logger.error(context, `Gemini error with ${model} after ${duration}ms`, error);
        }

        // Fallback to fast model if pro fails (except for timeouts - let them propagate)
        if (model === IMAGE_MODEL_PRO && !(error instanceof GeminiTimeoutError)) {
            logger.info(context, "Falling back to fast model");
            return callGemini(prompt, imageBuffers, { ...options, model: IMAGE_MODEL_FAST });
        }
        throw error;
    }
}

export async function prepareProduct(
    sourceImageUrl: string,
    shopId: string,
    productId: string,
    assetId: string,
    requestId: string = "background-processor",
    productTitle?: string // Optional product title for Grounded SAM text-prompted segmentation
): Promise<string> {
    const logContext = createLogContext("prepare", requestId, "start", {
        shopId,
        productId,
        assetId,
        productTitle: productTitle || "(not provided)",
    });

    logger.info(logContext, `Starting product preparation: productId=${productId}, title="${productTitle || 'N/A'}", sourceImageUrl=${sourceImageUrl.substring(0, 80)}...`);

    // Track buffers for explicit cleanup to prevent memory leaks
    let imageBuffer: Buffer | null = null;
    let pngBuffer: Buffer | null = null;
    let outputBuffer: Buffer | null = null;

    try {
        imageBuffer = await downloadToBuffer(sourceImageUrl, logContext);

        // Convert to PNG format - force PNG output even if input was WebP/AVIF
        // IMPORTANT: .rotate() with no args auto-orients based on EXIF and removes the tag
        // This fixes rotation issues with product images that have EXIF orientation metadata
        logger.info(
            { ...logContext, stage: "convert" },
            "Converting image to PNG format (with EXIF auto-orient)"
        );

        pngBuffer = await sharp(imageBuffer)
            .rotate() // Auto-orient based on EXIF, then strip EXIF orientation tag
            .png({ force: true })
            .toBuffer();

        logger.info(
            { ...logContext, stage: "convert" },
            `Converted to PNG: ${pngBuffer.length} bytes`
        );

        if (pngBuffer.length === 0) {
            const error = new Error('PNG conversion produced empty buffer');
            logger.error(
                { ...logContext, stage: "convert" },
                "PNG conversion failed: empty buffer",
                error
            );
            throw error;
        }

        // Extra visibility: log decoded metadata of the PNG we will send to @imgly
        try {
            const signature = pngBuffer.slice(0, 8).toString('hex');
            const meta = await sharp(pngBuffer).metadata();
            logger.debug(
                { ...logContext, stage: "convert" },
                `PNG metadata: signature=${signature}, format=${meta.format}, width=${meta.width}, height=${meta.height}, channels=${meta.channels}, hasAlpha=${meta.hasAlpha}`
            );
        } catch (metaErr) {
            logger.warn(
                { ...logContext, stage: "convert" },
                "Failed to read PNG metadata",
                metaErr
            );
        }

        // ============================================================================
        // BACKGROUND REMOVAL STRATEGY:
        // 1. If productTitle is provided AND Grounded SAM is available -> Use Grounded SAM
        //    (Text-prompted segmentation: "segment the Mirror" -> only the mirror is kept)
        // 2. Fallback to @imgly/background-removal-node (generic ML-based removal)
        // ============================================================================

        let lastError: unknown = null;
        let usedMethod: string = "none";

        // Strategy 1: Grounded SAM (text-prompted segmentation)
        if (productTitle && isGroundedSamAvailable()) {
            // Extract simplified object type from title for better detection
            // "Mirror 2" -> "mirror", "Luxury Snowboard Pro" -> "snowboard"
            const simplifiedPrompt = extractObjectType(productTitle);

            logger.info(
                { ...logContext, stage: "bg-remove-grounded-sam" },
                `Attempting Grounded SAM with prompt: "${simplifiedPrompt}" (from title: "${productTitle}")`
            );

            try {
                const result = await segmentWithGroundedSam(
                    sourceImageUrl, // Pass original URL - Replicate can fetch it directly
                    simplifiedPrompt,
                    requestId
                );

                // Convert base64 to buffer
                outputBuffer = Buffer.from(result.imageBase64, 'base64');
                usedMethod = "grounded-sam";

                logger.info(
                    { ...logContext, stage: "bg-remove-grounded-sam" },
                    `Grounded SAM succeeded, output size: ${outputBuffer.length} bytes`
                );
            } catch (groundedSamError) {
                lastError = groundedSamError;
                const errorMsg = groundedSamError instanceof Error ? groundedSamError.message : "Unknown error";
                logger.warn(
                    { ...logContext, stage: "bg-remove-grounded-sam-failed" },
                    `Grounded SAM failed, falling back to @imgly: ${errorMsg}`,
                    groundedSamError
                );
                // Continue to fallback
            }
        } else if (!productTitle) {
            logger.info(
                { ...logContext, stage: "bg-remove" },
                "No product title provided, using @imgly directly"
            );
        } else {
            logger.info(
                { ...logContext, stage: "bg-remove" },
                "Grounded SAM not available (REPLICATE_API_TOKEN not set), using @imgly"
            );
        }

        // Strategy 2: Fallback to @imgly/background-removal-node
        if (!outputBuffer) {
            logger.info(
                { ...logContext, stage: "bg-remove" },
                "Removing background with ML model (@imgly)"
            );

            // Hard limit: MAX 2 attempts (PNG, then JPEG fallback)
            // Do not extend this array without careful consideration of cost/performance
            const MAX_BG_REMOVAL_ATTEMPTS = 2;

            // Store reference to imageBuffer for JPEG fallback (captured before potential null)
            const originalImageBuffer = imageBuffer;

            const attempts: Array<{
                label: string;
                mimeType: 'image/png' | 'image/jpeg';
                getBuffer: () => Promise<Buffer>;
            }> = [
                    {
                        label: 'png',
                        mimeType: 'image/png',
                        getBuffer: async () => pngBuffer!
                    },
                    {
                        label: 'jpeg-fallback',
                        mimeType: 'image/jpeg',
                        getBuffer: async () => {
                            logger.info(
                                { ...logContext, stage: "bg-remove" },
                                "Fallback: converting to JPEG before background removal"
                            );
                            const jpegBuffer = await sharp(originalImageBuffer).jpeg({ quality: 95 }).toBuffer();
                            const meta = await sharp(jpegBuffer).metadata();
                            logger.debug(
                                { ...logContext, stage: "bg-remove" },
                                `JPEG fallback metadata: format=${meta.format}, width=${meta.width}, height=${meta.height}, channels=${meta.channels}, hasAlpha=${meta.hasAlpha}`
                            );
                            return jpegBuffer;
                        }
                    }
                ];

            // Enforce max attempts guard
            if (attempts.length > MAX_BG_REMOVAL_ATTEMPTS) {
                logger.error(
                    { ...logContext, stage: "bg-remove" },
                    `CONFIGURATION ERROR: Background removal attempts (${attempts.length}) exceeds maximum allowed (${MAX_BG_REMOVAL_ATTEMPTS})`
                );
                throw new Error(`Too many background removal attempts configured: ${attempts.length} > ${MAX_BG_REMOVAL_ATTEMPTS}`);
            }

            for (const attempt of attempts) {
                let attemptBuffer: Buffer | null = null;
                try {
                    attemptBuffer = await attempt.getBuffer();

                    logger.debug(
                        { ...logContext, stage: "bg-remove" },
                        `Attempting background removal with ${attempt.label}, mimeType: ${attempt.mimeType}`
                    );

                    // Convert Buffer to Blob - @imgly/background-removal-node expects web-standard Blob, not Node Buffer
                    const inputBlob = new Blob([attemptBuffer], { type: attempt.mimeType });

                    const resultBlob = await removeBackground(inputBlob, {
                        output: {
                            format: 'image/png',
                            quality: 1.0
                        }
                    });

                    // Clean up attempt buffer immediately after background removal
                    attemptBuffer = null;

                    const arrayBuffer = await resultBlob.arrayBuffer();
                    outputBuffer = Buffer.from(arrayBuffer);
                    usedMethod = "imgly";

                    logger.info(
                        { ...logContext, stage: "bg-remove" },
                        `Background removed successfully (${attempt.label}), output size: ${outputBuffer.length} bytes`
                    );
                    break;
                } catch (err) {
                    lastError = err;
                    // Clean up attempt buffer on error
                    attemptBuffer = null;
                    logger.warn(
                        { ...logContext, stage: "bg-remove" },
                        `Background removal failed on ${attempt.label}`,
                        err
                    );
                }
            }
        } // End of @imgly fallback block

        // Clean up input buffers after background removal - no longer needed
        imageBuffer = null;
        pngBuffer = null;

        if (!outputBuffer) {
            const error = lastError instanceof Error
                ? lastError
                : new Error('Background removal failed on all attempts');
            logger.error(
                { ...logContext, stage: "bg-remove" },
                "Background removal failed on all attempts",
                error
            );
            throw error;
        }

        logger.info(
            { ...logContext, stage: "bg-remove-complete" },
            `Background removal completed using method: ${usedMethod}`
        );

        // Guard: ensure output buffer is valid
        if (outputBuffer.length === 0) {
            const error = new Error("Background removal produced empty buffer");
            logger.error(
                { ...logContext, stage: "bg-remove" },
                "Empty output buffer after background removal",
                error
            );
            throw error;
        }

        const key = `products/${shopId}/${productId}/${assetId}_prepared.png`;
        const url = await uploadToGCS(key, outputBuffer, 'image/png', logContext);

        // Clean up output buffer after upload
        outputBuffer = null;

        logger.info(
            { ...logContext, stage: "complete" },
            `Product preparation completed successfully: ${url.substring(0, 80)}...`
        );

        return url;
    } catch (error: any) {
        logger.error(
            logContext,
            "prepareProduct failed",
            error
        );
        throw error;
    } finally {
        // Explicit cleanup in finally block to help garbage collector
        imageBuffer = null;
        pngBuffer = null;
        outputBuffer = null;
    }
}

export interface CompositeResult {
    imageUrl: string;
    imageKey: string;
}

export async function compositeScene(
    preparedProductImageUrl: string,
    roomImageUrl: string,
    placement: { x: number; y: number; scale: number; productWidthFraction?: number },
    stylePreset: string = 'neutral',
    requestId: string = "composite",
    productInstructions?: string
): Promise<CompositeResult> {
    const logContext = createLogContext("render", requestId, "start", {});
    logger.info(logContext, `Processing scene composite with Gemini${productInstructions ? ' (with custom instructions)' : ''}`);

    // Track buffers for explicit cleanup
    let productBuffer: Buffer | null = null;
    let roomBuffer: Buffer | null = null;
    let resizedProduct: Buffer | null = null;
    let guideImageBuffer: Buffer | null = null;
    let placementMaskBuffer: Buffer | null = null;
    let outputBuffer: Buffer | null = null;

    try {
        // PERFORMANCE: Download both images in parallel
        const [productResult, roomResult] = await Promise.all([
            downloadToBuffer(preparedProductImageUrl, logContext),
            downloadToBuffer(roomImageUrl, logContext)
        ]);
        productBuffer = productResult;
        roomBuffer = roomResult;

        // PERFORMANCE: Get both metadata in parallel
        const [roomMetadata, productMetadata] = await Promise.all([
            sharp(roomBuffer).metadata(),
            sharp(productBuffer).metadata()
        ]);

        if (!roomMetadata.width || !roomMetadata.height) {
            throw new Error("Room image is missing dimensions (metadata.width/height)");
        }
        if (!productMetadata.width || !productMetadata.height) {
            throw new Error("Product image is missing dimensions (metadata.width/height)");
        }

        const roomWidth = roomMetadata.width;
        const roomHeight = roomMetadata.height;
        const pixelX = Math.round(roomWidth * placement.x);
        const pixelY = Math.round(roomHeight * placement.y);

        // Two sizing modes (backwards-compatible):
        // - Legacy: placement.scale is a multiplier on product pixels (existing behavior)
        // - Preferred: placement.productWidthFraction maps UI size -> server pixels reliably
        const widthFromFraction =
            Number.isFinite(placement.productWidthFraction) && (placement.productWidthFraction as number) > 0
                ? Math.round(roomWidth * (placement.productWidthFraction as number))
                : null;

        const widthFromScale = Math.round(productMetadata.width * (placement.scale || 1));
        const targetWidth = widthFromFraction ?? widthFromScale;
        const clampedWidth = Math.max(32, Math.min(roomWidth * 2, targetWidth));

        // PERFORMANCE: Single pipeline for resize + get metadata
        const resizedResult = await sharp(productBuffer)
            .resize({ width: clampedWidth })
            .toBuffer({ resolveWithObject: true });

        resizedProduct = resizedResult.data;

        // Clean up original product buffer - no longer needed after resize
        productBuffer = null;

        // Use info from resize result instead of another metadata call
        const adjustedX = Math.max(0, pixelX - Math.round(resizedResult.info.width / 2));
        const adjustedY = Math.max(0, pixelY - Math.round(resizedResult.info.height / 2));

        // Create a placement mask from the product alpha channel (best quality when product has transparency).
        // This mask is used to constrain Gemini edits and to hard-lock pixels outside the edit region.
        // NOTE: Use 3 channels (RGB) then convert to grayscale - sharp 0.33+ doesn't support create with channels: 1
        const baseMask = await sharp({
            create: { width: roomWidth, height: roomHeight, channels: 3, background: { r: 0, g: 0, b: 0 } }
        })
            .grayscale()
            .png()
            .toBuffer();

        // Alpha mask (0..255) — if product has no transparency, this becomes a full rectangle (still safe).
        const productAlpha = await sharp(resizedProduct)
            .ensureAlpha()
            .extractChannel('alpha')
            .png()
            .toBuffer();

        // Place alpha mask into room-sized mask at the same position as the composite.
        placementMaskBuffer = await sharp(baseMask)
            .composite([{ input: productAlpha, top: adjustedY, left: adjustedX }])
            .png()
            .toBuffer();

        // Expand + feather slightly to allow contact shadow + edge blending without touching the rest of the room.
        const PLACEMENT_MASK_EXPANSION_PX = 24;
        const PLACEMENT_MASK_FEATHER_SIGMA = 10;
        const editRegionMask = await sharp(placementMaskBuffer)
            .grayscale()
            .removeAlpha()
            .threshold(1)
            .blur(Math.max(1, PLACEMENT_MASK_EXPANSION_PX * 0.7))
            .threshold(64)
            .blur(PLACEMENT_MASK_FEATHER_SIGMA)
            .png()
            .toBuffer();

        logger.info(
            { ...logContext, stage: "placement-mask" },
            `placementMask: expansion=${PLACEMENT_MASK_EXPANSION_PX}px, feather=${PLACEMENT_MASK_FEATHER_SIGMA}px`
        );

        // Guide image = hard composite (product pasted where user placed it), then Gemini polishes INSIDE mask.
        guideImageBuffer = await sharp(roomBuffer)
            .composite([{ input: resizedProduct, top: adjustedY, left: adjustedX }])
            .jpeg({ quality: 92 })
            .toBuffer();

        // Clean up intermediate buffers - no longer needed after composite/mask
        roomBuffer = null;
        resizedProduct = null;

        // Step 2: AI composite with narrative prompt
        // The productInstructions is now a PROSE DESCRIPTION written by AI during product prep
        // and approved by the merchant. It describes what the product looks like.
        const productDescription = productInstructions?.trim() || '';

        // Build the narrative prompt - describes the DESIRED OUTPUT, not instructions
        const prompt = buildCompositePrompt(productDescription, placement);

        // Compute closest Gemini-supported aspect ratio from actual room dimensions
        const closestRatio = findClosestGeminiRatio(roomWidth, roomHeight);

        // DIAGNOSTIC: Capture actual dimensions of both images before Gemini call
        // This helps identify the "Image to composite must have same dimensions or smaller" error
        const [guideMeta, maskMeta] = await Promise.all([
            sharp(guideImageBuffer).metadata(),
            sharp(editRegionMask).metadata()
        ]);

        logger.info(
            { ...logContext, stage: "pre-gemini-dimensions" },
            `DIMENSIONS CHECK: guideImage=${guideMeta.width}×${guideMeta.height}, mask=${maskMeta.width}×${maskMeta.height}, room=${roomWidth}×${roomHeight}, ratio=${closestRatio.label}`
        );

        // Validate dimensions match before sending to Gemini
        if (guideMeta.width !== maskMeta.width || guideMeta.height !== maskMeta.height) {
            logger.error(
                { ...logContext, stage: "dimension-mismatch" },
                `DIMENSION MISMATCH: guideImage=${guideMeta.width}×${guideMeta.height} vs mask=${maskMeta.width}×${maskMeta.height}. This will cause Gemini to fail!`
            );
            throw new Error(`Dimension mismatch: guideImage (${guideMeta.width}×${guideMeta.height}) != mask (${maskMeta.width}×${maskMeta.height})`);
        }

        const base64Data = await callGemini(prompt, [guideImageBuffer, editRegionMask], {
            model: IMAGE_MODEL_PRO,
            aspectRatio: closestRatio.label,
            logContext
        });

        outputBuffer = Buffer.from(base64Data, 'base64');

        // Handle dimension mismatch WITHOUT stretching. Ensure buffers match room size for pixel-locked compositing.
        const outputMeta = await sharp(outputBuffer).metadata();
        const outputWidth = outputMeta.width!;
        const outputHeight = outputMeta.height!;

        let resizedGeminiOutput: Buffer;
        if (outputWidth !== roomWidth || outputHeight !== roomHeight) {
            const outputRatio = outputWidth / outputHeight;
            const targetRatio = roomWidth / roomHeight;
            const ratioDiff = Math.abs(outputRatio - targetRatio);

            if (ratioDiff < 0.01) {
                resizedGeminiOutput = await sharp(outputBuffer)
                    .resize(roomWidth, roomHeight, { fit: 'fill' })
                    .png()
                    .toBuffer();
            } else {
                // Use fill (stretch) to maintain coordinate alignment with placement mask
                resizedGeminiOutput = await sharp(outputBuffer)
                    .resize(roomWidth, roomHeight, { fit: 'fill' })
                    .png()
                    .toBuffer();
            }
        } else {
            resizedGeminiOutput = outputBuffer;
        }

        // Composite lock: outside edit region, keep guide composite EXACTLY.
        // IMPORTANT: Use .extractChannel(0) to guarantee single-channel output for pixel blending
        const compositeMask = await sharp(editRegionMask)
            .resize(roomWidth, roomHeight, { fit: 'fill', kernel: 'nearest' })
            .grayscale()
            .extractChannel(0) // Ensure single channel for correct pixel indexing
            .toBuffer();

        const [baseRaw, gemRaw, maskRaw] = await Promise.all([
            sharp(guideImageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
            sharp(resizedGeminiOutput).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
            sharp(compositeMask).raw().toBuffer({ resolveWithObject: true })
        ]);

        const { data: baseData, info: baseInfo } = baseRaw;
        const { data: gemData } = gemRaw;
        const { data: maskData } = maskRaw;

        const resultData = Buffer.alloc(baseData.length);
        const pixelCount = baseInfo.width * baseInfo.height;
        for (let i = 0; i < pixelCount; i++) {
            const idx = i * 4;
            const alpha = maskData[i] / 255;
            const inv = 1 - alpha;

            resultData[idx] = Math.round(baseData[idx] * inv + gemData[idx] * alpha);
            resultData[idx + 1] = Math.round(baseData[idx + 1] * inv + gemData[idx + 1] * alpha);
            resultData[idx + 2] = Math.round(baseData[idx + 2] * inv + gemData[idx + 2] * alpha);
            resultData[idx + 3] = 255;
        }

        const lockedComposite = await sharp(resultData, {
            raw: { width: baseInfo.width, height: baseInfo.height, channels: 4 }
        })
            .jpeg({ quality: 92 })
            .toBuffer();

        // Clean up guide image buffer after lock composite
        guideImageBuffer = null;
        placementMaskBuffer = null;
        outputBuffer = null;

        const key = `composite/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const url = await uploadToGCS(key, lockedComposite, 'image/jpeg', logContext);

        return { imageUrl: url, imageKey: key };
    } finally {
        // Explicit cleanup in finally block to help garbage collector
        productBuffer = null;
        roomBuffer = null;
        resizedProduct = null;
        guideImageBuffer = null;
        placementMaskBuffer = null;
        outputBuffer = null;
    }
}


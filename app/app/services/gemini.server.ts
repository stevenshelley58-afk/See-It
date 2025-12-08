// Gemini AI service - runs directly in Railway, no separate Cloud Run service
import { GoogleGenAI } from "@google/genai";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";
import { logger, createLogContext } from "../utils/logger.server";
import { validateShopifyUrl, validateTrustedUrl } from "../utils/validate-shopify-url.server";

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

import { Readable } from 'stream';

// Helper to convert Web Stream to Node Stream if needed
function streamFromResponse(response: Response): Readable {
    if (response.body && typeof (response.body as any).getReader === 'function') {
        // Web Stream (standard fetch)
        // @ts-ignore - Readable.fromWeb exists in Node 18+
        return Readable.fromWeb(response.body as any);
    } else if (response.body && typeof (response.body as any).pipe === 'function') {
        // Node Stream (node-fetch)
        return response.body as any;
    }
    throw new Error("Response body is not a stream");
}

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

    // Stream resize pipeline: Response -> Sharp (Resize) -> Buffer
    // This avoids loading the full original image into memory
    try {
        const inputStream = streamFromResponse(response);
        const pipeline = sharp()
            .resize({
                width: maxDimension,
                height: maxDimension,
                fit: 'inside',
                withoutEnlargement: true
            })
            // Convert to PNG by default to standardize internal processing
            .png({ force: true });

        inputStream.pipe(pipeline);

        const buffer = await pipeline.toBuffer();

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

    const config: any = { responseModalities: ['IMAGE'] };
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

        throw new Error("No image in response");
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
    requestId: string = "background-processor"
): Promise<string> {
    const logContext = createLogContext("prepare", requestId, "start", {
        shopId,
        productId,
        assetId,
    });

    logger.info(logContext, `Starting product preparation: productId=${productId}, sourceImageUrl=${sourceImageUrl.substring(0, 80)}...`);

    // Track buffers for explicit cleanup to prevent memory leaks
    let imageBuffer: Buffer | null = null;
    let pngBuffer: Buffer | null = null;
    let outputBuffer: Buffer | null = null;

    try {
        imageBuffer = await downloadToBuffer(sourceImageUrl, logContext);

        // Convert to PNG format - force PNG output even if input was WebP/AVIF
        logger.info(
            { ...logContext, stage: "convert" },
            "Converting image to PNG format"
        );

        pngBuffer = await sharp(imageBuffer)
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

        // Use @imgly/background-removal-node for TRUE transparent background
        // Pass explicit mimeType so decoder knows it's PNG
        logger.info(
            { ...logContext, stage: "bg-remove" },
            "Removing background with ML model (@imgly)"
        );

        let lastError: unknown = null;

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

                const resultBlob = await removeBackground(attemptBuffer, {
                    // Not in types, but accepted by runtime
                    mimeType: attempt.mimeType,
                    output: {
                        format: 'image/png',
                        quality: 1.0
                    }
                } as any);

                // Clean up attempt buffer immediately after background removal
                attemptBuffer = null;

                const arrayBuffer = await resultBlob.arrayBuffer();
                outputBuffer = Buffer.from(arrayBuffer);

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

export async function cleanupRoom(
    roomImageUrl: string,
    maskDataUrl: string,
    requestId: string = "cleanup"
): Promise<string> {
    const logContext = createLogContext("cleanup", requestId, "start", {});
    logger.info(logContext, "Processing room cleanup with Gemini");

    // Track buffers for explicit cleanup
    let maskBuffer: Buffer | null = null;
    let roomBuffer: Buffer | null = null;
    let outputBuffer: Buffer | null = null;

    try {
        const maskBase64 = maskDataUrl.split(',')[1];
        maskBuffer = Buffer.from(maskBase64, 'base64');
        roomBuffer = await downloadToBuffer(roomImageUrl, logContext);

        const prompt = `Using the provided room image and mask image:
The white regions in the mask indicate objects to be removed.
Remove objects in the masked (white) areas and fill with appropriate background.
Match the surrounding context - floor, wall, or whatever is around the masked area.
Do NOT alter any pixels outside the masked region.
Maintain consistent lighting and perspective.
The result should look natural, as if nothing was ever there.`;

        const base64Data = await callGemini(prompt, [roomBuffer, maskBuffer], {
            model: IMAGE_MODEL_PRO,
            logContext
        });

        // Clean up input buffers after Gemini call
        roomBuffer = null;
        maskBuffer = null;

        outputBuffer = Buffer.from(base64Data, 'base64');
        const key = `cleaned/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const url = await uploadToGCS(key, outputBuffer, 'image/jpeg', logContext);

        // Clean up output buffer after upload
        outputBuffer = null;

        return url;
    } finally {
        // Explicit cleanup in finally block
        maskBuffer = null;
        roomBuffer = null;
        outputBuffer = null;
    }
}

export async function compositeScene(
    preparedProductImageUrl: string,
    roomImageUrl: string,
    placement: { x: number; y: number; scale: number },
    stylePreset: string = 'neutral',
    requestId: string = "composite"
): Promise<string> {
    const logContext = createLogContext("render", requestId, "start", {});
    logger.info(logContext, "Processing scene composite with Gemini");

    // Track buffers for explicit cleanup
    let productBuffer: Buffer | null = null;
    let roomBuffer: Buffer | null = null;
    let resizedProduct: Buffer | null = null;
    let guideImageBuffer: Buffer | null = null;
    let outputBuffer: Buffer | null = null;

    try {
        productBuffer = await downloadToBuffer(preparedProductImageUrl, logContext);
        roomBuffer = await downloadToBuffer(roomImageUrl, logContext);

        // Step 1: Mechanical placement with Sharp
        const roomMetadata = await sharp(roomBuffer).metadata();
        const roomWidth = roomMetadata.width || 1920;
        const roomHeight = roomMetadata.height || 1080;

        const pixelX = Math.round(roomWidth * placement.x);
        const pixelY = Math.round(roomHeight * placement.y);

        const productMetadata = await sharp(productBuffer).metadata();
        const newWidth = Math.round((productMetadata.width || 500) * placement.scale);

        resizedProduct = await sharp(productBuffer)
            .resize({ width: newWidth })
            .toBuffer();

        // Clean up original product buffer - no longer needed after resize
        productBuffer = null;

        const resizedMeta = await sharp(resizedProduct).metadata();
        const adjustedX = Math.max(0, pixelX - Math.round((resizedMeta.width || 0) / 2));
        const adjustedY = Math.max(0, pixelY - Math.round((resizedMeta.height || 0) / 2));

        guideImageBuffer = await sharp(roomBuffer)
            .composite([{ input: resizedProduct, top: adjustedY, left: adjustedX }])
            .toBuffer();

        // Clean up intermediate buffers - no longer needed after composite
        roomBuffer = null;
        resizedProduct = null;

        // Step 2: AI polish
        const styleDescription = stylePreset === 'neutral' ? 'natural and realistic' : stylePreset;
        const prompt = `This image shows a product placed into a room scene.
The product is already positioned - do NOT move, resize, reposition, or warp the product.
Make the composite look photorealistic by:
1. Harmonizing the lighting on the product to match the room's light sources
2. Adding appropriate shadows beneath and around the product
3. Adding subtle reflections if on a reflective surface
4. Ensuring color temperature consistency
Style: ${styleDescription}
Keep the product's exact position, size, and shape unchanged.`;

        const aspectRatio = roomWidth > roomHeight ? "16:9" : roomHeight > roomWidth ? "9:16" : "1:1";

        const base64Data = await callGemini(prompt, guideImageBuffer, {
            model: IMAGE_MODEL_PRO,
            aspectRatio,
            logContext
        });

        // Clean up guide image buffer after Gemini call
        guideImageBuffer = null;

        outputBuffer = Buffer.from(base64Data, 'base64');
        const key = `composite/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const url = await uploadToGCS(key, outputBuffer, 'image/jpeg', logContext);

        // Clean up output buffer after upload
        outputBuffer = null;

        return url;
    } finally {
        // Explicit cleanup in finally block to help garbage collector
        productBuffer = null;
        roomBuffer = null;
        resizedProduct = null;
        guideImageBuffer = null;
        outputBuffer = null;
    }
}


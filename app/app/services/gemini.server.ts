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
        const buffer = await sharp(inputBuffer)
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

/**
 * Compute bounding box of mask (white pixels)
 * Returns { x, y, width, height } or null if mask is empty
 */
async function computeMaskBbox(
    maskBuffer: Buffer,
    padding: number = 0.15,  // 15% padding
    minPadding: number = 50   // minimum 50px padding
): Promise<{ x: number; y: number; width: number; height: number; fullWidth: number; fullHeight: number } | null> {
    const { data, info } = await sharp(maskBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasWhite = false;

    // Scan for white pixels (alpha >= 16 or RGB > 200)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            // Check if pixel is "white" (high value in any channel)
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = channels === 4 ? data[idx + 3] : 255;
            
            if ((r > 200 || g > 200 || b > 200) && a > 16) {
                hasWhite = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!hasWhite) return null;

    // Calculate padding
    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const padX = Math.max(minPadding, Math.round(bboxWidth * padding));
    const padY = Math.max(minPadding, Math.round(bboxHeight * padding));

    // Apply padding with bounds checking
    const x = Math.max(0, minX - padX);
    const y = Math.max(0, minY - padY);
    const cropWidth = Math.min(width - x, bboxWidth + 2 * padX);
    const cropHeight = Math.min(height - y, bboxHeight + 2 * padY);

    return { x, y, width: cropWidth, height: cropHeight, fullWidth: width, fullHeight: height };
}

/**
 * Optimized room cleanup with bbox cropping for speed
 * 
 * Speed optimizations:
 * 1. Bbox cropping - only send masked region + padding (5-20x fewer pixels)
 * 2. 768px max for preview - faster processing
 * 3. JPEG input - smaller payload
 * 4. Short fixed prompt - less processing
 */
export async function cleanupRoom(
    roomImageUrl: string,
    maskDataUrl: string,
    requestId: string = "cleanup"
): Promise<string> {
    const logContext = createLogContext("cleanup", requestId, "start", {});
    const startTime = Date.now();
    
    logger.info(logContext, "Processing room cleanup with optimized Gemini Flash");

    let maskBuffer: Buffer | null = null;
    let roomBuffer: Buffer | null = null;
    let outputBuffer: Buffer | null = null;
    let croppedRoom: Buffer | null = null;
    let croppedMask: Buffer | null = null;

    try {
        // Parse mask from data URL
        const maskBase64 = maskDataUrl.split(',')[1];
        maskBuffer = Buffer.from(maskBase64, 'base64');
        
        // Download room image (already resized to 2048 max by downloadToBuffer)
        roomBuffer = await downloadToBuffer(roomImageUrl, logContext, 2048);

        // Get room dimensions
        const roomMeta = await sharp(roomBuffer).metadata();
        const roomWidth = roomMeta.width!;
        const roomHeight = roomMeta.height!;

        // Resize mask to match room dimensions
        maskBuffer = await sharp(maskBuffer)
            .resize(roomWidth, roomHeight, { fit: 'fill' })
            .png()
            .toBuffer();

        // Compute bbox of mask
        const bbox = await computeMaskBbox(maskBuffer, 0.20, 60);
        
        if (!bbox) {
            logger.warn(
                { ...logContext, stage: "bbox" },
                "No mask content found, returning original image"
            );
            // Return original image URL if no mask
            return roomImageUrl;
        }

        // Calculate crop area percentage
        const fullArea = roomWidth * roomHeight;
        const cropArea = bbox.width * bbox.height;
        const cropPercent = (cropArea / fullArea * 100).toFixed(1);
        const pixelReduction = (fullArea / cropArea).toFixed(1);

        logger.info(
            { ...logContext, stage: "bbox" },
            `Bbox: ${bbox.width}x${bbox.height} at (${bbox.x},${bbox.y}) - ${cropPercent}% of image (${pixelReduction}x pixel reduction)`
        );

        // DISABLED: Cropping was causing issues with Gemini removing wrong objects
        // The AI needs full image context to understand what to remove vs keep
        const shouldCrop = false; // Disabled for accuracy - was: cropArea < fullArea * 0.5
        
        let inputRoom: Buffer;
        let inputMask: Buffer;
        let maxDim = 768; // Preview resolution for speed

        if (shouldCrop) {
            // Crop both room and mask to bbox
            croppedRoom = await sharp(roomBuffer)
                .extract({ left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height })
                .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 }) // JPEG for smaller payload
                .toBuffer();

            croppedMask = await sharp(maskBuffer)
                .extract({ left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height })
                .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer();

            inputRoom = croppedRoom;
            inputMask = croppedMask;

            logger.info(
                { ...logContext, stage: "crop" },
                `Cropped to ${bbox.width}x${bbox.height}, resized to max ${maxDim}px (room: ${inputRoom.length} bytes, mask: ${inputMask.length} bytes)`
            );
        } else {
            // Send full image but resize for speed
            inputRoom = await sharp(roomBuffer)
                .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer();

            inputMask = await sharp(maskBuffer)
                .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer();

            logger.info(
                { ...logContext, stage: "resize" },
                `Full image resized to max ${maxDim}px (room: ${inputRoom.length} bytes, mask: ${inputMask.length} bytes)`
            );
        }

        // Short fixed prompt for speed
        const prompt = "Remove masked object. Fill seamlessly. Keep unmasked areas unchanged.";

        logger.info(
            { ...logContext, stage: "gemini-call" },
            `Calling Gemini Flash (${inputRoom.length + inputMask.length} bytes total)`
        );

        const geminiStart = Date.now();
        const base64Data = await callGemini(prompt, [inputRoom, inputMask], {
            model: IMAGE_MODEL_FAST,
            logContext
        });
        const geminiTime = Date.now() - geminiStart;

        // Clean up input buffers
        croppedRoom = null;
        croppedMask = null;

        outputBuffer = Buffer.from(base64Data, 'base64');

        // If we cropped, we need to composite the result back into the original
        let finalBuffer: Buffer;
        if (shouldCrop && bbox) {
            // Get output dimensions
            const outputMeta = await sharp(outputBuffer).metadata();
            
            // Scale output back to original crop size
            const scaledOutput = await sharp(outputBuffer)
                .resize(bbox.width, bbox.height, { fit: 'fill' })
                .toBuffer();

            // Composite back into original room image
            finalBuffer = await sharp(roomBuffer)
                .composite([{
                    input: scaledOutput,
                    left: bbox.x,
                    top: bbox.y
                }])
                .jpeg({ quality: 90 })
                .toBuffer();

            logger.info(
                { ...logContext, stage: "composite" },
                `Composited ${outputMeta.width}x${outputMeta.height} result back at (${bbox.x},${bbox.y})`
            );
        } else {
            // Just resize output to original dimensions
            finalBuffer = await sharp(outputBuffer)
                .resize(roomWidth, roomHeight, { fit: 'fill' })
                .jpeg({ quality: 90 })
                .toBuffer();
        }

        // Upload final result
        const key = `cleaned/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const url = await uploadToGCS(key, finalBuffer, 'image/jpeg', logContext);

        const totalTime = Date.now() - startTime;
        logger.info(
            { ...logContext, stage: "complete" },
            `Object removal complete: total=${totalTime}ms, gemini=${geminiTime}ms, cropped=${shouldCrop}, reduction=${pixelReduction}x`
        );

        return url;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            { ...logContext, stage: "error" },
            `Room cleanup failed: ${errorMsg}`,
            error
        );
        throw error;
    } finally {
        maskBuffer = null;
        roomBuffer = null;
        outputBuffer = null;
        croppedRoom = null;
        croppedMask = null;
    }
}

export async function compositeScene(
    preparedProductImageUrl: string,
    roomImageUrl: string,
    placement: { x: number; y: number; scale: number },
    stylePreset: string = 'neutral',
    requestId: string = "composite",
    productInstructions?: string
): Promise<string> {
    const logContext = createLogContext("render", requestId, "start", {});
    logger.info(logContext, `Processing scene composite with Gemini${productInstructions ? ' (with custom instructions)' : ''}`);

    // Track buffers for explicit cleanup
    let productBuffer: Buffer | null = null;
    let roomBuffer: Buffer | null = null;
    let resizedProduct: Buffer | null = null;
    let guideImageBuffer: Buffer | null = null;
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

        const roomWidth = roomMetadata.width || 1920;
        const roomHeight = roomMetadata.height || 1080;
        const pixelX = Math.round(roomWidth * placement.x);
        const pixelY = Math.round(roomHeight * placement.y);

        const newWidth = Math.round((productMetadata.width || 500) * placement.scale);

        // PERFORMANCE: Single pipeline for resize + get metadata
        const resizedResult = await sharp(productBuffer)
            .resize({ width: newWidth })
            .toBuffer({ resolveWithObject: true });

        resizedProduct = resizedResult.data;

        // Clean up original product buffer - no longer needed after resize
        productBuffer = null;

        // Use info from resize result instead of another metadata call
        const adjustedX = Math.max(0, pixelX - Math.round(resizedResult.info.width / 2));
        const adjustedY = Math.max(0, pixelY - Math.round(resizedResult.info.height / 2));

        guideImageBuffer = await sharp(roomBuffer)
            .composite([{ input: resizedProduct, top: adjustedY, left: adjustedX }])
            .toBuffer();

        // Clean up intermediate buffers - no longer needed after composite
        roomBuffer = null;
        resizedProduct = null;

        // Step 2: AI polish
        const styleDescription = stylePreset === 'neutral' ? 'natural and realistic' : stylePreset;
        
        // Build prompt with optional custom product instructions
        let prompt = `This image shows a product placed into a room scene.
The product is already positioned - do NOT move, resize, reposition, or warp the product.
Make the composite look photorealistic by:
1. Harmonizing the lighting on the product to match the room's light sources
2. Adding appropriate shadows beneath and around the product
3. Adding subtle reflections if on a reflective surface
4. Ensuring color temperature consistency
Style: ${styleDescription}`;

        // Add custom product instructions if provided
        if (productInstructions && productInstructions.trim()) {
            prompt += `\n\nProduct-specific instructions:\n${productInstructions.trim()}`;
        }

        prompt += `\nKeep the product's exact position, size, and shape unchanged.`;

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


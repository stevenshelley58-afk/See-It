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
    { label: '1:1',   value: 1.0 },
    { label: '4:5',   value: 0.8 },
    { label: '5:4',   value: 1.25 },
    { label: '3:4',   value: 0.75 },
    { label: '4:3',   value: 4/3 },
    { label: '2:3',   value: 2/3 },
    { label: '3:2',   value: 1.5 },
    { label: '9:16',  value: 9/16 },
    { label: '16:9', value: 16/9 },
    { label: '21:9', value: 21/9 },
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

/**
 * Room cleanup - remove objects using Gemini with mask-as-hint approach
 * 
 * The mask is a HINT for what to remove, not a strict pixel boundary.
 * Gemini will identify and remove the intended object even if the mask is imperfect.
 * We then composite the result to guarantee no changes outside the edit region.
 * 
 * Mask convention: WHITE = user intent area (object to remove), BLACK = keep unchanged
 */
export async function cleanupRoom(
    roomImageUrl: string,
    maskDataUrl: string,
    requestId: string = "cleanup"
): Promise<string> {
    const logContext = createLogContext("cleanup", requestId, "start", {});
    const startTime = Date.now();
    
    logger.info(logContext, "Processing room cleanup with Gemini (mask-as-hint mode)");

    try {
        // ============================================================================
        // STEP 1: Parse and prepare sourceRoomImage
        // ============================================================================
        const sourceRoomBuffer = await downloadToBuffer(roomImageUrl, logContext, 1024);
        
        const roomMeta = await sharp(sourceRoomBuffer).metadata();
        const roomWidth = roomMeta.width!;
        const roomHeight = roomMeta.height!;

        logger.info(
            { ...logContext, stage: "source-room-loaded" },
            `sourceRoomImage: ${roomWidth}x${roomHeight}, ${sourceRoomBuffer.length} bytes`
        );

        // ============================================================================
        // STEP 2: Parse and prepare inpaintMaskImage (user-drawn mask as hint)
        // ============================================================================
        const maskBase64 = maskDataUrl.split(',')[1];
        const rawMaskBuffer = Buffer.from(maskBase64, 'base64');
        
        // Resize mask to match room dimensions exactly
        // NOTE: Use nearest-neighbor to avoid introducing gray edges that can shift intent.
        const resizedMaskBuffer = await sharp(rawMaskBuffer)
            .resize(roomWidth, roomHeight, { fit: 'fill', kernel: 'nearest' })
            .png()
            .toBuffer();

        // ============================================================================
        // STEP 3: Create AI-assisted edit region (expand + feather for medium spill)
        // This allows Gemini to "complete" object removal even if brush was imperfect
        // ============================================================================
        const MASK_EXPANSION_PX = 16;  // Medium spill - expand mask edges
        const MASK_FEATHER_SIGMA = 6;  // Soft edges for natural blending

        // Convert to grayscale, threshold to binary, expand, then feather
        const editRegionMask = await sharp(resizedMaskBuffer)
            .grayscale()
            .removeAlpha()
            .threshold(128)                           // Clean binary mask
            .blur(Math.max(1, MASK_EXPANSION_PX * 0.7))  // Expand via blur
            .threshold(64)                            // Re-threshold after expansion
            .blur(MASK_FEATHER_SIGMA)                 // Feather edges
            .png()
            .toBuffer();

        // Calculate mask coverage to detect empty/invalid masks
        const maskStats = await sharp(editRegionMask).stats();
        const meanIntensity = maskStats.channels[0]?.mean || 0;
        const maskCoveragePercent = (meanIntensity / 255) * 100;
        
        logger.info(
            { ...logContext, stage: "edit-region-created" },
            `editRegionMask: expansion=${MASK_EXPANSION_PX}px, feather=${MASK_FEATHER_SIGMA}px, coverage=${maskCoveragePercent.toFixed(2)}%`
        );

        // Warn if mask coverage is very low (might indicate empty strokes)
        if (maskCoveragePercent < 0.1) {
            logger.warn(
                { ...logContext, stage: "mask-validation" },
                `Mask coverage very low (${maskCoveragePercent.toFixed(2)}%) - strokes may not be captured correctly`
            );
        }

        // ============================================================================
        // STEP 4: Compute closest Gemini-supported aspect ratio
        // ============================================================================
        const exactAspectRatio = (roomWidth / roomHeight).toFixed(3);
        const closestRatio = findClosestGeminiRatio(roomWidth, roomHeight);

        logger.info(
            { ...logContext, stage: "dimensions" },
            `Target dimensions: ${roomWidth}x${roomHeight}, aspect=${exactAspectRatio}, closest Gemini ratio: ${closestRatio.label}`
        );

        // ============================================================================
        // STEP 5: Build Gemini prompt (mask-as-hint, strict constraints)
        // ============================================================================
        const inpaintPrompt = `INPAINTING TASK - OBJECT REMOVAL

You are given two images:
1. sourceRoomImage: A photograph of a room (${roomWidth}x${roomHeight} pixels)
2. inpaintMaskImage: A mask showing the user's intent (white regions indicate the object to remove)

INSTRUCTIONS:
- Identify the object that overlaps the WHITE regions in the mask
- REMOVE that entire object from the room (even parts slightly outside the white area)
- FILL the removed area naturally with background that matches the surrounding floor, wall, or surface
- The mask is a HINT - remove the complete object the user intended, not just the exact white pixels

STRICT CONSTRAINTS:
- Output image MUST maintain the EXACT same aspect ratio as the input (${exactAspectRatio}:1)
- DO NOT change the camera angle, zoom, or framing
- DO NOT extend, crop, or resize the image
- DO NOT add any new objects, people, or furniture
- DO NOT modify lighting, colors, or textures outside the removal area
- Keep everything outside the object removal area UNCHANGED`;

        logger.info(
            { ...logContext, stage: "gemini-call" },
            `Calling Gemini: sourceRoom=${sourceRoomBuffer.length}b, mask=${editRegionMask.length}b`
        );

        // ============================================================================
        // STEP 6: Call Gemini with computed aspect ratio to ensure consistent output
        // ============================================================================
        const geminiStart = Date.now();
        const base64Data = await callGemini(inpaintPrompt, [sourceRoomBuffer, editRegionMask], {
            model: IMAGE_MODEL_PRO, // Use PRO model for room cleanup per config (MODEL_FOR_ROOM_CLEANUP)
            aspectRatio: closestRatio.label, // Pass computed ratio to ensure Gemini output matches
            logContext
        });
        const geminiTime = Date.now() - geminiStart;

        const geminiOutputBuffer = Buffer.from(base64Data, 'base64');

        // ============================================================================
        // STEP 7: Handle dimension mismatch WITHOUT stretching
        // Use cover + center crop to preserve aspect ratio
        // ============================================================================
        const outputMeta = await sharp(geminiOutputBuffer).metadata();
        const outputWidth = outputMeta.width!;
        const outputHeight = outputMeta.height!;

        logger.info(
            { ...logContext, stage: "gemini-output" },
            `Gemini output: ${outputWidth}x${outputHeight} (expected ${roomWidth}x${roomHeight}), geminiTime=${geminiTime}ms`
        );

        let resizedGeminiOutput: Buffer;
        if (outputWidth !== roomWidth || outputHeight !== roomHeight) {
            // Check if aspect ratios match (within tolerance)
            const outputRatio = outputWidth / outputHeight;
            const targetRatio = roomWidth / roomHeight;
            const ratioDiff = Math.abs(outputRatio - targetRatio);
            
            if (ratioDiff < 0.01) {
                // Ratios match - safe to resize without distortion
                logger.info(
                    { ...logContext, stage: "dimension-mismatch" },
                    `Gemini returned different dimensions but same ratio, resizing: ${outputWidth}x${outputHeight} -> ${roomWidth}x${roomHeight}`
                );
                resizedGeminiOutput = await sharp(geminiOutputBuffer)
                    .resize(roomWidth, roomHeight, { fit: 'fill' })
                    .png()
                    .toBuffer();
            } else {
                // Ratios differ - use fill (stretch) to maintain coordinate alignment with mask.
                // Gemini generated its output based on original coordinates, so we must map
                // coordinates linearly: Gemini(x,y) → (x*targetW/outputW, y*targetH/outputH)
                // This is exactly what 'fill' does. Cover/contain would shift the content.
                logger.warn(
                    { ...logContext, stage: "dimension-mismatch" },
                    `Gemini returned different aspect ratio, using fill (stretch) for coordinate alignment: ${outputWidth}x${outputHeight} (ratio ${outputRatio.toFixed(3)}) -> ${roomWidth}x${roomHeight} (ratio ${targetRatio.toFixed(3)})`
                );
                resizedGeminiOutput = await sharp(geminiOutputBuffer)
                    .resize(roomWidth, roomHeight, { fit: 'fill' })
                    .png()
                    .toBuffer();
            }
        } else {
            resizedGeminiOutput = geminiOutputBuffer;
        }

        // ============================================================================
        // STEP 8: Composite to lock pixels outside edit region
        // Outside edit region: original sourceRoomImage
        // Inside edit region: Gemini output
        // Formula: result = original * (1 - mask) + gemini * mask
        // This GUARANTEES no room extension/warping/drift
        // ============================================================================
        
        // Create the composite mask (edit region determines where Gemini output is used)
        // Mask should already be correct size, but ensure it matches
        // IMPORTANT: Use .extractChannel(0) to guarantee single-channel output for pixel blending
        const compositeMask = await sharp(editRegionMask)
            .resize(roomWidth, roomHeight, { fit: 'fill', kernel: 'nearest' })
            .grayscale()
            .extractChannel(0) // Ensure single channel for correct pixel indexing
            .toBuffer();

        // Get raw pixel data for proper alpha compositing
        const [sourceRaw, geminiRaw, maskRaw] = await Promise.all([
            sharp(sourceRoomBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
            sharp(resizedGeminiOutput).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
            sharp(compositeMask).raw().toBuffer({ resolveWithObject: true })
        ]);

        const { data: srcData, info: srcInfo } = sourceRaw;
        const { data: gemData } = geminiRaw;
        const { data: maskData } = maskRaw;

        // Manual pixel blend: result = src * (1-alpha) + gemini * alpha
        const resultData = Buffer.alloc(srcData.length);
        const pixelCount = srcInfo.width * srcInfo.height;

        for (let i = 0; i < pixelCount; i++) {
            const srcIdx = i * 4;  // RGBA
            const maskIdx = i;     // Grayscale mask
            
            const alpha = maskData[maskIdx] / 255;  // 0-1 range
            const invAlpha = 1 - alpha;

            // Blend RGB channels
            resultData[srcIdx] = Math.round(srcData[srcIdx] * invAlpha + gemData[srcIdx] * alpha);         // R
            resultData[srcIdx + 1] = Math.round(srcData[srcIdx + 1] * invAlpha + gemData[srcIdx + 1] * alpha); // G
            resultData[srcIdx + 2] = Math.round(srcData[srcIdx + 2] * invAlpha + gemData[srcIdx + 2] * alpha); // B
            resultData[srcIdx + 3] = 255;  // Full opacity
        }

        const compositeResult = await sharp(resultData, {
            raw: {
                width: srcInfo.width,
                height: srcInfo.height,
                channels: 4
            }
        })
        .jpeg({ quality: 90 })
        .toBuffer();

        logger.info(
            { ...logContext, stage: "composite-complete" },
            `Composite done: ${compositeResult.length} bytes, outside-mask locked to original`
        );

        // ============================================================================
        // STEP 9: Upload result
        // ============================================================================
        const key = `cleaned/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const url = await uploadToGCS(key, compositeResult, 'image/jpeg', logContext);

        const totalTime = Date.now() - startTime;
        logger.info(
            { ...logContext, stage: "complete" },
            `Cleanup complete: total=${totalTime}ms, gemini=${geminiTime}ms, dimensions=${roomWidth}x${roomHeight}`
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
        const baseMask = await sharp({
            create: { width: roomWidth, height: roomHeight, channels: 1, background: 0 }
        })
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

        // Step 2: AI polish with final render prompt
        const productInstructionsText = productInstructions?.trim() || 'None provided.';
        
        const prompt = `You are performing a realistic product placement into a real photograph.

Primary task:
Polish the placement of the product that is already composited into the guide image.

You are given two images:
1) guideCompositeImage: the room photo with the product roughly placed
2) editRegionMaskImage: WHITE = region you may modify (product + immediate surrounding area), BLACK = must remain pixel-identical

Hard constraints (must follow):
- Preserve the product's exact shape, proportions, materials, and colors.
- Preserve the room's existing geometry, perspective, walls, floors, and lighting.
- Do not change any pixels outside the WHITE region of the mask.
- Do not invent additional decor or structural elements.
- Do not change camera angle or room layout.

Physical realism rules:
- The product must interact correctly with gravity.
- The product must rest on appropriate surfaces unless explicitly stated otherwise.
- Add a natural contact shadow where the product meets the surface.
- Match lighting direction, intensity, and color temperature from the scene.

Geometric alignment rules:
- If the product is placed against a wall or surface, it must align to the plane of that surface.
- The product must rotate and skew to match the wall's angle and perspective.
- The product must not face the camera unless the wall itself faces the camera.

Product-specific instructions:
${productInstructionsText}

Final check:
If there is any conflict between realism assumptions and the product-specific instructions, the product-specific instructions override realism assumptions.`;

        // Compute closest Gemini-supported aspect ratio from actual room dimensions
        const closestRatio = findClosestGeminiRatio(roomWidth, roomHeight);
        
        logger.info(
            { ...logContext, stage: "aspect-ratio" },
            `Room image: ${roomWidth}×${roomHeight} → closest Gemini ratio: ${closestRatio.label}`
        );

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


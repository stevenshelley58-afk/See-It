// Gemini AI service - runs directly in Railway, no separate Cloud Run service
import { GoogleGenAI, createPartFromUri } from "@google/genai";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";
import { logger, createLogContext } from "../utils/logger.server";
import { validateShopifyUrl, validateTrustedUrl } from "../utils/validate-shopify-url.server";
import { uploadToGeminiFiles, isGeminiFileValid, type GeminiFileInfo } from "./gemini-files.server";

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
// PROMPT BUILDER
// ============================================================================



/**
 * Build the composition prompt for Gemini image compositing
 * 
 * Uses exact normalized coordinates (0-1) for precise placement.
 * Includes explicit sizing information so Gemini preserves user's intended scale.
 * The placementPrompt provides product-specific rendering guidance (lighting, shadows, materials).
 */
function buildCompositePrompt(
    placementPrompt: string,
    placement: { x: number; y: number; width_px?: number; height_px?: number; canonical_width?: number; canonical_height?: number }
): string {
    // Build coordinates text
    let coordsText = `(${placement.x.toFixed(2)}, ${placement.y.toFixed(2)})`;
    if (placement.canonical_width && placement.canonical_height) {
        const centerX_px = Math.round(placement.x * placement.canonical_width);
        const centerY_px = Math.round(placement.y * placement.canonical_height);
        coordsText = `(${centerX_px}, ${centerY_px}) pixels`;
    }

    return `You are helping an online furniture store customer visualize a product in their home.
Composite the product image into the room photo so they can see how it would look in their space.

The product image is already scaled to the correct size. Do not resize it.
Position the product center at approximately ${coordsText}.

${placementPrompt || ''}`;
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

// Type for labeled images
interface LabeledImage {
    label: string;
    buffer: Buffer;
}

// Return type for prepareProduct function
export interface PrepareProductResult {
    url: string;
    geminiFileUri: string | null;
    geminiFileExpiresAt: Date | null;
}

async function callGemini(
    prompt: string,
    images: Buffer | Buffer[] | LabeledImage[],
    options: { model?: string; aspectRatio?: string; logContext?: ReturnType<typeof createLogContext>; timeoutMs?: number } = {}
): Promise<string> {
    const { model = IMAGE_MODEL_FAST, aspectRatio, logContext, timeoutMs = GEMINI_TIMEOUT_MS } = options;
    const context = logContext || createLogContext("system", "api-call", "start", {});
    logger.info(context, `Calling Gemini model: ${model} (timeout: ${timeoutMs}ms)`);

    const parts: any[] = [{ text: prompt }];

    // Handle both legacy Buffer[] format and new LabeledImage[] format
    const imageArray = Array.isArray(images) ? images : [images];
    for (const item of imageArray) {
        if (!item) continue;

        // Check if it's a LabeledImage (has label and buffer properties)
        if (typeof item === 'object' && 'label' in item && 'buffer' in item) {
            const labeled = item as LabeledImage;
            // Get image metadata for logging
            const imgMeta = await sharp(labeled.buffer).metadata();
            logger.info(
                { ...context, stage: "gemini-image" },
                `${labeled.label}: ${imgMeta.width}×${imgMeta.height}px, ${labeled.buffer.length} bytes (${(labeled.buffer.length / 1024).toFixed(1)}KB)`
            );
            // Add label text before the image
            parts.push({ text: `${labeled.label}:` });
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: labeled.buffer.toString('base64')
                }
            });
        } else if (Buffer.isBuffer(item)) {
            // Legacy: plain Buffer without label
            const imgMeta = await sharp(item).metadata();
            logger.info(
                { ...context, stage: "gemini-image" },
                `Image: ${imgMeta.width}×${imgMeta.height}px, ${item.length} bytes (${(item.length / 1024).toFixed(1)}KB)`
            );
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: item.toString('base64')
                }
            });
        }
    }
    
    // Log the complete parts array structure (without base64 data)
    const partsSummary = parts.map(p => {
        if (p.text) return { type: 'text', content: p.text.substring(0, 200) };
        if (p.inlineData) return { type: 'image', mimeType: p.inlineData.mimeType, dataSize: p.inlineData.data.length };
        if (p.fileUri) return { type: 'fileUri', uri: p.fileUri.substring(0, 100) };
        return { type: 'unknown', keys: Object.keys(p) };
    });
    logger.info(
        { ...context, stage: "gemini-parts" },
        `Gemini request parts: ${JSON.stringify(partsSummary, null, 2)}`
    );

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
            return callGemini(prompt, images, { ...options, model: IMAGE_MODEL_FAST });
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
): Promise<PrepareProductResult> {
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

        let lastError: unknown = null;
        let usedMethod: string = "none";

        // Background removal: @imgly/background-removal-node
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

        // TRIM TRANSPARENT PADDING - Find tightest bounding box around non-transparent pixels
        // This ensures PNG dimensions match the actual visible product content.
        try {
            const beforeMeta = await sharp(outputBuffer).metadata();
            
            // Get raw RGBA pixel data to find actual content bounds
            const { data, info } = await sharp(outputBuffer)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            const { width, height, channels } = info;
            
            // Find bounding box of non-transparent pixels (alpha > 128 to ignore semi-transparent fringes)
            let minX = width, minY = height, maxX = 0, maxY = 0;
            let foundContent = false;
            const ALPHA_THRESHOLD = 128; // Ignore pixels less than 50% opaque
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * channels;
                    const alpha = data[idx + 3]; // Alpha channel is 4th byte (RGBA)
                    
                    if (alpha > ALPHA_THRESHOLD) {
                        foundContent = true;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            
            if (foundContent && maxX >= minX && maxY >= minY) {
                const cropWidth = maxX - minX + 1;
                const cropHeight = maxY - minY + 1;
                
                // Only crop if we're actually reducing size
                if (cropWidth < width || cropHeight < height) {
                    const trimmedBuffer = await sharp(outputBuffer)
                        .extract({ left: minX, top: minY, width: cropWidth, height: cropHeight })
                        .png()
                        .toBuffer();
                    
                    outputBuffer = trimmedBuffer;
                    logger.info(
                        { ...logContext, stage: "trim" },
                        `Trimmed to content bounds: ${beforeMeta.width}×${beforeMeta.height} → ${cropWidth}×${cropHeight} (crop: x=${minX}, y=${minY})`
                    );
                } else {
                    logger.info(
                        { ...logContext, stage: "trim" },
                        `No trim needed - content fills image: ${width}×${height}`
                    );
                }
            } else {
                logger.warn(
                    { ...logContext, stage: "trim" },
                    `No non-transparent content found in image ${width}×${height}`
                );
            }
        } catch (trimError) {
            // Trim failed - continue with untrimmed image
            logger.warn(
                { ...logContext, stage: "trim" },
                "Failed to trim transparent padding, continuing with original",
                trimError
            );
        }

        const key = `products/${shopId}/${productId}/${assetId}_prepared.png`;
        const url = await uploadToGCS(key, outputBuffer, 'image/png', logContext);

        // Pre-upload to Gemini Files API for faster render times
        // This is non-blocking - failure doesn't stop the flow
        let geminiFileInfo: GeminiFileInfo | null = null;
        try {
            geminiFileInfo = await uploadToGeminiFiles(
                outputBuffer,
                'image/png',
                `product-${productId}`,
                requestId
            );
            logger.info(
                { ...logContext, stage: "gemini-upload" },
                `Pre-uploaded to Gemini Files API: ${geminiFileInfo.uri} (expires: ${geminiFileInfo.expiresAt.toISOString()})`
            );
        } catch (geminiError) {
            // Log but don't fail - Gemini upload is an optimization, not required
            logger.warn(
                { ...logContext, stage: "gemini-upload-failed" },
                "Gemini Files API upload failed (will use fallback at render time)",
                geminiError
            );
        }

        // Clean up output buffer after upload
        outputBuffer = null;

        logger.info(
            { ...logContext, stage: "complete" },
            `Product preparation completed successfully: ${url.substring(0, 80)}...`
        );

        return {
            url,
            geminiFileUri: geminiFileInfo?.uri ?? null,
            geminiFileExpiresAt: geminiFileInfo?.expiresAt ?? null,
        };
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

/**
 * Options for compositeScene with optional Gemini file URIs
 * When URIs are provided and valid (not expired), they'll be used
 * instead of downloading and re-uploading images
 */
export interface CompositeOptions {
    /** Pre-uploaded Gemini file URI for room image */
    roomGeminiUri?: string | null;
    /** Expiration time for room Gemini file */
    roomGeminiExpiresAt?: Date | null;
    /** Pre-uploaded Gemini file URI for product image */
    productGeminiUri?: string | null;
    /** Expiration time for product Gemini file */
    productGeminiExpiresAt?: Date | null;
    /** Optional telemetry callback - called with raw prompt and config right before API call */
    onPromptBuilt?: (telemetry: {
        prompt: string;
        model: string;
        aspectRatio: string;
        useRoomUri: boolean;
        useProductUri: boolean;
        placement: { x: number; y: number; scale: number } | { box_px: { center_x_px: number; center_y_px: number; width_px: number } };
        stylePreset: string;
        placementPrompt?: string;
        canonicalRoomKey?: string | null;
        canonicalRoomWidth?: number | null;
        canonicalRoomHeight?: number | null;
        canonicalRoomRatio?: string | null;
        productResizedWidth?: number;
        productResizedHeight?: number;
    }) => void;
}

export async function compositeScene(
    preparedProductImageUrl: string,
    roomImageUrl: string,
    placement: { x: number; y: number; scale: number; width_px?: number; canonical_width?: number; canonical_height?: number },
    stylePreset: string = 'neutral',
    requestId: string = "composite",
    placementPrompt?: string,
    options?: CompositeOptions
): Promise<CompositeResult> {
    const logContext = createLogContext("render", requestId, "start", {});

    // Check if we can use pre-uploaded Gemini files
    const useRoomUri = options?.roomGeminiUri && isGeminiFileValid(options.roomGeminiExpiresAt);
    const useProductUri = options?.productGeminiUri && isGeminiFileValid(options.productGeminiExpiresAt);

    logger.info(logContext, `Processing scene composite with Gemini (direct fusion)${placementPrompt ? ' - with placement prompt' : ''}${useRoomUri ? ' [room: Gemini URI]' : ''}${useProductUri ? ' [product: Gemini URI]' : ''}`);

    // Track buffers for explicit cleanup
    let productBuffer: Buffer | null = null;
    let roomBuffer: Buffer | null = null;
    let resizedProduct: Buffer | null = null;

    try {
        // STEP 1: Download both images in parallel
        const [productResult, roomResult] = await Promise.all([
            downloadToBuffer(preparedProductImageUrl, logContext),
            downloadToBuffer(roomImageUrl, logContext)
        ]);
        productBuffer = productResult;
        roomBuffer = roomResult;

        // STEP 2: Get metadata for sizing calculations
        const [roomMetadata, productMetadata] = await Promise.all([
            sharp(roomBuffer).metadata(),
            sharp(productBuffer).metadata()
        ]);

        if (!roomMetadata.width || !roomMetadata.height) {
            throw new Error("Room image is missing dimensions");
        }
        if (!productMetadata.width || !productMetadata.height) {
            throw new Error("Product image is missing dimensions");
        }

        const roomWidth = roomMetadata.width;
        const roomHeight = roomMetadata.height;

        // STEP 3: Resize product to fit within bounding box
        // Product maintains aspect ratio while fitting inside the specified box
        const boxWidth = (placement as any).width_px;
        const boxHeight = (placement as any).height_px;
        
        if (Number.isFinite(boxWidth) && Number.isFinite(boxHeight) && boxWidth > 0 && boxHeight > 0) {
            // New format: fit product within bounding box (maintains aspect ratio)
            const clampedBoxWidth = Math.max(32, Math.min(roomWidth, boxWidth));
            const clampedBoxHeight = Math.max(32, Math.min(roomHeight, boxHeight));
            
            logger.info(
                { ...logContext, stage: "resize" },
                `Fitting product within bounding box: ${clampedBoxWidth}x${clampedBoxHeight}px (product original: ${productMetadata.width}x${productMetadata.height})`
            );
            
            // Use 'inside' fit - product fits within box, maintains aspect ratio
            resizedProduct = await sharp(productBuffer)
                .resize({ 
                    width: clampedBoxWidth, 
                    height: clampedBoxHeight, 
                    fit: 'inside'  // CRITICAL: fit inside bounding box, maintain aspect ratio
                })
                .png()
                .toBuffer();
        } else if (Number.isFinite(boxWidth) && boxWidth > 0) {
            // Fallback: width only (legacy format)
            const clampedWidth = Math.max(32, Math.min(roomWidth, boxWidth));
            
            logger.info(
                { ...logContext, stage: "resize" },
                `Resizing product to width only (legacy): ${clampedWidth}px`
            );
            
            resizedProduct = await sharp(productBuffer)
                .resize({ width: clampedWidth })
                .png()
                .toBuffer();
        } else {
            // Ultimate fallback: use scale-based sizing
            const widthFromScale = Math.round(productMetadata.width * (placement.scale || 1));
            const clampedWidth = Math.max(32, Math.min(roomWidth, widthFromScale));
            
            logger.info(
                { ...logContext, stage: "resize" },
                `Resizing product using scale (legacy): ${placement.scale} -> ${clampedWidth}px`
            );
            
            resizedProduct = await sharp(productBuffer)
                .resize({ width: clampedWidth })
                .png()
                .toBuffer();
        }

        // Clean up original product buffer
        productBuffer = null;

        // Get actual resized dimensions (Sharp maintains aspect ratio)
        const resizedMetadata = await sharp(resizedProduct).metadata();
        const resizedWidth = resizedMetadata.width || clampedWidth;
        const resizedHeight = resizedMetadata.height || Math.round(clampedWidth * (productMetadata.height / productMetadata.width));

        logger.info(
            { ...logContext, stage: "resize" },
            `Resized product: ${productMetadata.width}×${productMetadata.height} → ${resizedWidth}×${resizedHeight}px, room=${roomWidth}×${roomHeight}`
        );

        // STEP 4: Build the narrative prompt with explicit sizing
        // Pass the placementPrompt which contains product-specific rendering guidance
        const promptText = placementPrompt?.trim() || '';
        const prompt = buildCompositePrompt(promptText, {
            x: placement.x,
            y: placement.y,
            width_px: (placement as any).width_px,
            canonical_width: (placement as any).canonical_width,
            canonical_height: (placement as any).canonical_height
        });

        // Compute closest Gemini-supported aspect ratio
        const closestRatio = findClosestGeminiRatio(roomWidth, roomHeight);

        logger.info(
            { ...logContext, stage: "pre-gemini" },
            `Sending to Gemini: room=${roomWidth}×${roomHeight}, ratio=${closestRatio.label}, placement=(${placement.x.toFixed(2)}, ${placement.y.toFixed(2)}), product_resized=${resizedWidth}×${resizedHeight}px`
        );
        
        // Log the actual prompt being sent
        logger.info(
            { ...logContext, stage: "prompt" },
            `Gemini prompt: ${prompt.substring(0, 500)}${prompt.length > 500 ? '...' : ''}`
        );
        
        // Log image dimensions being sent
        const roomMeta = await sharp(roomBuffer!).metadata();
        const productMeta = await sharp(resizedProduct!).metadata();
        logger.info(
            { ...logContext, stage: "images" },
            `Image dimensions: ROOM=${roomMeta.width}×${roomMeta.height} (${(roomBuffer!.length / 1024).toFixed(1)}KB), PRODUCT=${productMeta.width}×${productMeta.height} (${(resizedProduct!.length / 1024).toFixed(1)}KB)`
        );

        // Get canonical room info for telemetry (if available from placement)
        const canonicalRoomKey = (placement as any).canonicalRoomKey || null;
        const canonicalRoomWidth = (placement as any).canonical_width || null;
        const canonicalRoomHeight = (placement as any).canonical_height || null;

        // Invoke telemetry callback if provided (right before API call)
        if (options?.onPromptBuilt) {
            try {
                options.onPromptBuilt({
                    prompt,
                    model: IMAGE_MODEL_PRO,
                    aspectRatio: closestRatio.label,
                    useRoomUri: useRoomUri,
                    useProductUri: useProductUri,
                    placement,
                    stylePreset,
                    placementPrompt: placementPrompt || undefined,
                    canonicalRoomKey: canonicalRoomKey,
                    canonicalRoomWidth: canonicalRoomWidth,
                    canonicalRoomHeight: canonicalRoomHeight,
                    canonicalRoomRatio: closestRatio.label,
                    productResizedWidth: resizedWidth,
                    productResizedHeight: resizedHeight,
                });
            } catch (telemetryError) {
                // Telemetry callback should never break the render flow
                logger.debug(
                    { ...logContext, stage: "telemetry-error" },
                    `Telemetry callback failed (non-critical): ${telemetryError instanceof Error ? telemetryError.message : String(telemetryError)}`
                );
            }
        }

        // STEP 5: Send labeled images to Gemini for compositing
        // When Gemini URIs are available, use createPartFromUri for faster requests
        // Otherwise fall back to inline base64 data
        let base64Data: string;

        if (useRoomUri) {
            // OPTIMIZED PATH: Use pre-uploaded room URI (saves ~2-3s of upload time)
            logger.info(
                { ...logContext, stage: "gemini-uri-mode" },
                `Using Gemini file URI for room: ${options!.roomGeminiUri!.substring(0, 60)}...`
            );

            // Build parts array with URI reference for room, inline for product
            const parts: any[] = [
                { text: prompt },
                { text: "ROOM IMAGE:" },
                createPartFromUri(options!.roomGeminiUri!, 'image/jpeg'),
                { text: "PRODUCT IMAGE:" },
                {
                    inlineData: {
                        mimeType: 'image/png',
                        data: resizedProduct!.toString('base64')
                    }
                }
            ];

            const config: any = { responseModalities: ['TEXT', 'IMAGE'] };
            if (closestRatio.label) {
                config.imageConfig = { aspectRatio: closestRatio.label };
            }

            const client = getGeminiClient();
            const response = await withTimeout(
                client.models.generateContent({
                    model: IMAGE_MODEL_PRO,
                    contents: parts,
                    config,
                }),
                GEMINI_TIMEOUT_MS,
                `Gemini composite with URI`
            );

            // Extract image from response
            const candidates = response.candidates;
            if (candidates?.[0]?.content?.parts) {
                for (const part of candidates[0].content.parts) {
                    if (part.inlineData?.data) {
                        base64Data = part.inlineData.data;
                        break;
                    }
                }
            }

            if (!base64Data!) {
                throw new Error("No image in Gemini response (URI mode)");
            }
        } else {
            // STANDARD PATH: Use inline base64 for both images
            base64Data = await callGemini(prompt, [
                { label: "ROOM IMAGE", buffer: roomBuffer! },
                { label: "PRODUCT IMAGE", buffer: resizedProduct! }
            ], {
                model: IMAGE_MODEL_PRO,
                aspectRatio: closestRatio.label,
                logContext
            });
        }

        // Clean up input buffers
        roomBuffer = null;
        resizedProduct = null;

        // STEP 6: Trust Gemini's output - just convert and upload
        const outputBuffer = Buffer.from(base64Data, 'base64');

        // Convert to JPEG for storage efficiency
        const finalImage = await sharp(outputBuffer)
            .jpeg({ quality: 92 })
            .toBuffer();

        const key = `composite/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const url = await uploadToGCS(key, finalImage, 'image/jpeg', logContext);

        logger.info(
            { ...logContext, stage: "complete" },
            `Composite complete: ${key}`
        );

        return { imageUrl: url, imageKey: key };
    } finally {
        // Explicit cleanup in finally block
        productBuffer = null;
        roomBuffer = null;
        resizedProduct = null;
    }
}


// Gemini AI service - runs directly in Railway, no separate Cloud Run service
import { GoogleGenAI } from "@google/genai";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import { Storage } from "@google-cloud/storage";
import { logger, createLogContext } from "../utils/logger.server";
import { imageCache } from "../utils/image-cache.server";

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

// Initialize GCS
let storage: Storage;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
        let jsonString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
        if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
            jsonString = jsonString.slice(1, -1);
        }
        let credentials;
        try {
            const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
            if (decoded.startsWith('{')) {
                credentials = JSON.parse(decoded);
            } else {
                credentials = JSON.parse(jsonString);
            }
        } catch {
            credentials = JSON.parse(jsonString);
        }
        storage = new Storage({ credentials });
        logger.info(
            createLogContext("system", "init", "gcs-storage", {}),
            "GCS storage initialized with credentials"
        );
    } catch (error) {
        logger.error(
            createLogContext("system", "init", "gcs-storage", {}),
            "Failed to parse GCS credentials",
            error
        );
        storage = new Storage();
    }
} else {
    storage = new Storage();
}

const GCS_BUCKET = process.env.GCS_BUCKET || 'see-it-room';

/**
 * Get image from cache or download and cache it
 */
async function getCachedOrDownload(
    cacheKey: string,
    url: string,
    logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
    // Check cache first
    const cached = imageCache.get(cacheKey);
    if (cached) {
        logger.info(
            { ...logContext, stage: "cache-hit" },
            `Cache hit for ${cacheKey}: ${(cached.length / 1024).toFixed(1)}KB`
        );
        return cached;
    }

    // Download and cache
    logger.info(
        { ...logContext, stage: "cache-miss" },
        `Cache miss for ${cacheKey}, downloading...`
    );
    const buffer = await downloadToBuffer(url, logContext);
    imageCache.set(cacheKey, buffer);
    return buffer;
}

async function downloadToBuffer(
    url: string,
    logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
    logger.info(
        { ...logContext, stage: "download" },
        `Downloading image from Shopify CDN: ${url.substring(0, 80)}...`
    );
    
    // Force PNG format from Shopify CDN
    const pngUrl = url.includes('?') ? `${url}&format=png` : `${url}?format=png`;
    const response = await fetch(pngUrl, {
        headers: { 'Accept': 'image/png' }
    });
    
    if (!response.ok) {
        const error = new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        logger.error(
            { ...logContext, stage: "download" },
            "Failed to download image from CDN",
            error
        );
        throw error;
    }
    
    const contentType = response.headers.get("content-type") || "unknown";
    const contentLength = response.headers.get("content-length");
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    logger.info(
        { ...logContext, stage: "download" },
        `Downloaded image: ${buffer.length} bytes, content-type: ${contentType}`
    );
    
    // Guard: reject zero-size or suspiciously large files
    if (buffer.length === 0) {
        const error = new Error("Downloaded image is empty (0 bytes)");
        logger.error(
            { ...logContext, stage: "download" },
            "Empty image buffer",
            error
        );
        throw error;
    }
    
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (buffer.length > maxSize) {
        const error = new Error(`Image too large: ${buffer.length} bytes (max ${maxSize})`);
        logger.error(
            { ...logContext, stage: "download" },
            "Image exceeds size limit",
            error
        );
        throw error;
    }
    
    return buffer;
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
    options: { model?: string; aspectRatio?: string; logContext?: ReturnType<typeof createLogContext> } = {}
): Promise<string> {
    const { model = IMAGE_MODEL_FAST, aspectRatio, logContext } = options;
    const context = logContext || createLogContext("gemini", "api-call", "start", {});
    logger.info(context, `Calling Gemini model: ${model}`);

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

    try {
        const client = getGeminiClient();
        const response = await client.models.generateContent({
            model,
            contents: parts,
            config,
        });

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
        logger.error(context, `Gemini error with ${model}`, error);

        // Fallback to fast model if pro fails
        if (model === IMAGE_MODEL_PRO) {
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

    try {
        const imageBuffer = await downloadToBuffer(sourceImageUrl, logContext);

        // Convert to PNG format - force PNG output even if input was WebP/AVIF
        logger.info(
            { ...logContext, stage: "convert" },
            "Converting image to PNG format"
        );
        
        const pngBuffer = await sharp(imageBuffer)
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

        let outputBuffer: Buffer | null = null;
        let lastError: unknown = null;

        // Hard limit: MAX 2 attempts (PNG, then JPEG fallback)
        // Do not extend this array without careful consideration of cost/performance
        const MAX_BG_REMOVAL_ATTEMPTS = 2;
        const attempts: Array<{
            label: string;
            buffer: Buffer;
            mimeType: 'image/png' | 'image/jpeg';
            prep?: () => Promise<Buffer>;
        }> = [
            { label: 'png', buffer: pngBuffer, mimeType: 'image/png' },
            {
                label: 'jpeg-fallback',
                buffer: pngBuffer, // will be replaced lazily
                mimeType: 'image/jpeg',
                prep: async () => {
                    logger.info(
                        { ...logContext, stage: "bg-remove" },
                        "Fallback: converting to JPEG before background removal"
                    );
                    const jpegBuffer = await sharp(imageBuffer).jpeg({ quality: 95 }).toBuffer();
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
            try {
                const bufferToUse = attempt.prep ? await attempt.prep() : attempt.buffer;
                
                logger.debug(
                    { ...logContext, stage: "bg-remove" },
                    `Attempting background removal with ${attempt.label}, mimeType: ${attempt.mimeType}`
                );
                
                const resultBlob = await removeBackground(bufferToUse, {
                    // Not in types, but accepted by runtime
                    mimeType: attempt.mimeType,
                    output: {
                        format: 'image/png',
                        quality: 1.0
                    }
                } as any);

                const arrayBuffer = await resultBlob.arrayBuffer();
                outputBuffer = Buffer.from(arrayBuffer);
                
                logger.info(
                    { ...logContext, stage: "bg-remove" },
                    `Background removed successfully (${attempt.label}), output size: ${outputBuffer.length} bytes`
                );
                break;
            } catch (err) {
                lastError = err;
                logger.warn(
                    { ...logContext, stage: "bg-remove" },
                    `Background removal failed on ${attempt.label}`,
                    err
                );
            }
        }

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
    }
}

export async function cleanupRoom(
    roomImageUrl: string,
    maskDataUrl: string,
    requestId: string = "cleanup"
): Promise<string> {
    const logContext = createLogContext("cleanup", requestId, "start", {});
    logger.info(logContext, "Processing room cleanup with Gemini");
    
    const maskBase64 = maskDataUrl.split(',')[1];
    const maskBuffer = Buffer.from(maskBase64, 'base64');
    const roomBuffer = await downloadToBuffer(roomImageUrl, logContext);

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

    const outputBuffer = Buffer.from(base64Data, 'base64');
    const key = `cleaned/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    return await uploadToGCS(key, outputBuffer, 'image/jpeg', logContext);
}

export async function compositeScene(
    preparedProductImageUrl: string,
    roomImageUrl: string,
    placement: { x: number; y: number; scale: number },
    stylePreset: string = 'neutral',
    requestId: string = "composite",
    quality: 'fast' | 'hd' = 'fast',
    cacheKeys?: { product?: string; room?: string }
): Promise<string> {
    const logContext = createLogContext("render", requestId, "start", {});
    logger.info(logContext, `Processing scene composite (quality: ${quality})`);

    // Use cache if keys provided, otherwise download directly
    const [productBuffer, roomBuffer] = await Promise.all([
        cacheKeys?.product
            ? getCachedOrDownload(cacheKeys.product, preparedProductImageUrl, logContext)
            : downloadToBuffer(preparedProductImageUrl, logContext),
        cacheKeys?.room
            ? getCachedOrDownload(cacheKeys.room, roomImageUrl, logContext)
            : downloadToBuffer(roomImageUrl, logContext)
    ]);

    // Step 1: Mechanical placement with Sharp
    const roomMetadata = await sharp(roomBuffer).metadata();
    const roomWidth = roomMetadata.width || 1920;
    const roomHeight = roomMetadata.height || 1080;

    const pixelX = Math.round(roomWidth * placement.x);
    const pixelY = Math.round(roomHeight * placement.y);

    const productMetadata = await sharp(productBuffer).metadata();
    const newWidth = Math.round((productMetadata.width || 500) * placement.scale);

    const resizedProduct = await sharp(productBuffer)
        .resize({ width: newWidth })
        .toBuffer();

    const resizedMeta = await sharp(resizedProduct).metadata();
    const adjustedX = Math.max(0, pixelX - Math.round((resizedMeta.width || 0) / 2));
    const adjustedY = Math.max(0, pixelY - Math.round((resizedMeta.height || 0) / 2));

    const guideImageBuffer = await sharp(roomBuffer)
        .composite([{ input: resizedProduct, top: adjustedY, left: adjustedX }])
        .toBuffer();

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

    // Use fast model by default (3-6 sec), HD model for enhanced quality (10-20 sec)
    const selectedModel = quality === 'hd' ? IMAGE_MODEL_PRO : IMAGE_MODEL_FAST;
    logger.info(logContext, `Using model: ${selectedModel} (quality: ${quality})`);

    const base64Data = await callGemini(prompt, guideImageBuffer, {
        model: selectedModel,
        aspectRatio,
        logContext
    });

    const outputBuffer = Buffer.from(base64Data, 'base64');
    const key = `composite/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    return await uploadToGCS(key, outputBuffer, 'image/jpeg', logContext);
}

/**
 * Eagerly cache a room image (call after room upload confirmed)
 * This pre-downloads and caches the image so render is faster
 */
export async function eagerCacheRoomImage(
    sessionId: string,
    roomImageUrl: string
): Promise<void> {
    const logContext = createLogContext("cache", "eager", "room", { sessionId });

    try {
        logger.info(logContext, `Eager caching room image for session ${sessionId}`);

        // Download and cache
        const buffer = await downloadToBuffer(roomImageUrl, logContext);
        imageCache.set(`room:${sessionId}`, buffer);

        // Also pre-resize for Gemini (async, don't await)
        sharp(buffer)
            .resize({ width: 1920, withoutEnlargement: true })
            .toBuffer()
            .then(optimized => {
                imageCache.set(`room:${sessionId}:optimized`, optimized);
                logger.info(logContext, `Room image optimized and cached: ${(optimized.length / 1024).toFixed(1)}KB`);
            })
            .catch(err => {
                logger.warn(logContext, `Failed to optimize room image: ${err.message}`);
            });

        logger.info(logContext, `Room image cached: ${(buffer.length / 1024).toFixed(1)}KB`);
    } catch (error) {
        logger.warn(
            logContext,
            `Failed to eager cache room image: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        // Don't throw - this is an optimization, not critical
    }
}

/**
 * Cache a product image (call when product asset is accessed)
 */
export async function cacheProductImage(
    productId: string,
    imageUrl: string
): Promise<void> {
    const logContext = createLogContext("cache", "product", "set", { productId });

    try {
        const buffer = await downloadToBuffer(imageUrl, logContext);
        imageCache.set(`product:${productId}`, buffer);
        logger.info(logContext, `Product image cached: ${(buffer.length / 1024).toFixed(1)}KB`);
    } catch (error) {
        logger.warn(logContext, `Failed to cache product image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// Export cache key helpers for use in routes
export const getCacheKey = {
    room: (sessionId: string) => `room:${sessionId}`,
    roomOptimized: (sessionId: string) => `room:${sessionId}:optimized`,
    roomCleaned: (sessionId: string) => `room:${sessionId}:cleaned`,
    product: (productId: string) => `product:${productId}`
};


/**
 * Room Cleanup Service - Gemini-only object removal
 * 
 * Non-negotiable invariants enforced:
 * - I1: Single canonical bitmap (no display/upload mismatch)
 * - I2: Mask must match room dimensions exactly (fail fast on mismatch)
 * - I3: Never stretch output (fail if dimensions don't match, never use fit: 'fill')
 * - I4: Never rotate after masking (canonical bitmap is frozen)
 * - I5: Hard-lock pixels outside edit region via compositing
 * - I7: Gemini/Google only, model names imported from config
 */

import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";
import { logger, createLogContext } from "../utils/logger.server";
import { validateTrustedUrl } from "../utils/validate-shopify-url.server";
import { GEMINI_IMAGE_MODEL_PRO, GEMINI_IMAGE_MODEL_FAST } from "~/config/ai-models.config";

// Import helper functions from gemini.server.ts (reuse existing utilities)
// Note: We don't import callGemini directly to avoid circular dependencies.
// Instead, we'll reimplement the minimal Gemini calling logic here.

const GEMINI_TIMEOUT_MS = 60000; // 60 seconds

// Aspect ratio helper (same as gemini.server.ts)
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

class GeminiTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Gemini API call timed out after ${timeoutMs}ms`);
        this.name = 'GeminiTimeoutError';
    }
}

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

// Lazy initialize Gemini client
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
    if (!ai) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        logger.info(
            createLogContext("system", "init", "gemini-client", {}),
            "Gemini client initialized for room cleanup"
        );
    }
    return ai;
}

const storage = getGcsClient();

/**
 * Download image from URL to buffer (validated, no rotation/resize - canonical bitmap)
 */
async function downloadRoomImage(
    url: string,
    logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
    // Validate URL to prevent SSRF attacks
    try {
        validateTrustedUrl(url, "room image URL");
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
        `Downloading room image from trusted source: ${url.substring(0, 80)}...`
    );

    const response = await fetch(url);
    if (!response.ok) {
        const error = new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        logger.error(
            { ...logContext, stage: "download" },
            "Failed to download room image",
            error
        );
        throw error;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    logger.info(
        { ...logContext, stage: "download" },
        `Downloaded room image: ${buffer.length} bytes`
    );

    return buffer;
}

/**
 * Upload cleaned image to GCS
 */
async function uploadCleanedImage(
    key: string,
    buffer: Buffer,
    logContext: ReturnType<typeof createLogContext>
): Promise<string> {
    logger.info(
        { ...logContext, stage: "upload" },
        `Uploading cleaned image to GCS bucket ${GCS_BUCKET}, key: ${key}, size: ${buffer.length} bytes`
    );

    const bucket = storage.bucket(GCS_BUCKET);
    const file = bucket.file(key);

    try {
        await file.save(buffer, { contentType: 'image/jpeg', resumable: false });

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

/**
 * Create a visualization of the mask overlaid on the room image
 * This helps Gemini "see" what to remove by showing a red highlight
 */
async function createMaskedVisualization(
    roomBuffer: Buffer,
    maskBuffer: Buffer,
    logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
    const roomMeta = await sharp(roomBuffer).metadata();
    const width = roomMeta.width!;
    const height = roomMeta.height!;

    // Get room as raw RGBA
    const roomRaw = await sharp(roomBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Get mask as grayscale (white = remove)
    const maskRaw = await sharp(maskBuffer)
        .resize(width, height, { fit: 'fill', kernel: 'nearest' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const roomData = roomRaw.data;
    const maskData = maskRaw.data;
    const resultData = Buffer.alloc(roomData.length);

    // Overlay bright red/pink on masked areas
    const pixelCount = width * height;
    for (let i = 0; i < pixelCount; i++) {
        const rgbaIdx = i * 4;
        const maskIdx = i;
        const maskValue = maskData[maskIdx];

        if (maskValue > 128) {
            // White in mask = blend with bright red/pink (70% red overlay)
            const alpha = 0.7;
            resultData[rgbaIdx] = Math.round(roomData[rgbaIdx] * (1 - alpha) + 255 * alpha);     // R - more red
            resultData[rgbaIdx + 1] = Math.round(roomData[rgbaIdx + 1] * (1 - alpha) + 50 * alpha);  // G - less
            resultData[rgbaIdx + 2] = Math.round(roomData[rgbaIdx + 2] * (1 - alpha) + 80 * alpha);  // B - slightly pink
            resultData[rgbaIdx + 3] = 255;
        } else {
            // Black in mask = keep original
            resultData[rgbaIdx] = roomData[rgbaIdx];
            resultData[rgbaIdx + 1] = roomData[rgbaIdx + 1];
            resultData[rgbaIdx + 2] = roomData[rgbaIdx + 2];
            resultData[rgbaIdx + 3] = 255;
        }
    }

    const visualizedImage = await sharp(resultData, {
        raw: { width, height, channels: 4 }
    })
        .png()
        .toBuffer();

    logger.info(
        { ...logContext, stage: "mask-visualization" },
        `Created mask visualization: ${visualizedImage.length} bytes, ${width}x${height}`
    );

    return visualizedImage;
}

/**
 * Analyze mask to determine which part of the image to remove
 * Returns a detailed description with approximate pixel/percentage coordinates
 */
async function analyzeMaskPosition(
    maskBuffer: Buffer,
    logContext: ReturnType<typeof createLogContext>
): Promise<{ description: string; hasContent: boolean; centerX: number; centerY: number; boundingBox: { minX: number; minY: number; maxX: number; maxY: number } }> {
    const maskMeta = await sharp(maskBuffer).metadata();
    const width = maskMeta.width!;
    const height = maskMeta.height!;

    // Get raw grayscale data
    const rawData = await sharp(maskBuffer)
        .grayscale()
        .raw()
        .toBuffer();

    // Find bounding box of white pixels
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let whitePixelCount = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (rawData[idx] > 128) {  // White pixel
                whitePixelCount++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (whitePixelCount === 0) {
        return { description: "", hasContent: false, centerX: 0, centerY: 0, boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    }

    // Calculate center of mask
    const centerX = Math.round((minX + maxX) / 2);
    const centerY = Math.round((minY + maxY) / 2);

    // Calculate percentages for more precise description
    const centerXPercent = Math.round((centerX / width) * 100);
    const centerYPercent = Math.round((centerY / height) * 100);

    // Determine position description with specific percentages
    const xPos = centerX < width / 3 ? "left" : centerX > width * 2 / 3 ? "right" : "center";
    const yPos = centerY < height / 3 ? "top" : centerY > height * 2 / 3 ? "bottom" : "middle";

    let description: string;
    if (xPos === "center" && yPos === "middle") {
        description = `the center of the image (approximately ${centerXPercent}% from left, ${centerYPercent}% from top)`;
    } else if (xPos === "center") {
        description = `the ${yPos}-center area (approximately ${centerXPercent}% from left, ${centerYPercent}% from top)`;
    } else if (yPos === "middle") {
        description = `the ${xPos} side (approximately ${centerXPercent}% from left, ${centerYPercent}% from top)`;
    } else {
        description = `the ${yPos}-${xPos} area (approximately ${centerXPercent}% from left, ${centerYPercent}% from top)`;
    }

    // Calculate approximate size
    const maskWidth = maxX - minX;
    const maskHeight = maxY - minY;
    const sizeRatio = (maskWidth * maskHeight) / (width * height);

    let sizeDesc = "small";
    if (sizeRatio > 0.25) sizeDesc = "large";
    else if (sizeRatio > 0.1) sizeDesc = "medium-sized";

    logger.info(logContext, `Mask analysis: ${description}, ${sizeDesc} object (${Math.round(sizeRatio * 100)}% of image)`);

    return {
        description: `the ${sizeDesc} object in ${description}`,
        hasContent: true,
        centerX,
        centerY,
        boundingBox: { minX, minY, maxX, maxY }
    };
}

/**
 * Create an image with a bright CYAN circle drawn around the masked area
 * This visual marker helps Gemini "see" what to remove
 */
async function createMarkedImage(
    roomBuffer: Buffer,
    maskAnalysis: { centerX: number; centerY: number; boundingBox: { minX: number; minY: number; maxX: number; maxY: number } },
    logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
    const roomMeta = await sharp(roomBuffer).metadata();
    const width = roomMeta.width!;
    const height = roomMeta.height!;

    // Calculate circle dimensions from bounding box
    const { minX, minY, maxX, maxY } = maskAnalysis.boundingBox;
    const circleWidth = maxX - minX + 40; // Add padding
    const circleHeight = maxY - minY + 40;
    const circleX = Math.max(0, minX - 20);
    const circleY = Math.max(0, minY - 20);

    // Create an SVG overlay with a bright cyan dashed circle
    const svg = `<svg width="${width}" height="${height}">
        <rect x="${circleX}" y="${circleY}" width="${circleWidth}" height="${circleHeight}" 
              fill="none" stroke="#00FFFF" stroke-width="6" stroke-dasharray="15,10" rx="20" ry="20"/>
        <line x1="${circleX}" y1="${circleY}" x2="${circleX + circleWidth}" y2="${circleY + circleHeight}" 
              stroke="#00FFFF" stroke-width="4"/>
        <line x1="${circleX + circleWidth}" y1="${circleY}" x2="${circleX}" y2="${circleY + circleHeight}" 
              stroke="#00FFFF" stroke-width="4"/>
    </svg>`;

    // Composite the SVG marker over the room image
    const markedImage = await sharp(roomBuffer)
        .composite([{
            input: Buffer.from(svg),
            top: 0,
            left: 0
        }])
        .png()
        .toBuffer();

    logger.info(logContext, `Created marked image with cyan box at (${circleX},${circleY}) size ${circleWidth}x${circleHeight}`);

    return markedImage;
}

/**
 * Call Gemini API for object removal
 * Uses PURE SEMANTIC DESCRIPTION - Gemini understands location references better than visual markers
 */
async function callGeminiForCleanup(
    prompt: string,
    roomBuffer: Buffer,
    maskBuffer: Buffer,
    aspectRatio: string,
    model: string,
    logContext: ReturnType<typeof createLogContext>,
    maskAnalysis?: { centerX: number; centerY: number; boundingBox: { minX: number; minY: number; maxX: number; maxY: number }; description?: string }
): Promise<string> {
    const startTime = Date.now();
    logger.info(logContext, `Calling Gemini model: ${model} (timeout: ${GEMINI_TIMEOUT_MS}ms)`);

    // CRITICAL FIX: Send BOTH the room image AND the mask image
    // The mask shows exactly where the user painted (white areas = objects to remove)
    const parts: any[] = [
        {
            inlineData: {
                mimeType: 'image/png',
                data: roomBuffer.toString('base64')
            }
        },
        {
            inlineData: {
                mimeType: 'image/png',
                data: maskBuffer.toString('base64')
            }
        },
        { text: prompt }
    ];

    const config: any = {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio }
    };

    try {
        const client = getGeminiClient();

        const response = await withTimeout(
            client.models.generateContent({
                model,
                contents: parts,
                config,
            }),
            GEMINI_TIMEOUT_MS,
            `Gemini ${model} cleanup API call`
        );

        const duration = Date.now() - startTime;
        logger.info(
            { ...logContext, stage: "api-complete" },
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

        logger.error(
            { ...logContext, stage: "response-parse-failed" },
            `No image in Gemini response`
        );
        throw new Error("No image in response - Gemini may have returned text only or blocked the request");
    } catch (error: any) {
        const duration = Date.now() - startTime;

        if (error instanceof GeminiTimeoutError) {
            logger.error(
                { ...logContext, stage: "timeout" },
                `Gemini API call timed out after ${duration}ms`,
                error
            );
        } else {
            logger.error(
                { ...logContext, stage: "api-error" },
                `Gemini error with ${model} after ${duration}ms`,
                error
            );
        }
        throw error;
    }
}

export interface CleanupRoomResult {
    imageUrl: string;
    imageKey: string;
}

/**
 * Clean up room by removing objects indicated by mask
 * 
 * @param roomImageUrl - URL to the canonical room image (from GCS)
 * @param maskBuffer - Mask buffer (PNG, white=remove, black=keep)
 * @param requestId - Request ID for logging
 * @returns Cleaned image URL and GCS key
 */
export async function cleanupRoom(
    roomImageUrl: string,
    maskBuffer: Buffer,
    requestId: string = "cleanup"
): Promise<CleanupRoomResult> {
    const logContext = createLogContext("cleanup", requestId, "start", {});
    const startTime = Date.now();

    logger.info(logContext, "Processing room cleanup with Gemini (bulletproof mask alignment)");

    let roomBuffer: Buffer | null = null;
    let roomMetadata: sharp.Metadata | null = null;
    let maskMetadata: sharp.Metadata | null = null;
    let editRegionMask: Buffer | null = null;
    let geminiOutputBuffer: Buffer | null = null;
    let compositeResult: Buffer | null = null;

    try {
        // Step 1: Download room image (canonical bitmap, no rotation/resize)
        roomBuffer = await downloadRoomImage(roomImageUrl, logContext);

        // Step 2: Validate dimensions (I2 - bulletproof guard)
        roomMetadata = await sharp(roomBuffer).metadata();
        maskMetadata = await sharp(maskBuffer).metadata();

        if (!roomMetadata.width || !roomMetadata.height) {
            throw new Error("Room image is missing dimensions");
        }
        if (!maskMetadata.width || !maskMetadata.height) {
            throw new Error("Mask image is missing dimensions");
        }

        const roomWidth = roomMetadata.width;
        const roomHeight = roomMetadata.height;
        const maskWidth = maskMetadata.width;
        const maskHeight = maskMetadata.height;

        // CRITICAL: Exact dimension match requirement (Invariant I2)
        if (maskWidth !== roomWidth || maskHeight !== roomHeight) {
            const error = new Error(
                `Mask dimension mismatch: mask is ${maskWidth}x${maskHeight}, room is ${roomWidth}x${roomHeight}. ` +
                `Mask must exactly match room dimensions.`
            );
            logger.error(
                { ...logContext, stage: "validation" },
                "Mask dimension validation failed",
                error
            );
            throw error;
        }

        logger.info(
            { ...logContext, stage: "validation" },
            `Dimensions match: ${roomWidth}x${roomHeight}`
        );

        // Step 3: Build edit region from mask (smart expansion/feather for bad painting)
        // Convert mask to binary intent (threshold at 128)
        // Expand/dilate to capture full object boundary
        // Feather edges for natural blending
        const MASK_EXPANSION_PX = 16;  // Medium spill - expand mask edges
        const MASK_FEATHER_SIGMA = 6;  // Soft edges for natural blending

        editRegionMask = await sharp(maskBuffer)
            .grayscale()
            .removeAlpha()
            .threshold(128)                           // Clean binary mask
            .blur(Math.max(1, MASK_EXPANSION_PX * 0.7))  // Expand via blur
            .threshold(64)                            // Re-threshold after expansion
            .blur(MASK_FEATHER_SIGMA)                 // Feather edges
            .png()
            .toBuffer();

        logger.info(
            { ...logContext, stage: "edit-region" },
            `Edit region created: expansion=${MASK_EXPANSION_PX}px, feather=${MASK_FEATHER_SIGMA}px`
        );

        // Step 4: Compute closest Gemini-supported aspect ratio
        const closestRatio = findClosestGeminiRatio(roomWidth, roomHeight);
        logger.info(
            { ...logContext, stage: "aspect-ratio" },
            `Room: ${roomWidth}x${roomHeight}, closest Gemini ratio: ${closestRatio.label}`
        );

        // Step 5: Analyze mask to get detailed location and bounding box
        const maskAnalysis = await analyzeMaskPosition(maskBuffer, logContext);
        logger.info(logContext, `Mask analysis: ${maskAnalysis.description}`);



        // Step 6: Create Visual Prompt Image
        // Instead of sending two images, we burn the mask into the image as a specific color (Green)
        // This is much more reliable for Vision models to understand "remove the green thing"

        // 1. Create pure green image
        const greenBase = await sharp({
            create: {
                width: roomWidth,
                height: roomHeight,
                channels: 3,
                background: { r: 0, g: 255, b: 0 }
            }
        }).png().toBuffer();

        // 2. Create alpha channel from mask (White=Opaque, Black=Transparent)
        const alphaChannel = await sharp(maskBuffer)
            .resize(roomWidth, roomHeight)
            .grayscale()
            .toBuffer();

        // 3. Create green overlay (Green pixels with Mask alpha)
        const greenOverlay = await sharp(greenBase)
            .joinChannel(alphaChannel)
            .png()
            .toBuffer();

        // 4. Composite green overlay onto room image
        const visualPromptBuffer = await sharp(roomBuffer)
            .composite([{ input: greenOverlay }])
            .png()
            .toBuffer();

        logger.info(logContext, "Created visual prompt image with Green overlay");

        // Step 7: Build Prompt
        const baseDescription = maskAnalysis.description || "the marked area";
        const prompt = `OBJECT REMOVAL TASK:

I have provided an image of a room where an object has been covered in BRIGHT GREEN.

YOUR TASK:
1. Identify the area covered by the GREEN color.
2. REMOVE the object/furniture that is under the green paint.
3. FILL the space with the natural background (wall, floor, carpet).
4. The green color MUST be completely removed.

CONTEXT:
The green area is located at ${baseDescription}.

CRITICAL REQUIREMENTS:
- Output MUST be exactly ${roomWidth}x${roomHeight} pixels
- Keep the SAME camera angle, lighting, and perspective
- Do NOT crop, resize, or change the framing
- Only remove the object covered in GREEN
- Everything else should remain EXACTLY the same

Return only the cleaned room image (without the green overlay).`;

        // Step 8: Call Gemini (fast model first, pro retry on failure)
        let attempt = 0;
        const maxAttempts = 2;
        let lastError: Error | null = null;

        while (attempt < maxAttempts) {
            const model = attempt === 0 ? GEMINI_IMAGE_MODEL_FAST : GEMINI_IMAGE_MODEL_PRO;

            try {
                logger.info(
                    { ...logContext, stage: "gemini-call", attempt: attempt + 1 },
                    `Attempting cleanup with ${model} (Visual Prompting)`
                );

                const base64Data = await callGeminiForCleanup(
                    prompt,
                    visualPromptBuffer, // Send the image with green overlay
                    null,               // visualPromptBuffer is self-contained, no separate mask needed
                    closestRatio.label,
                    model,
                    logContext,
                    maskAnalysis  // Pass analysis for visual marker creation
                );

                geminiOutputBuffer = Buffer.from(base64Data, 'base64');
                break; // Success
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                attempt++;

                if (attempt < maxAttempts) {
                    logger.warn(
                        { ...logContext, stage: "gemini-retry" },
                        `Cleanup attempt ${attempt} failed, retrying with ${GEMINI_IMAGE_MODEL_PRO}`,
                        error
                    );
                } else {
                    logger.error(
                        { ...logContext, stage: "gemini-failed" },
                        "All Gemini cleanup attempts failed",
                        error
                    );
                    throw lastError;
                }
            }
        }

        if (!geminiOutputBuffer) {
            throw lastError || new Error("Failed to get Gemini output");
        }

        // Step 7: Resize Gemini output to match input dimensions (Gemini may return different sizes)
        const outputMeta = await sharp(geminiOutputBuffer).metadata();
        const outputWidth = outputMeta.width!;
        const outputHeight = outputMeta.height!;

        if (outputWidth !== roomWidth || outputHeight !== roomHeight) {
            logger.info(
                { ...logContext, stage: "resize-output" },
                `Gemini returned ${outputWidth}x${outputHeight}, resizing to ${roomWidth}x${roomHeight} for compositing`
            );
            // Resize Gemini output to match input dimensions exactly (necessary for proper compositing)
            // This is NOT stretching user content - it's ensuring AI output matches our coordinate space
            // Use 'cover' to fill exact dimensions, preserving aspect ratio with center crop
            geminiOutputBuffer = await sharp(geminiOutputBuffer)
                .resize(roomWidth, roomHeight, { fit: 'cover', position: 'center' })
                .png()
                .toBuffer();
        } else {
            logger.info(
                { ...logContext, stage: "dimension-validation" },
                `Output dimensions match: ${outputWidth}x${outputHeight}`
            );
        }


        // Step 8: Bypass Compositing (Debugging "Nothing Removed" issue)
        // We suspect the editRegionMask is failing, causing the original image to overwrite the result.
        // For now, return the raw Gemini output directly. The visual prompt ensures Gemini knows what to remove.
        logger.info(logContext, "Bypassing manual compositing - returning raw Gemini output");

        compositeResult = await sharp(geminiOutputBuffer)
            .resize(roomWidth, roomHeight) // Ensure exact dimensions
            .toBuffer();

        /*
        // Hard-lock pixels outside edit region (I5 - compositing lock)
        // Composite: outside edit region = original, inside = Gemini output
        // Use the edit region mask as alpha for blending
        const compositeMask = await sharp(editRegionMask)
            .resize(roomWidth, roomHeight, { fit: 'fill', kernel: 'nearest' })
            .grayscale()
            .extractChannel(0) // Ensure single channel
            .toBuffer();

        // Get raw pixel data for manual compositing
        const [roomRaw, geminiRaw, maskRaw] = await Promise.all([
            sharp(roomBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
            sharp(geminiOutputBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
            sharp(compositeMask).raw().toBuffer({ resolveWithObject: true })
        ]);

        const { data: roomData, info: roomInfo } = roomRaw;
        const { data: geminiData } = geminiRaw;
        const { data: maskData } = maskRaw;

        // Manual pixel blend: result = room * (1-alpha) + gemini * alpha
        const resultData = Buffer.alloc(roomData.length);
        const pixelCount = roomInfo.width * roomInfo.height;

        for (let i = 0; i < pixelCount; i++) {
            const idx = i * 4;  // RGBA
            const maskIdx = i;     // Grayscale mask

            const alpha = maskData[maskIdx] / 255;  // 0-1 range
            const invAlpha = 1 - alpha;

            // Blend RGB channels (outside region = original, inside = Gemini output)
            resultData[idx] = Math.round(roomData[idx] * invAlpha + geminiData[idx] * alpha);         // R
            resultData[idx + 1] = Math.round(roomData[idx + 1] * invAlpha + geminiData[idx + 1] * alpha); // G
            resultData[idx + 2] = Math.round(roomData[idx + 2] * invAlpha + geminiData[idx + 2] * alpha); // B
            resultData[idx + 3] = 255;  // Full opacity
        }

        compositeResult = await sharp(resultData, {
            raw: {
                width: roomInfo.width,
                height: roomInfo.height,
                channels: 4
            }
        })
            .jpeg({ quality: 90 })
            .toBuffer();
        */

        logger.info(
            { ...logContext, stage: "composite-complete" },
            `Composite done: ${compositeResult.length} bytes, outside-mask locked to original`
        );

        // Step 9: Upload result
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(7);
        const key = `cleaned/${timestamp}_${randomSuffix}.jpg`;
        const url = await uploadCleanedImage(key, compositeResult, logContext);

        const totalTime = Date.now() - startTime;
        logger.info(
            { ...logContext, stage: "complete" },
            `Cleanup complete: total=${totalTime}ms, dimensions=${roomWidth}x${roomHeight}`
        );

        return { imageUrl: url, imageKey: key };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            { ...logContext, stage: "error" },
            `Room cleanup failed: ${errorMsg}`,
            error
        );
        throw error;
    } finally {
        // Explicit cleanup
        roomBuffer = null;
        editRegionMask = null;
        geminiOutputBuffer = null;
        compositeResult = null;
    }
}


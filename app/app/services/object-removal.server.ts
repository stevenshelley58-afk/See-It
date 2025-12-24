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

    // Prodia settings - using SDXL for best quality/speed balance
    INPAINT_MODEL: "inference.sdxl.inpainting.v1",  // SDXL is more stable than Flux for realistic inpainting
    INPAINT_STEPS: 25,          // SDXL needs more steps (20-30 recommended)
    INPAINT_PROMPT: "clean empty room background, seamless natural fill, photorealistic, match surrounding textures and lighting",
    NEGATIVE_PROMPT: "artifacts, distortion, blurry, low quality, unrealistic, cartoon, anime, painting",

    // Limits - keep at 1024 for SDXL (optimal resolution)
    MAX_IMAGE_DIMENSION: 1024,  // SDXL works best at 1024x1024
    MIN_MASK_COVERAGE: 0.0,     // Allow ultra-small touch-ups (validation happens via white pixel count)
    MAX_MASK_COVERAGE: 0.8,     // 80% maximum - something's wrong if more
};

const PRODIA_POLL_INTERVAL_MS = 750;
const PRODIA_MAX_POLL_MS = 30000;

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

function extractProdiaOutputUrl(job: any): string | null {
    if (!job || typeof job !== "object") return null;

    const candidates = [
        job.output,
        job.output_url,
        job.image_url,
        job.imageUrl,
        job.result?.output,
        job.result?.output_url,
        job.result?.image_url,
        job.result?.imageUrl,
        job.job?.output,
        job.job?.output_url,
        job.job?.image_url,
        job.job?.imageUrl,
        job.job?.result?.output,
        job.job?.result?.output_url,
        job.job?.result?.image_url,
        job.job?.result?.imageUrl,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.startsWith("http")) {
            return candidate;
        }
        if (Array.isArray(candidate) && typeof candidate[0] === "string" && candidate[0].startsWith("http")) {
            return candidate[0];
        }
        if (candidate && typeof candidate === "object") {
            const url = candidate.url || candidate.image_url || candidate.imageUrl;
            if (typeof url === "string" && url.startsWith("http")) {
                return url;
            }
        }
    }

    return null;
}

function extractProdiaJobId(job: any): string | null {
    if (!job || typeof job !== "object") return null;

    const id = job.id || job.jobId || job.job_id || job.job?.id || job.job?.jobId || job.job?.job_id;
    return typeof id === "string" ? id : id ? String(id) : null;
}

async function downloadProdiaOutput(url: string, logContext: ReturnType<typeof createLogContext>): Promise<Buffer> {
    logger.info(
        { ...logContext, stage: "prodia-output-download" },
        `Downloading Prodia output: ${url.substring(0, 80)}...`
    );

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download Prodia output: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

async function pollProdiaJob(jobId: string, logContext: ReturnType<typeof createLogContext>): Promise<Buffer> {
    const apiToken = process.env.PRODIA_API_TOKEN;
    if (!apiToken) {
        throw new Error("PRODIA_API_TOKEN environment variable is not set");
    }

    const deadline = Date.now() + PRODIA_MAX_POLL_MS;
    let attempt = 0;

    while (Date.now() < deadline) {
        attempt += 1;
        const response = await fetch(`${PRODIA_API_URL}/${jobId}`, {
            headers: {
                "Authorization": `Bearer ${apiToken}`,
                "Accept": "application/json",
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            throw new Error(`Prodia job status error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const status = String(data.status || data.job?.status || "").toLowerCase();

        logger.info(
            { ...logContext, stage: "prodia-job-status" },
            `Prodia job ${jobId} status: ${status || "unknown"} (attempt ${attempt})`
        );

        if (status === "succeeded" || status === "success" || status === "completed") {
            const outputUrl = extractProdiaOutputUrl(data);
            if (!outputUrl) {
                throw new Error("Prodia job completed without output URL");
            }
            return downloadProdiaOutput(outputUrl, logContext);
        }

        if (status === "failed" || status === "error" || status === "canceled") {
            const reason = data.error || data.message || data.job?.error || "Unknown error";
            throw new Error(`Prodia job failed: ${reason}`);
        }

        await new Promise(resolve => setTimeout(resolve, PRODIA_POLL_INTERVAL_MS));
    }

    throw new Error(`Prodia job timed out after ${PRODIA_MAX_POLL_MS}ms`);
}

function extractImageFromMultipart(responseBuffer: Buffer, contentType: string): Buffer {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
        throw new Error("No boundary found in multipart response");
    }

    const boundary = boundaryMatch[1].trim().replace(/^\"|\"$/g, "");
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const parts: Buffer[] = [];
    let start = 0;
    let idx = responseBuffer.indexOf(boundaryBuffer, start);

    while (idx !== -1) {
        if (start > 0) {
            parts.push(responseBuffer.slice(start, idx - 2));
        }
        start = idx + boundaryBuffer.length + 2;
        idx = responseBuffer.indexOf(boundaryBuffer, start);
    }

    for (const part of parts) {
        const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
        if (headerEnd === -1) continue;
        const headerText = part.toString("utf8", 0, Math.min(headerEnd, 500));
        if (headerText.includes("image/")) {
            const body = part.slice(headerEnd + 4);
            if (body.length === 0) {
                continue;
            }
            return body;
        }
    }

    throw new Error("No image part found in multipart response");
}

async function resolveProdiaJobResult(jobResult: any, logContext: ReturnType<typeof createLogContext>): Promise<Buffer> {
    const directUrl = extractProdiaOutputUrl(jobResult);
    if (directUrl) {
        return downloadProdiaOutput(directUrl, logContext);
    }

    const jobId = extractProdiaJobId(jobResult);
    if (!jobId) {
        throw new Error("Prodia job response missing job id/output URL");
    }

    return pollProdiaJob(jobId, logContext);
}

/**
 * Process mask: expand, feather, and ensure correct dimensions
 * OPTIMIZED: Combined pipeline, single-pass coverage calculation
 */
async function processMask(
    maskBuffer: Buffer,
    targetWidth: number,
    targetHeight: number,
    options: { expansionPx: number; featherSigma: number },
    logContext: ReturnType<typeof createLogContext>
): Promise<{ processedMask: Buffer; coveragePercent: number; whitePixels: number }> {
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

    // PERFORMANCE: Build single combined Sharp pipeline
    let pipeline = sharp(maskBuffer);

    // Step 1: Resize mask to match image dimensions if needed
    if (maskMeta.width !== targetWidth || maskMeta.height !== targetHeight) {
        logger.info(
            { ...logContext, stage: "mask-resize" },
            `Resizing mask from ${maskMeta.width}x${maskMeta.height} to ${targetWidth}x${targetHeight}`
        );
        pipeline = pipeline.resize(targetWidth, targetHeight, {
            fit: 'fill',
            kernel: 'nearest'  // Preserve hard edges during resize
        });
    }

    // Step 2: Flatten onto black background, then convert to grayscale
    // This ensures white strokes on transparent background are preserved
    // (transparent areas become black, white strokes stay white)
    pipeline = pipeline.flatten({ background: { r: 0, g: 0, b: 0 } }).grayscale();

    // Step 3: Threshold to binary (ensure pure black/white)
    pipeline = pipeline.threshold(CONFIG.MASK_THRESHOLD);

    // Step 4: Expand mask (dilate) using blur + threshold trick
    if (expansionPx > 0) {
        const dilateBlur = Math.max(1, Math.round(expansionPx * 0.7));
        pipeline = pipeline.blur(dilateBlur).threshold(64);
    }

    // Step 5: Feather edges with Gaussian blur
    if (featherSigma > 0) {
        pipeline = pipeline.blur(featherSigma);
    }

    // PERFORMANCE: Get raw data and PNG in single pipeline execution
    // This avoids re-decoding the image for coverage calculation
    const rawResult = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const { data: rawData, info } = rawResult;
    const totalPixels = info.width * info.height;

    // PERFORMANCE: Single-pass coverage calculation with early termination optimization
    // Use Uint32Array view for faster iteration (4x fewer iterations)
    let whitePixels = 0;
    const dataLength = rawData.length;

    // Process 4 bytes at a time when possible
    const remainder = dataLength % 4;
    const alignedLength = dataLength - remainder;

    for (let i = 0; i < alignedLength; i += 4) {
        if (rawData[i] > 128) whitePixels++;
        if (rawData[i + 1] > 128) whitePixels++;
        if (rawData[i + 2] > 128) whitePixels++;
        if (rawData[i + 3] > 128) whitePixels++;
    }

    // Handle remaining bytes
    for (let i = alignedLength; i < dataLength; i++) {
        if (rawData[i] > 128) whitePixels++;
    }

    const coveragePercent = (whitePixels / totalPixels) * 100;

    // PERFORMANCE: Convert raw to PNG only after coverage calculation
    // This is more efficient than decoding PNG twice
    const finalMaskBuffer = await sharp(rawData, {
        raw: {
            width: info.width,
            height: info.height,
            channels: info.channels as 1 | 2 | 3 | 4
        }
    }).png().toBuffer();

    logger.info(
        { ...logContext, stage: "mask-process-complete" },
        `Mask processed: coverage=${coveragePercent.toFixed(2)}%, white=${whitePixels}/${totalPixels}`
    );

    return { processedMask: finalMaskBuffer, coveragePercent, whitePixels };
}

/**
 * Call Prodia API for inpainting using SDXL model
 * 
 * Uses inference.sdxl.inpainting.v1 - best balance of speed and quality for realistic photos
 * SDXL is more stable than Flux for photorealistic inpainting
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

    // Use SDXL inpainting - best for realistic photo inpainting
    const jobConfig = JSON.stringify({
        type: CONFIG.INPAINT_MODEL,
        config: {
            prompt: CONFIG.INPAINT_PROMPT,
            negative_prompt: CONFIG.NEGATIVE_PROMPT,
            steps: CONFIG.INPAINT_STEPS,
            cfg_scale: 7,  // Guidance scale for SDXL
        }
    });

    // Construct multipart body
    // NOTE: Both image and mask use "input" as the field name
    const parts: Buffer[] = [];

    // Job config part
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="job"; filename="job.json"\r\n` +
        `Content-Type: application/json\r\n\r\n`
    ));
    parts.push(Buffer.from(jobConfig));
    parts.push(Buffer.from('\r\n'));

    // Image input part - the source image (first input)
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="input"; filename="image.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
    ));
    parts.push(imageBuffer);
    parts.push(Buffer.from('\r\n'));

    // Mask input part - areas to inpaint (second input)
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
        `Calling Prodia API (body: ${body.length} bytes, model: ${CONFIG.INPAINT_MODEL})`
    );

    const response = await fetch(PRODIA_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Accept": "multipart/form-data; image/png",
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

    const contentType = response.headers.get("content-type") || "";
    const responseBuffer = Buffer.from(await response.arrayBuffer());

    if (contentType.includes("application/json")) {
        let jobResult: any;
        try {
            jobResult = JSON.parse(responseBuffer.toString("utf8"));
        } catch (parseError) {
            logger.error(
                { ...logContext, stage: "prodia-json-parse" },
                "Failed to parse JSON response from Prodia",
                parseError
            );
            throw new Error("Prodia returned JSON but parsing failed");
        }

        logger.info(
            { ...logContext, stage: "prodia-job-created" },
            `Prodia job response received`
        );
        return resolveProdiaJobResult(jobResult, logContext);
    }

    if (contentType.includes("multipart")) {
        return extractImageFromMultipart(responseBuffer, contentType);
    }

    return responseBuffer;
}

async function compositeWithMask(
    baseBuffer: Buffer,
    inpaintBuffer: Buffer,
    maskBuffer: Buffer,
    logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
    const [baseRaw, inpaintRaw] = await Promise.all([
        sharp(baseBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(inpaintBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);

    const { data: baseData, info: baseInfo } = baseRaw;
    const { data: inpaintData, info: inpaintInfo } = inpaintRaw;

    if (baseInfo.width !== inpaintInfo.width || baseInfo.height !== inpaintInfo.height) {
        throw new Error(`Composite size mismatch: base=${baseInfo.width}x${baseInfo.height}, inpaint=${inpaintInfo.width}x${inpaintInfo.height}`);
    }

    const maskPrepared = await sharp(maskBuffer)
        .resize(baseInfo.width, baseInfo.height, { fit: "fill", kernel: "nearest" })
        .grayscale()
        .extractChannel(0)
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { data: maskData } = maskPrepared;

    const resultData = Buffer.alloc(baseData.length);
    const pixelCount = baseInfo.width * baseInfo.height;

    for (let i = 0; i < pixelCount; i++) {
        const idx = i * 4;
        const alpha = maskData[i] / 255;
        const invAlpha = 1 - alpha;

        resultData[idx] = Math.round(baseData[idx] * invAlpha + inpaintData[idx] * alpha);
        resultData[idx + 1] = Math.round(baseData[idx + 1] * invAlpha + inpaintData[idx + 1] * alpha);
        resultData[idx + 2] = Math.round(baseData[idx + 2] * invAlpha + inpaintData[idx + 2] * alpha);
        resultData[idx + 3] = 255;
    }

    logger.info(
        { ...logContext, stage: "composite" },
        `Composite complete: ${baseInfo.width}x${baseInfo.height}`
    );

    return sharp(resultData, {
        raw: {
            width: baseInfo.width,
            height: baseInfo.height,
            channels: 4
        }
    })
        .png()
        .toBuffer();
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
        // PERFORMANCE: Single pipeline for metadata + resize + format conversion
        const imageMeta = await sharp(imageBuffer).metadata();
        let width = imageMeta.width ?? 0;
        let height = imageMeta.height ?? 0;

        logger.info(
            { ...logContext, stage: "image-metadata" },
            `Source image: ${width}x${height}, format=${imageMeta.format}`
        );

        // PERFORMANCE: Build single pipeline for all image transformations
        // IMPORTANT: .rotate() with no args auto-orients based on EXIF and removes the tag
        // This fixes rotation issues with phone photos that have EXIF orientation metadata
        let imagePipeline = sharp(imageBuffer).rotate();
        const needsResize = width > CONFIG.MAX_IMAGE_DIMENSION || height > CONFIG.MAX_IMAGE_DIMENSION;

        if (needsResize) {
            logger.info(
                { ...logContext, stage: "image-resize" },
                `Resizing image from ${width}x${height} to fit ${CONFIG.MAX_IMAGE_DIMENSION}px`
            );
            imagePipeline = imagePipeline.resize(CONFIG.MAX_IMAGE_DIMENSION, CONFIG.MAX_IMAGE_DIMENSION, {
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        // Always ensure PNG format in single pipeline pass
        const prepared = await imagePipeline.png().toBuffer({ resolveWithObject: true });
        const preparedImage = prepared.data;
        width = prepared.info.width;
        height = prepared.info.height;

        // Step 2: Process mask (resize, expand, feather)
        const { processedMask, coveragePercent, whitePixels } = await processMask(
            maskBuffer,
            width,
            height,
            { expansionPx, featherSigma },
            logContext
        );

        // Validate mask coverage (CONFIG values are decimals, coveragePercent is 0-100)
        const minCoveragePercent = CONFIG.MIN_MASK_COVERAGE * 100;
        const maxCoveragePercent = CONFIG.MAX_MASK_COVERAGE * 100;
        
        if (coveragePercent < minCoveragePercent) {
            logger.warn(
                { ...logContext, stage: "mask-validation" },
                `Mask coverage below recommended threshold: ${coveragePercent.toFixed(4)}% (min ${minCoveragePercent}%). Continuing anyway.`
            );
        }

        if (coveragePercent > maxCoveragePercent) {
            logger.warn(
                { ...logContext, stage: "mask-validation" },
                `Mask coverage suspiciously high: ${coveragePercent.toFixed(2)}% > ${maxCoveragePercent}%`
            );
        }

        if (whitePixels === 0) {
            throw new Error("Mask is empty - draw over the area you want to erase.");
        }

        // Step 3: Call Prodia for inpainting
        const resultBuffer = await callProdiaInpaint(preparedImage, processedMask, logContext);

        // Ensure Prodia output aligns to prepared dimensions
        let alignedInpaint = resultBuffer;
        const inpaintMeta = await sharp(resultBuffer).metadata();
        if (inpaintMeta.width !== width || inpaintMeta.height !== height) {
            logger.warn(
                { ...logContext, stage: "inpaint-resize" },
                `Prodia output size mismatch: ${inpaintMeta.width}x${inpaintMeta.height} -> ${width}x${height}`
            );
            alignedInpaint = await sharp(resultBuffer)
                .resize(width, height, { fit: "fill" })
                .png()
                .toBuffer();
        }

        let baseForComposite = preparedImage;
        let maskForComposite = processedMask;
        let outputWidth = width;
        let outputHeight = height;

        // Restore original resolution if we had to downscale for Prodia
        if (needsResize) {
            const fullRes = await sharp(imageBuffer)
                .rotate()
                .png()
                .toBuffer({ resolveWithObject: true });

            baseForComposite = fullRes.data;
            outputWidth = fullRes.info.width;
            outputHeight = fullRes.info.height;

            alignedInpaint = await sharp(alignedInpaint)
                .resize(outputWidth, outputHeight, { fit: "fill" })
                .png()
                .toBuffer();

            maskForComposite = await sharp(processedMask)
                .resize(outputWidth, outputHeight, { fit: "fill", kernel: "nearest" })
                .png()
                .toBuffer();

            logger.info(
                { ...logContext, stage: "restore-resolution" },
                `Upscaled inpaint + mask to original resolution ${outputWidth}x${outputHeight}`
            );
        }

        const finalBuffer = await compositeWithMask(
            baseForComposite,
            alignedInpaint,
            maskForComposite,
            logContext
        );

        const processingTimeMs = Date.now() - startTime;

        logger.info(
            { ...logContext, stage: "complete" },
            `Object removal complete: time=${processingTimeMs}ms, coverage=${coveragePercent.toFixed(2)}%, dimensions=${outputWidth}x${outputHeight}, output=${finalBuffer.length} bytes`
        );

        return {
            imageBuffer: finalBuffer,
            processingTimeMs,
            maskCoveragePercent: coveragePercent,
            imageDimensions: { width: outputWidth, height: outputHeight }
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

/**
 * Object Removal Service using Prodia API
 *
 * Uses Flux Dev inpainting for high quality results
 * Removes objects from images based on mask (white = remove)
 *
 * Docs: https://docs.prodia.com/job-types/inference-flux-dev-inpainting-v2/
 */

import { logger, createLogContext } from "../utils/logger.server";

const PRODIA_API_URL = "https://inference.prodia.com/v2/job";

export interface ObjectRemovalResult {
    imageBuffer: Buffer;
    processingTimeMs: number;
}

/**
 * Remove objects from an image using Prodia Flux Dev inpainting
 *
 * @param imageBuffer - Buffer of the source image
 * @param maskBuffer - Buffer of the mask (white = areas to remove/inpaint)
 * @param requestId - For logging/tracking
 * @returns Buffer containing the cleaned image
 */
export async function removeObjectsFast(
    imageBuffer: Buffer,
    maskBuffer: Buffer,
    requestId: string = "object-remove"
): Promise<ObjectRemovalResult> {
    const logContext = createLogContext("object-remove", requestId, "start", {});
    const startTime = Date.now();

    const apiToken = process.env.PRODIA_API_TOKEN;
    if (!apiToken) {
        throw new Error("PRODIA_API_TOKEN environment variable is not set");
    }

    logger.info(
        { ...logContext, stage: "start" },
        `Starting Prodia object removal (image: ${imageBuffer.length} bytes, mask: ${maskBuffer.length} bytes)`
    );

    try {
        // Build multipart form data
        const boundary = `----ProdiaBoundary${Date.now()}`;

        // Job config for Flux Dev inpainting (higher quality than Schnell)
        const jobConfig = JSON.stringify({
            type: "inference.flux.dev.inpainting.v2",
            config: {
                prompt: "empty space, clean background that matches the surrounding area, natural seamless fill, photorealistic",
                steps: 25,  // More steps = better quality
                strength: 0.95,  // High strength for object removal
                guidance_scale: 3.5,  // Balanced guidance
            }
        });

        // Construct multipart body
        const parts: Buffer[] = [];

        // Job config part
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="job"; filename="job.json"\r\n` +
            `Content-Type: application/json\r\n\r\n`
        ));
        parts.push(Buffer.from(jobConfig));
        parts.push(Buffer.from('\r\n'));

        // Image input part
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="input"; filename="image.png"\r\n` +
            `Content-Type: image/png\r\n\r\n`
        ));
        parts.push(imageBuffer);
        parts.push(Buffer.from('\r\n'));

        // Mask input part
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
            { ...logContext, stage: "calling-api" },
            `Calling Prodia inpainting API (body size: ${body.length} bytes)...`
        );

        const response = await fetch(PRODIA_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiToken}`,
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Accept": "image/png",
            },
            body,
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(
                { ...logContext, stage: "api-error" },
                `Prodia API error: ${response.status} - ${errorText}`
            );
            throw new Error(`Prodia API error: ${response.status} - ${errorText}`);
        }

        const resultBuffer = Buffer.from(await response.arrayBuffer());
        const processingTimeMs = Date.now() - startTime;

        logger.info(
            { ...logContext, stage: "complete" },
            `Object removal complete in ${processingTimeMs}ms, output: ${resultBuffer.length} bytes`
        );

        return {
            imageBuffer: resultBuffer,
            processingTimeMs,
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
 * Remove objects from an image URL using Prodia
 *
 * @param imageUrl - URL of the source image
 * @param maskDataUrl - Data URL of the mask (base64 PNG, white = areas to remove)
 * @param requestId - For logging/tracking
 */
export async function removeObjectsFromUrl(
    imageUrl: string,
    maskDataUrl: string,
    requestId: string = "object-remove"
): Promise<ObjectRemovalResult> {
    const logContext = createLogContext("object-remove", requestId, "download", {});

    // Download source image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
        throw new Error(`Failed to download source image: ${imageResponse.status}`);
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Parse mask from data URL
    const maskBase64 = maskDataUrl.split(',')[1];
    if (!maskBase64) {
        throw new Error("Invalid mask data URL format");
    }
    const maskBuffer = Buffer.from(maskBase64, 'base64');

    logger.info(
        { ...logContext, stage: "downloaded" },
        `Downloaded image: ${imageBuffer.length} bytes, mask: ${maskBuffer.length} bytes`
    );

    return removeObjectsFast(imageBuffer, maskBuffer, requestId);
}

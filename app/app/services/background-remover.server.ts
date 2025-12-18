/**
 * Fast Background Removal Service using Prodia API
 *
 * - 190ms latency (fastest available)
 * - $0.0025 per image
 * - Uses BiRefNet 2 model
 * - Returns transparent PNG
 *
 * Docs: https://docs.prodia.com/job-types/inference-remove-background-v1/
 */

import { logger, createLogContext } from "../utils/logger.server";

const PRODIA_API_URL = "https://inference.prodia.com/v2/job";

export interface BackgroundRemovalResult {
    imageBuffer: Buffer;  // PNG with transparent background
    processingTimeMs: number;
}

/**
 * Remove background from an image using Prodia API
 *
 * @param imageUrl - URL of the source image
 * @param requestId - For logging/tracking
 * @returns Buffer containing PNG with transparent background
 */
export async function removeBackgroundFast(
    imageUrl: string,
    requestId: string = "bg-remove"
): Promise<BackgroundRemovalResult> {
    const logContext = createLogContext("bg-remove", requestId, "start", {});
    const startTime = Date.now();

    const apiToken = process.env.PRODIA_API_TOKEN;
    if (!apiToken) {
        throw new Error("PRODIA_API_TOKEN environment variable is not set");
    }

    logger.info(
        { ...logContext, stage: "start" },
        `Starting Prodia background removal`
    );

    try {
        // Download the source image first
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to download source image: ${imageResponse.status}`);
        }
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

        logger.info(
            { ...logContext, stage: "downloaded" },
            `Downloaded source image: ${imageBuffer.length} bytes`
        );

        // Build multipart form data
        const boundary = `----ProdiaBoundary${Date.now()}`;
        const jobConfig = JSON.stringify({
            type: "inference.remove-background.v1",
            config: {}
        });

        // Construct multipart body manually for Node.js
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
        const extension = contentType.includes('png') ? 'png' :
                         contentType.includes('webp') ? 'webp' : 'jpg';
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="input"; filename="input.${extension}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`
        ));
        parts.push(imageBuffer);
        parts.push(Buffer.from('\r\n'));

        // End boundary
        parts.push(Buffer.from(`--${boundary}--\r\n`));

        const body = Buffer.concat(parts);

        // Make API request
        logger.info(
            { ...logContext, stage: "calling-api" },
            `Calling Prodia API...`
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
                { ...logContext, stage: "api-error" },
                `Prodia API error: ${response.status} - ${errorText}`
            );
            throw new Error(`Prodia API error: ${response.status} - ${errorText}`);
        }

        // Parse multipart response to extract the PNG
        const responseBuffer = Buffer.from(await response.arrayBuffer());
        const contentTypeHeader = response.headers.get("content-type") || "";

        let resultBuffer: Buffer;

        if (contentTypeHeader.includes("multipart")) {
            // Extract boundary from content-type header
            const boundaryMatch = contentTypeHeader.match(/boundary=([^;]+)/);
            if (!boundaryMatch) {
                throw new Error("No boundary found in multipart response");
            }
            const respBoundary = boundaryMatch[1].trim();

            // Find the PNG part in the multipart response
            const boundaryBuffer = Buffer.from(`--${respBoundary}`);
            const parts = [];
            let start = 0;
            let idx = responseBuffer.indexOf(boundaryBuffer, start);

            while (idx !== -1) {
                if (start > 0) {
                    parts.push(responseBuffer.slice(start, idx - 2)); // -2 for \r\n
                }
                start = idx + boundaryBuffer.length + 2; // +2 for \r\n
                idx = responseBuffer.indexOf(boundaryBuffer, start);
            }

            // Find the part with image/png content
            let pngBuffer: Buffer | null = null;
            for (const part of parts) {
                const partStr = part.toString('utf8', 0, Math.min(500, part.length));
                if (partStr.includes("image/png")) {
                    // Find the empty line that separates headers from body
                    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
                    if (headerEnd !== -1) {
                        pngBuffer = part.slice(headerEnd + 4);
                        break;
                    }
                }
            }

            if (!pngBuffer) {
                throw new Error("No PNG found in multipart response");
            }
            resultBuffer = pngBuffer;
        } else {
            // Direct PNG response
            resultBuffer = responseBuffer;
        }

        const processingTimeMs = Date.now() - startTime;

        logger.info(
            { ...logContext, stage: "complete" },
            `Background removed in ${processingTimeMs}ms, output: ${resultBuffer.length} bytes`
        );

        return {
            imageBuffer: resultBuffer,
            processingTimeMs,
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            { ...logContext, stage: "error" },
            `Background removal failed: ${errorMessage}`,
            error
        );
        throw error;
    }
}

/**
 * Check if the background removal service is available
 */
export function isBackgroundRemoverAvailable(): boolean {
    return !!process.env.PRODIA_API_TOKEN;
}

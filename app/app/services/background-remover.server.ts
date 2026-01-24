/**
 * Background Removal Service using PhotoRoom
 *
 * - Returns transparent PNG
 * - Backed by `PHOTOROOM_API_KEY`
 *
 * Implementation: `photoroomRemoveBackground()` (multipart POST to PhotoRoom)
 */

import { logger, createLogContext } from "../utils/logger.server";
import { photoroomRemoveBackground } from "./photoroom.server";

export interface BackgroundRemovalResult {
    imageBuffer: Buffer;  // PNG with transparent background
    processingTimeMs: number;
}

/**
 * Remove background from an image using PhotoRoom.
 *
 * @param imageUrl - URL of the source image
 * @param requestId - For logging/tracking
 * @returns Buffer containing PNG with transparent background
 */
export async function removeBackgroundFast(
    imageUrl: string,
    requestId: string = "bg-remove"
): Promise<BackgroundRemovalResult> {
    const logContext = createLogContext("prepare", requestId, "start", {});
    const startTime = Date.now();

    const apiKey = process.env.PHOTOROOM_API_KEY;
    if (!apiKey) {
        throw new Error("PHOTOROOM_API_KEY environment variable is not set");
    }

    logger.info(
        { ...logContext, stage: "start" },
        `Starting PhotoRoom background removal`
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

        logger.info({ ...logContext, stage: "calling-api" }, `Calling PhotoRoom API...`);

        const resultBuffer = await photoroomRemoveBackground({
            buffer: imageBuffer,
            contentType,
            requestId,
            mode: "standard",
        });

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
    return !!process.env.PHOTOROOM_API_KEY;
}

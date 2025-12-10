// Grounded SAM service - uses Replicate API for text-prompted segmentation
// This replaces @imgly/background-removal-node for more accurate product isolation

import Replicate from "replicate";
import { logger, createLogContext } from "../utils/logger.server";

// Lazy initialize Replicate client
let replicate: Replicate | null = null;

function getReplicateClient(): Replicate {
    if (!replicate) {
        if (!process.env.REPLICATE_API_TOKEN) {
            throw new Error('REPLICATE_API_TOKEN environment variable is not set');
        }
        replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
        });
        logger.info(
            createLogContext("system", "init", "replicate-client", {}),
            "Replicate client initialized"
        );
    }
    return replicate;
}

export interface GroundedSamResult {
    /** Base64 encoded PNG with transparent background */
    imageBase64: string;
    /** Detected bounding boxes for the prompt */
    boundingBoxes?: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * Use Grounded SAM to segment a specific object from an image based on text prompt
 *
 * @param imageUrl - URL of the source image (must be publicly accessible)
 * @param prompt - Text description of what to segment (e.g., "Mirror", "Snowboard")
 * @param requestId - Request ID for logging
 * @returns Base64 encoded PNG with the segmented object on transparent background
 */
export async function segmentWithGroundedSam(
    imageUrl: string,
    prompt: string,
    requestId: string = "grounded-sam"
): Promise<GroundedSamResult> {
    const logContext = createLogContext("segment", requestId, "start", { prompt });

    logger.info(logContext, `Starting Grounded SAM segmentation with prompt: "${prompt}"`);

    const client = getReplicateClient();

    try {
        // Call Grounded SAM on Replicate
        // Model: schananas/grounded_sam
        // This model combines GroundingDINO (text -> bounding box) + SAM (bounding box -> mask)
        const output = await client.run(
            "schananas/grounded_sam:ee871c19efb1941f55f66a3f2ef7a6b8fcd7a0721eba89c85ce3de57c7e6b0b5",
            {
                input: {
                    image: imageUrl,
                    prompt: prompt,
                    // Use high thresholds for precise detection
                    box_threshold: 0.25,
                    text_threshold: 0.25,
                    // Return the masked image (product on transparent background)
                    output_format: "png",
                }
            }
        );

        logger.info(
            { ...logContext, stage: "api-complete" },
            `Grounded SAM API call completed`
        );

        // The output structure from grounded_sam can vary
        // It typically returns an object with 'output_image' or similar
        let outputUrl: string | null = null;

        if (typeof output === 'string') {
            // Direct URL string
            outputUrl = output;
        } else if (Array.isArray(output) && output.length > 0) {
            // Array of URLs - take the first one (usually the masked output)
            outputUrl = output[0];
        } else if (output && typeof output === 'object') {
            // Object with output_image or similar field
            const outputObj = output as Record<string, unknown>;
            outputUrl = (outputObj.output_image || outputObj.image || outputObj.result) as string;
        }

        if (!outputUrl) {
            logger.error(
                { ...logContext, stage: "parse-error" },
                `Unexpected output format from Grounded SAM`,
                { output }
            );
            throw new Error("No output image returned from Grounded SAM");
        }

        logger.info(
            { ...logContext, stage: "download" },
            `Downloading segmented image from: ${outputUrl.substring(0, 80)}...`
        );

        // Download the output image and convert to base64
        const response = await fetch(outputUrl);
        if (!response.ok) {
            throw new Error(`Failed to download segmented image: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const imageBase64 = Buffer.from(arrayBuffer).toString('base64');

        logger.info(
            { ...logContext, stage: "complete" },
            `Grounded SAM segmentation completed, output size: ${arrayBuffer.byteLength} bytes`
        );

        return {
            imageBase64,
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        logger.error(
            { ...logContext, stage: "error" },
            `Grounded SAM segmentation failed: ${errorMessage}`,
            error
        );

        throw error;
    }
}

/**
 * Check if Grounded SAM is available (API token configured)
 */
export function isGroundedSamAvailable(): boolean {
    return !!process.env.REPLICATE_API_TOKEN;
}

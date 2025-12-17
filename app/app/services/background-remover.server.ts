/**
 * Fast Background Removal Service
 *
 * Uses 851-labs/background-remover on Replicate
 * - ~3 seconds per image
 * - ~$0.0005 per image
 * - High accuracy with BiRefNet architecture
 */

import Replicate from "replicate";
import { logger, createLogContext } from "../utils/logger.server";

// Model configuration
const MODEL_ID = "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";

let replicateClient: Replicate | null = null;

function getReplicateClient(): Replicate {
    if (!replicateClient) {
        const token = process.env.REPLICATE_API_TOKEN;
        if (!token) {
            throw new Error("REPLICATE_API_TOKEN environment variable is not set");
        }
        replicateClient = new Replicate({ auth: token });
    }
    return replicateClient;
}

export interface BackgroundRemovalResult {
    imageUrl: string;  // URL to the processed image with transparent background
    processingTimeMs: number;
}

/**
 * Remove background from an image - fast and accurate
 *
 * @param imageUrl - URL of the source image
 * @param requestId - For logging/tracking
 * @returns URL to the processed image with transparent background
 */
export async function removeBackgroundFast(
    imageUrl: string,
    requestId: string = "bg-remove"
): Promise<BackgroundRemovalResult> {
    const logContext = createLogContext("bg-remove", requestId, "start", {});
    const startTime = Date.now();

    logger.info(
        { ...logContext, stage: "start" },
        `Starting fast background removal`
    );

    try {
        const client = getReplicateClient();

        const output = await client.run(MODEL_ID, {
            input: {
                image: imageUrl,
                format: "png",
                background_type: "rgba",  // Transparent background
            }
        });

        const processingTimeMs = Date.now() - startTime;

        // Extract URL from output
        let resultUrl: string;

        if (typeof output === 'string') {
            resultUrl = output;
        } else if (output && typeof output === 'object') {
            // Handle FileOutput object
            const obj = output as Record<string, unknown>;
            if (typeof obj.url === 'function') {
                resultUrl = (obj.url as () => string)();
            } else if (typeof obj.href === 'string') {
                resultUrl = obj.href;
            } else if (typeof obj.url === 'string') {
                resultUrl = obj.url;
            } else {
                const str = String(output);
                if (str.startsWith('http')) {
                    resultUrl = str;
                } else {
                    throw new Error("Could not extract URL from output");
                }
            }
        } else {
            throw new Error("Unexpected output format from background remover");
        }

        logger.info(
            { ...logContext, stage: "complete" },
            `Background removed in ${processingTimeMs}ms`
        );

        return {
            imageUrl: resultUrl,
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
    return !!process.env.REPLICATE_API_TOKEN;
}

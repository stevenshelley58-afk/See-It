/**
 * Flow harness for testing prepare flows
 * 
 * This allows systematic testing of prepare flows with injectable dependencies
 * for simulating failures (CDN, GCS, etc.)
 */

import { prepareProduct } from "../../services/gemini.server";
import prisma from "../../db.server";
import { logger, createLogContext, generateRequestId } from "../../utils/logger.server";

export interface PrepareFlowOptions {
    shopId: string;
    productId: string;
    sourceImageUrl: string;
    assetId?: string;
    simulate?: {
        brokenCdn?: boolean;
        gcsFailure?: boolean;
        dbFailure?: boolean;
        invalidImage?: boolean;
    };
}

export interface PrepareFlowResult {
    success: boolean;
    preparedImageUrl?: string;
    error?: string;
    assetStatus?: string;
    errorMessage?: string;
}

/**
 * Run the prepare flow with optional failure simulation
 * 
 * This calls the same internal functions that the Remix action uses,
 * allowing us to test edge cases without hacking the UI.
 */
export async function runPrepareFlowForProduct(
    options: PrepareFlowOptions
): Promise<PrepareFlowResult> {
    const requestId = generateRequestId();
    const logContext = createLogContext("prepare", requestId, "test-harness", {
        shopId: options.shopId,
        productId: options.productId,
        assetId: options.assetId,
    });

    logger.info(logContext, "Starting prepare flow test");

    try {
        // Simulate broken CDN
        if (options.simulate?.brokenCdn) {
            logger.warn(logContext, "Simulating broken CDN");
            throw new Error("Failed to fetch: 404 Not Found");
        }

        // Simulate invalid image
        if (options.simulate?.invalidImage) {
            logger.warn(logContext, "Simulating invalid image");
            throw new Error("PNG conversion produced empty buffer");
        }

        // Create or get asset
        let assetId = options.assetId;
        if (!assetId) {
            const asset = await prisma.productAsset.create({
                data: {
                    shopId: options.shopId,
                    productId: options.productId,
                    sourceImageId: "test-image-id",
                    sourceImageUrl: options.sourceImageUrl,
                    status: "pending",
                    prepStrategy: "manual",
                    promptVersion: 1,
                    createdAt: new Date(),
                },
            });
            assetId = asset.id;
        }

        // Simulate GCS failure
        if (options.simulate?.gcsFailure) {
            logger.warn(logContext, "Simulating GCS failure");
            // Update asset to failed
            await prisma.productAsset.update({
                where: { id: assetId },
                data: {
                    status: "failed",
                    errorMessage: "Simulated GCS failure",
                },
            });
            throw new Error("Simulated GCS failure");
        }

        // Simulate DB failure
        if (options.simulate?.dbFailure) {
            logger.warn(logContext, "Simulating DB failure");
            // This would fail on the update
            throw new Error("Simulated database connection error");
        }

        // Run actual prepare (this will fail if simulate options are set above)
        const preparedImageUrl = await prepareProduct(
            options.sourceImageUrl,
            options.shopId,
            options.productId,
            assetId,
            requestId
        );

        // Update asset
        const updated = await prisma.productAsset.update({
            where: { id: assetId },
            data: {
                status: "ready",
                preparedImageUrl: preparedImageUrl,
            },
        });

        return {
            success: true,
            preparedImageUrl,
            assetStatus: updated.status,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Try to update asset status
        if (options.assetId) {
            try {
                await prisma.productAsset.update({
                    where: { id: options.assetId },
                    data: {
                        status: "failed",
                        errorMessage: errorMessage.substring(0, 500),
                    },
                });
            } catch (dbError) {
                // Ignore DB errors in test context
            }
        }

        return {
            success: false,
            error: errorMessage,
            assetStatus: "failed",
            errorMessage,
        };
    }
}







import prisma from "../db.server";
import { prepareProduct, compositeScene } from "./gemini.server";
import { logger, createLogContext, generateRequestId } from "../utils/logger.server";
import { StorageService } from "./storage.server";
import { incrementQuota } from "../quota.server";

let processorInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

async function processPendingAssets(batchRequestId: string) {
    try {
        const pendingAssets = await prisma.productAsset.findMany({
            where: { status: "pending" },
            take: 5,
            orderBy: { createdAt: "asc" }
        });

        if (pendingAssets.length > 0) {
            logger.info(
                createLogContext("prepare", batchRequestId, "batch-start-assets", {}),
                `Processing batch of ${pendingAssets.length} pending assets`
            );

            for (const asset of pendingAssets) {
                const itemRequestId = generateRequestId();
                try {
                    // Lock
                    const updated = await prisma.productAsset.updateMany({
                        where: { id: asset.id, status: "pending" },
                        data: { status: "processing", updatedAt: new Date() }
                    });

                    if (updated.count === 0) continue; // Lost race

                    const preparedImageUrl = await prepareProduct(
                        asset.sourceImageUrl,
                        asset.shopId,
                        asset.productId,
                        asset.id,
                        itemRequestId
                    );

                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            status: "ready",
                            preparedImageUrl: preparedImageUrl,
                            updatedAt: new Date()
                        }
                    });

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    logger.error(
                        createLogContext("prepare", itemRequestId, "asset-error", { assetId: asset.id }),
                        "Error processing asset",
                        error
                    );
                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            status: "failed",
                            errorMessage: errorMessage.substring(0, 500),
                            updatedAt: new Date()
                        }
                    });
                }
            }
        }
    } catch (error) {
        logger.error(createLogContext("prepare", batchRequestId, "asset-loop-error", {}), "Error in asset loop", error);
    }
}

async function processPendingRenderJobs(batchRequestId: string) {
    try {
        const pendingJobs = await prisma.renderJob.findMany({
            where: { status: "queued" },
            take: 5,
            orderBy: { createdAt: "asc" },
            include: { roomSession: true }
        });

        if (pendingJobs.length > 0) {
            logger.info(
                createLogContext("prepare", batchRequestId, "batch-start-jobs", {}),
                `Processing batch of ${pendingJobs.length} render jobs`
            );

            for (const job of pendingJobs) {
                const itemRequestId = generateRequestId();
                try {
                    // Lock
                    const updated = await prisma.renderJob.updateMany({
                        where: { id: job.id, status: "queued" },
                        data: { status: "processing" } // Add updatedAt if schema supports
                    });

                    if (updated.count === 0) continue;

                    // 1. Get Product Image URL
                    const productAsset = await prisma.productAsset.findFirst({
                        where: { shopId: job.shopId, productId: job.productId }
                    });

                    let productImageUrl: string | null = null;
                    const config = JSON.parse(job.configJson || '{}');

                    if (productAsset?.preparedImageUrl) {
                        productImageUrl = productAsset.preparedImageUrl;
                    } else if (productAsset?.sourceImageUrl) {
                        productImageUrl = productAsset.sourceImageUrl;
                    } else if (config?.product_image_url) {
                        productImageUrl = config.product_image_url;
                    }

                    if (!productImageUrl) {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: { status: "failed", errorMessage: "No product image available" }
                        });
                        continue;
                    }

                    // 2. Get Room Image URL
                    const roomSession = job.roomSession;
                    if (!roomSession) {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: { status: "failed", errorMessage: "Room session not found" }
                        });
                        continue;
                    }

                    let roomImageUrl: string;
                    if (roomSession.cleanedRoomImageKey) {
                        roomImageUrl = await StorageService.getSignedReadUrl(roomSession.cleanedRoomImageKey, 60 * 60 * 1000);
                    } else if (roomSession.originalRoomImageKey) {
                        roomImageUrl = await StorageService.getSignedReadUrl(roomSession.originalRoomImageKey, 60 * 60 * 1000);
                    } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
                        roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl;
                    } else {
                        throw new Error("No room image available");
                    }

                    // 3. Render
                    const finalImageUrl = await compositeScene(
                        productImageUrl,
                        roomImageUrl,
                        { x: job.placementX, y: job.placementY, scale: job.placementScale },
                        job.stylePreset,
                        itemRequestId
                    );

                    // 4. Success
                    await prisma.renderJob.update({
                        where: { id: job.id },
                        data: { status: "completed", imageUrl: finalImageUrl, completedAt: new Date() }
                    });

                    await incrementQuota(job.shopId, "render", 1);

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    logger.error(
                        createLogContext("prepare", itemRequestId, "job-error", { jobId: job.id }),
                        "Error processing render job",
                        error
                    );
                    await prisma.renderJob.update({
                        where: { id: job.id },
                        data: {
                            status: "failed",
                            errorMessage: errorMessage,
                            errorCode: "PROCESSING_ERROR"
                        }
                    });
                }
            }
        }

    } catch (error) {
        logger.error(createLogContext("prepare", batchRequestId, "job-loop-error", {}), "Error in render job loop", error);
    }
}

async function runProcessorCycle() {
    if (isProcessing) return;
    isProcessing = true;

    const batchRequestId = generateRequestId();

    // Stale Lock Recovery
    try {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        // Reset ProductAssets
        const staleAssets = await prisma.productAsset.updateMany({
            where: {
                status: "processing",
                updatedAt: { lt: fifteenMinutesAgo }
            },
            data: {
                status: "pending",
                updatedAt: new Date(),
                errorMessage: "Reset from stale processing state"
            }
        });

        // Reset RenderJobs
        const staleJobs = await prisma.renderJob.updateMany({
            where: {
                status: "processing",
                createdAt: { lt: fifteenMinutesAgo }
            },
            data: {
                status: "queued"
            }
        });

        if (staleAssets.count > 0 || staleJobs.count > 0) {
            logger.warn(
                createLogContext("prepare", batchRequestId, "stale-recovery", {}),
                `Reset stale items: ${staleAssets.count} assets, ${staleJobs.count} jobs`
            );
        }
    } catch (error) {
        logger.error(
            createLogContext("prepare", batchRequestId, "stale-recovery-error", {}),
            "Failed to reset stale items",
            error
        );
    }

    await processPendingAssets(batchRequestId);
    await processPendingRenderJobs(batchRequestId);

    isProcessing = false;
}

export function startPrepareProcessor() {
    if (!processorInterval) {
        const wrappedProcessor = async () => {
            try {
                await runProcessorCycle();
            } catch (error) {
                console.error("Critical error in processor wrapper:", error);
                isProcessing = false;
            }
        };
        // Run every 5 seconds 
        processorInterval = setInterval(wrappedProcessor, 5000);
        logger.info(createLogContext("system", "startup", "processor-start", {}), "Started background processor");
        wrappedProcessor();
    }
}

export function stopPrepareProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
    }
}

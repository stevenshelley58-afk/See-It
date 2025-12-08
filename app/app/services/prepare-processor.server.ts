import prisma from "../db.server";
import { prepareProduct } from "./gemini.server";
import { logger, createLogContext, generateRequestId } from "../utils/logger.server";

// Process pending product assets
export async function processPendingAssets() {
    const pendingAssets = await prisma.productAsset.findMany({
        where: { status: "pending" },
        take: 5 // Process 5 at a time
    });

    if (pendingAssets.length === 0) {
        return; // No work to do
    }

    const batchRequestId = generateRequestId();
    logger.info(
        createLogContext("prepare", batchRequestId, "batch-start", {}),
        `Processing batch of ${pendingAssets.length} pending assets`
    );

    for (const asset of pendingAssets) {
        const requestId = generateRequestId();
        const logContext = createLogContext("prepare", requestId, "processor", {
            shopId: asset.shopId,
            productId: asset.productId,
            assetId: asset.id,
        });

        try {
            // Check idempotency: skip if already ready
            const current = await prisma.productAsset.findUnique({
                where: { id: asset.id },
                select: { status: true, preparedImageUrl: true }
            });

            if (current?.status === "ready" && current?.preparedImageUrl) {
                logger.info(
                    logContext,
                    "Asset already ready, skipping (idempotency check)"
                );
                continue;
            }

            // Mark as processing to prevent duplicate work
            await prisma.productAsset.update({
                where: { id: asset.id },
                data: { status: "processing", updatedAt: new Date() }
            });

            await processAsset(asset, requestId);
        } catch (error) {
            logger.error(
                logContext,
                "Error processing asset in batch",
                error
            );
            
            try {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await prisma.productAsset.update({
                    where: { id: asset.id },
                    data: { 
                        status: "failed",
                        errorMessage: errorMessage.substring(0, 500), // Limit length
                        updatedAt: new Date()
                    }
                });
            } catch (dbError) {
                logger.error(
                    logContext,
                    "Failed to update asset status to failed",
                    dbError
                );
            }
        }
    }
}

async function processAsset(asset: any, requestId: string) {
    const logContext = createLogContext("prepare", requestId, "processor", {
        shopId: asset.shopId,
        productId: asset.productId,
        assetId: asset.id,
    });

    logger.info(logContext, "Processing asset in background processor");
    
    try {
        // Call Gemini directly - no more Cloud Run!
        const preparedImageUrl = await prepareProduct(
            asset.sourceImageUrl,
            asset.shopId,
            asset.productId,
            asset.id,
            requestId
        );
        
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                status: "ready",
                preparedImageUrl: preparedImageUrl,
                updatedAt: new Date()
            }
        });
        
        logger.info(logContext, "Asset processed successfully");
    } catch (error) {
        logger.error(logContext, "Failed to process asset", error);
        throw error;
    }
}

// Run processor every 10 seconds
let processorInterval: ReturnType<typeof setInterval> | null = null;

export function startPrepareProcessor() {
    if (!processorInterval) {
        // Wrap async function to handle errors and prevent crashes
        const wrappedProcessor = async () => {
            try {
                await processPendingAssets();
            } catch (error) {
                const requestId = generateRequestId();
                logger.error(
                    createLogContext("prepare", requestId, "processor-error", {}),
                    "Unhandled error in prepare processor interval",
                    error
                );
            }
        };

        processorInterval = setInterval(wrappedProcessor, 10000);
        const requestId = generateRequestId();
        logger.info(
            createLogContext("prepare", requestId, "processor-start", {}),
            "Background prepare processor started (interval: 10s)"
        );
        // Process immediately on start (with error handling)
        wrappedProcessor();
    }
}

export function stopPrepareProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
        const requestId = generateRequestId();
        logger.info(
            createLogContext("prepare", requestId, "processor-stop", {}),
            "Background prepare processor stopped"
        );
    }
}


import prisma from "../db.server";
import { prepareProduct, compositeScene, type PrepareProductResult } from "./gemini.server";
import { logger, createLogContext, generateRequestId } from "../utils/logger.server";
import { StorageService } from "./storage.server";
import { incrementQuota } from "../quota.server";
import { extractProductMetadata } from "./extract-metadata.server";

let processorInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

// Configuration for retry logic
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 5000; // 5 seconds base delay

/**
 * Calculate exponential backoff delay
 * Delay = baseDelay * 2^retryCount (5s, 10s, 20s for retries 0, 1, 2)
 */
function getRetryDelay(retryCount: number): number {
    return RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (transient errors that may succeed on retry)
 */
function isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();

    // Retryable errors: network issues, rate limits, temporary failures
    const retryablePatterns = [
        'network',
        'timeout',
        'econnreset',
        'econnrefused',
        'etimedout',
        'rate limit',
        'too many requests',
        '429',
        '503',
        '502',
        '504',
        'temporarily unavailable',
        'service unavailable',
        'internal server error',
        'aborted',
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
}

async function processPendingAssets(batchRequestId: string) {
    try {
        // Fetch pending assets that haven't exceeded retry limit
        const pendingAssets = await prisma.productAsset.findMany({
            where: {
                status: "pending",
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
            take: 5,
            orderBy: { createdAt: "asc" }
        });

        if (pendingAssets.length === 0) {
            // Log periodically that processor is running but idle (helpful for debugging)
            logger.debug(
                createLogContext("prepare", batchRequestId, "batch-idle", {}),
                "No pending assets to process"
            );
            return;
        }

        logger.info(
            createLogContext("prepare", batchRequestId, "batch-start-assets", {
                count: pendingAssets.length,
                assetIds: pendingAssets.map(a => a.id).join(',')
            }),
            `Processing ${pendingAssets.length} pending assets: [${pendingAssets.map(a => `${a.productId}(retry:${a.retryCount})`).join(', ')}]`
        );

        for (const asset of pendingAssets) {
            const itemRequestId = generateRequestId();
            const currentRetryCount = asset.retryCount ?? 0;

            try {
                // Lock the asset for processing
                const updated = await prisma.productAsset.updateMany({
                    where: { id: asset.id, status: "pending" },
                    data: { status: "processing", updatedAt: new Date() }
                });

                if (updated.count === 0) continue; // Lost race

                logger.info(
                    createLogContext("prepare", itemRequestId, "asset-start", {
                        assetId: asset.id,
                        productId: asset.productId,
                        shopId: asset.shopId,
                        sourceUrl: asset.sourceImageUrl?.substring(0, 60),
                        retryCount: currentRetryCount
                    }),
                    `Starting asset ${asset.productId} (attempt ${currentRetryCount + 1}/${MAX_RETRY_ATTEMPTS})`
                );

                // Attempt processing with inline retry for transient errors
                let lastError: unknown = null;
                let success = false;
                let prepareResult: PrepareProductResult | null = null;

                for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS && !success; attempt++) {
                    try {
                        if (attempt > 0) {
                            const delay = getRetryDelay(attempt - 1);
                            logger.info(
                                createLogContext("prepare", itemRequestId, "asset-retry", {
                                    assetId: asset.id,
                                    attempt: attempt + 1,
                                    delay
                                }),
                                `Retry attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS} after ${delay}ms delay`
                            );
                            await sleep(delay);
                        }

                        prepareResult = await prepareProduct(
                            asset.sourceImageUrl,
                            asset.shopId,
                            asset.productId,
                            asset.id,
                            itemRequestId,
                            asset.productTitle ?? undefined // Pass product title for Grounded SAM
                        );
                        success = true;
                    } catch (error) {
                        lastError = error;
                        const errorMessage = error instanceof Error ? error.message : "Unknown error";

                        // Only retry for transient errors
                        if (!isRetryableError(error)) {
                            logger.warn(
                                createLogContext("prepare", itemRequestId, "asset-non-retryable", {
                                    assetId: asset.id,
                                    productId: asset.productId,
                                    attempt: attempt + 1,
                                    errorType: error?.constructor?.name || 'Unknown'
                                }),
                                `Non-retryable error for product ${asset.productId}: ${errorMessage}`
                            );
                            break; // Exit retry loop for permanent errors
                        }

                        logger.warn(
                            createLogContext("prepare", itemRequestId, "asset-attempt-failed", {
                                assetId: asset.id,
                                productId: asset.productId,
                                attempt: attempt + 1
                            }),
                            `Attempt ${attempt + 1} failed for product ${asset.productId}: ${errorMessage}`
                        );
                    }
                }

                if (success && prepareResult) {
                    // Extract metadata with AI (non-blocking - failures don't stop prepare)
                    let renderInstructions = asset.renderInstructions;
                    if (!renderInstructions) {
                        try {
                            const metadata = await extractProductMetadata(
                                asset.sourceImageUrl,
                                asset.productTitle || '',
                                '', // We don't have description here yet - AI will use image + title
                                [],
                                [],
                                itemRequestId
                            );
                            if (metadata) {
                                renderInstructions = JSON.stringify(metadata);
                            }
                        } catch (metadataError) {
                            logger.warn(
                                createLogContext("prepare", itemRequestId, "metadata-extract", { error: metadataError instanceof Error ? metadataError.message : String(metadataError) }),
                                "Metadata extraction failed, continuing without",
                                metadataError
                            );
                        }
                    }

                    // Extract GCS key from the signed URL for on-demand URL generation
                    const preparedImageKey = extractGcsKeyFromUrl(prepareResult.url);

                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            status: "ready",
                            preparedImageUrl: prepareResult.url,
                            preparedImageKey: preparedImageKey,
                            renderInstructions: renderInstructions,
                            geminiFileUri: prepareResult.geminiFileUri,
                            geminiFileExpiresAt: prepareResult.geminiFileExpiresAt,
                            retryCount: 0, // Reset retry count on success
                            errorMessage: null,
                            updatedAt: new Date()
                        }
                    });

                    logger.info(
                        createLogContext("prepare", itemRequestId, "asset-complete", {
                            assetId: asset.id,
                            productId: asset.productId,
                            gcsKey: preparedImageKey,
                            geminiUri: prepareResult.geminiFileUri ?? '(not uploaded)'
                        }),
                        `Product ${asset.productId} prepared successfully -> ${preparedImageKey}${prepareResult.geminiFileUri ? ' + Gemini pre-upload' : ''}`
                    );
                } else {
                    // All retries exhausted or permanent error
                    const newRetryCount = currentRetryCount + 1;
                    const errorMessage = lastError instanceof Error ? lastError.message : "Unknown error";
                    const errorStack = lastError instanceof Error ? lastError.stack?.split('\n').slice(0, 3).join(' | ') : '';
                    const isFinalFailure = newRetryCount >= MAX_RETRY_ATTEMPTS || !isRetryableError(lastError);

                    logger.error(
                        createLogContext("prepare", itemRequestId, "asset-error", {
                            assetId: asset.id,
                            productId: asset.productId,
                            retryCount: newRetryCount,
                            isFinal: isFinalFailure,
                            errorType: lastError?.constructor?.name || 'Unknown',
                            stackPreview: errorStack
                        }),
                        `FAILED product ${asset.productId}${isFinalFailure ? " (FINAL - giving up)" : " (will retry)"}: ${errorMessage}`,
                        lastError
                    );

                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            status: isFinalFailure ? "failed" : "pending",
                            errorMessage: errorMessage.substring(0, 500),
                            retryCount: newRetryCount,
                            updatedAt: new Date()
                        }
                    });
                }
            } catch (error) {
                // Outer error handler for unexpected errors (DB errors, etc.)
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                const errorStack = error instanceof Error ? error.stack?.split('\n').slice(0, 5).join(' | ') : '';

                logger.error(
                    createLogContext("prepare", itemRequestId, "asset-critical-error", {
                        assetId: asset.id,
                        productId: asset.productId,
                        errorType: error?.constructor?.name || 'Unknown',
                        stackPreview: errorStack
                    }),
                    `CRITICAL ERROR processing product ${asset.productId}: ${errorMessage}`,
                    error
                );

                // Mark as failed without retry for critical errors
                try {
                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            status: "failed",
                            errorMessage: `Critical: ${errorMessage.substring(0, 450)}`,
                            updatedAt: new Date()
                        }
                    });
                } catch (updateError) {
                    logger.error(
                        createLogContext("prepare", itemRequestId, "asset-update-failed", {
                            assetId: asset.id,
                            productId: asset.productId
                        }),
                        `Failed to update asset status after critical error: ${updateError instanceof Error ? updateError.message : 'Unknown'}`,
                        updateError
                    );
                }
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            createLogContext("prepare", batchRequestId, "asset-loop-error", {
                errorType: error?.constructor?.name || 'Unknown'
            }),
            `Asset processing loop crashed: ${errorMessage}`,
            error
        );
    }
}

/**
 * Extract the GCS key from a signed URL
 * Example: https://storage.googleapis.com/bucket/products/shop/product/asset_prepared.png?X-Goog-...
 * Returns: products/shop/product/asset_prepared.png
 */
function extractGcsKeyFromUrl(signedUrl: string): string | null {
    try {
        const url = new URL(signedUrl);
        // GCS signed URLs have the format: /bucket-name/key
        // Remove the leading slash and bucket name
        const pathParts = url.pathname.split('/');
        if (pathParts.length >= 3) {
            // Skip empty string and bucket name, join the rest
            return pathParts.slice(2).join('/');
        }
        return null;
    } catch {
        return null;
    }
}

async function processPendingRenderJobs(batchRequestId: string) {
    try {
        // Fetch queued jobs that haven't exceeded retry limit
        const pendingJobs = await prisma.renderJob.findMany({
            where: {
                status: "queued",
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
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
                const currentRetryCount = job.retryCount ?? 0;

                try {
                    // Lock
                    const updated = await prisma.renderJob.updateMany({
                        where: { id: job.id, status: "queued" },
                        data: { status: "processing" }
                    });

                    if (updated.count === 0) continue;

                    logger.info(
                        createLogContext("prepare", itemRequestId, "job-start", {
                            jobId: job.id,
                            retryCount: currentRetryCount
                        }),
                        `Starting render job (attempt ${currentRetryCount + 1}/${MAX_RETRY_ATTEMPTS})`
                    );

                    // 1. Get Product Image URL (generate fresh URL if key is available)
                    const productAsset = await prisma.productAsset.findFirst({
                        where: { shopId: job.shopId, productId: job.productId }
                    });

                    let productImageUrl: string | null = null;
                    let config: Record<string, unknown> = {};
                    try {
                        config = JSON.parse(job.configJson || '{}');
                    } catch {
                        // Invalid JSON in configJson - use empty config
                    }

                    if (productAsset?.preparedImageKey) {
                        // Generate fresh URL from stored key
                        productImageUrl = await StorageService.getSignedReadUrl(productAsset.preparedImageKey, 60 * 60 * 1000);
                    } else if (productAsset?.preparedImageUrl) {
                        productImageUrl = productAsset.preparedImageUrl;
                    } else if (productAsset?.sourceImageUrl) {
                        productImageUrl = productAsset.sourceImageUrl;
                    } else if (config?.product_image_url) {
                        productImageUrl = config.product_image_url;
                    }

                    if (!productImageUrl) {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "failed",
                                errorMessage: "No product image available",
                                errorCode: "NO_PRODUCT_IMAGE"
                            }
                        });
                        continue;
                    }

                    // 2. Get Room Image URL
                    const roomSession = job.roomSession;
                    if (!roomSession) {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "failed",
                                errorMessage: "Room session not found",
                                errorCode: "NO_ROOM_SESSION"
                            }
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

                    // 3. Render with retry logic
                    let lastError: unknown = null;
                    let success = false;
                    let compositeResult: { imageUrl: string; imageKey: string } | null = null;

                    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS && !success; attempt++) {
                        try {
                            if (attempt > 0) {
                                const delay = getRetryDelay(attempt - 1);
                                logger.info(
                                    createLogContext("prepare", itemRequestId, "job-retry", {
                                        jobId: job.id,
                                        attempt: attempt + 1,
                                        delay
                                    }),
                                    `Retry attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS} after ${delay}ms delay`
                                );
                                await sleep(delay);
                            }

                            let productWidthFraction: number | undefined = undefined;
                            try {
                                const cfg = job.configJson ? JSON.parse(job.configJson) : {};
                                const v = cfg?.placement_meta?.product_width_fraction;
                                if (Number.isFinite(v)) productWidthFraction = v;
                            } catch {
                                // Ignore malformed configJson; fall back to legacy placementScale behavior
                            }

                            // compositeScene now returns { imageUrl, imageKey }
                            compositeResult = await compositeScene(
                                productImageUrl,
                                roomImageUrl,
                                {
                                    x: job.placementX,
                                    y: job.placementY,
                                    scale: job.placementScale,
                                    productWidthFraction,
                                },
                                job.stylePreset ?? "neutral",
                                itemRequestId,
                                productAsset?.renderInstructions ?? undefined
                            );
                            success = true;
                        } catch (error) {
                            lastError = error;
                            const errorMessage = error instanceof Error ? error.message : "Unknown error";

                            if (!isRetryableError(error)) {
                                logger.warn(
                                    createLogContext("prepare", itemRequestId, "job-non-retryable", {
                                        jobId: job.id,
                                        attempt: attempt + 1
                                    }),
                                    `Non-retryable error: ${errorMessage}`
                                );
                                break;
                            }

                            logger.warn(
                                createLogContext("prepare", itemRequestId, "job-attempt-failed", {
                                    jobId: job.id,
                                    attempt: attempt + 1
                                }),
                                `Attempt ${attempt + 1} failed with retryable error: ${errorMessage}`
                            );
                        }
                    }

                    if (success && compositeResult) {
                        // compositeScene now returns both imageUrl and imageKey directly
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "completed",
                                imageUrl: compositeResult.imageUrl,
                                imageKey: compositeResult.imageKey,
                                retryCount: 0,
                                completedAt: new Date()
                            }
                        });

                        await incrementQuota(job.shopId, "render", 1);

                        logger.info(
                            createLogContext("prepare", itemRequestId, "job-complete", { jobId: job.id }),
                            "Render job completed successfully"
                        );
                    } else {
                        // All retries exhausted or permanent error
                        const newRetryCount = currentRetryCount + 1;
                        const errorMessage = lastError instanceof Error ? lastError.message : "Unknown error";
                        const isFinalFailure = newRetryCount >= MAX_RETRY_ATTEMPTS || !isRetryableError(lastError);

                        logger.error(
                            createLogContext("prepare", itemRequestId, "job-error", {
                                jobId: job.id,
                                retryCount: newRetryCount,
                                isFinal: isFinalFailure
                            }),
                            `Error processing render job${isFinalFailure ? " (final failure)" : " (will retry)"}`,
                            lastError
                        );

                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: isFinalFailure ? "failed" : "queued",
                                errorMessage: errorMessage.substring(0, 500),
                                errorCode: "PROCESSING_ERROR",
                                retryCount: newRetryCount
                            }
                        });
                    }
                } catch (error) {
                    // Outer error handler for unexpected errors
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    logger.error(
                        createLogContext("prepare", itemRequestId, "job-critical-error", { jobId: job.id }),
                        "Critical error processing render job",
                        error
                    );

                    try {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "failed",
                                errorMessage: `Critical error: ${errorMessage.substring(0, 450)}`,
                                errorCode: "CRITICAL_ERROR"
                            }
                        });
                    } catch (updateError) {
                        logger.error(
                            createLogContext("prepare", itemRequestId, "job-update-failed", { jobId: job.id }),
                            "Failed to update job status after critical error",
                            updateError
                        );
                    }
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

    // Stale Lock Recovery - reset items stuck in "processing" state
    // Only reset items that haven't exceeded retry limit
    try {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        // Reset ProductAssets (increment retry count for each reset)
        const staleAssets = await prisma.productAsset.updateMany({
            where: {
                status: "processing",
                updatedAt: { lt: fifteenMinutesAgo },
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "pending",
                updatedAt: new Date(),
                errorMessage: "Reset from stale processing state"
            }
        });

        // Mark assets that have exceeded retry limit as failed
        const exhaustedAssets = await prisma.productAsset.updateMany({
            where: {
                status: "processing",
                updatedAt: { lt: fifteenMinutesAgo },
                retryCount: { gte: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "failed",
                updatedAt: new Date(),
                errorMessage: "Maximum retry attempts exceeded (stale recovery)"
            }
        });

        // Reset RenderJobs (only those under retry limit)
        const staleJobs = await prisma.renderJob.updateMany({
            where: {
                status: "processing",
                createdAt: { lt: fifteenMinutesAgo },
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "queued"
            }
        });

        // Mark jobs that have exceeded retry limit as failed
        const exhaustedJobs = await prisma.renderJob.updateMany({
            where: {
                status: "processing",
                createdAt: { lt: fifteenMinutesAgo },
                retryCount: { gte: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "failed",
                errorMessage: "Maximum retry attempts exceeded (stale recovery)",
                errorCode: "MAX_RETRIES_EXCEEDED"
            }
        });

        if (staleAssets.count > 0 || staleJobs.count > 0 || exhaustedAssets.count > 0 || exhaustedJobs.count > 0) {
            logger.warn(
                createLogContext("prepare", batchRequestId, "stale-recovery", {}),
                `Stale recovery: reset ${staleAssets.count} assets, ${staleJobs.count} jobs; marked failed: ${exhaustedAssets.count} assets, ${exhaustedJobs.count} jobs`
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

// Flag to track if processor is disabled due to missing configuration
let processorDisabled = false;

export function startPrepareProcessor() {
    // Validate required environment variables before starting
    if (!process.env.GEMINI_API_KEY) {
        if (!processorDisabled) {
            logger.warn(
                createLogContext("system", "startup", "processor-disabled", {}),
                "GEMINI_API_KEY not configured. Background processor disabled. " +
                "Product preparation and render jobs will not be processed until API key is set."
            );
            processorDisabled = true;
        }
        return; // Gracefully exit without starting processor
    }

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

export function isProcessorEnabled(): boolean {
    return !processorDisabled && processorInterval !== null;
}

export function stopPrepareProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
    }
}

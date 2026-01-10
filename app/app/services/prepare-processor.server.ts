import prisma from "../db.server";
import { prepareProduct, compositeScene, type PrepareProductResult } from "./gemini.server";
import { logger, createLogContext, generateRequestId } from "../utils/logger.server";
import { StorageService } from "./storage.server";
import { incrementQuota } from "../quota.server";
import { emitPrepEvent } from "./prep-events.server";
import { extractStructuredFields, generateProductDescription } from "./description-writer.server";

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
                            itemRequestId
                        );
                        success = true;

                        // Emit auto_cutout_created event
                        await emitPrepEvent(
                            {
                                assetId: asset.id,
                                productId: asset.productId,
                                shopId: asset.shopId,
                                eventType: "auto_cutout_created",
                                actorType: "system",
                                payload: {
                                    source: "auto",
                                    preparedImageKey: extractGcsKeyFromUrl(prepareResult.url) || undefined,
                                    geminiFileUri: prepareResult.geminiFileUri || undefined,
                                },
                            },
                            null,
                            itemRequestId
                        ).catch((err) => {
                            // Non-critical - log but don't fail
                            logger.debug(
                                createLogContext("prepare", itemRequestId, "event-emit-failed", {}),
                                `Failed to emit auto_cutout_created: ${err instanceof Error ? err.message : String(err)}`
                            );
                        });
                    } catch (error) {
                        lastError = error;
                        const errorMessage = error instanceof Error ? error.message : "Unknown error";

                        // Emit auto_cutout_failed on first attempt failure
                        if (attempt === 0) {
                            await emitPrepEvent(
                                {
                                    assetId: asset.id,
                                    productId: asset.productId,
                                    shopId: asset.shopId,
                                    eventType: "auto_cutout_failed",
                                    actorType: "system",
                                    payload: {
                                        source: "auto",
                                        error: errorMessage,
                                        retryable: isRetryableError(error),
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }

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
                    // Generate placement fields and prose prompt (only if not merchant-owned)
                    // Check fieldSource to avoid overwriting merchant edits
                    const existingFieldSource = asset.fieldSource && typeof asset.fieldSource === 'object' 
                        ? asset.fieldSource as Record<string, string>
                        : {};
                    
                    const isMerchantOwned = (field: string) => existingFieldSource[field] === 'merchant';
                    
                    // Only generate if renderInstructions is missing or if it's not merchant-owned
                    let renderInstructions = asset.renderInstructions;
                    let placementFields = asset.placementFields && typeof asset.placementFields === 'object'
                        ? asset.placementFields as Record<string, any>
                        : null;
                    let sceneRole = asset.sceneRole;
                    let replacementRule = asset.replacementRule;
                    let allowSpaceCreation = asset.allowSpaceCreation;

                    // Generate placement if missing and not merchant-owned
                    // Check each field individually so we can generate missing parts even if some exist
                    const shouldGeneratePrompt = !renderInstructions && !isMerchantOwned('renderInstructions');
                    
                    // For placementFields, check if it exists and if any field is merchant-owned
                    const placementFieldsSource = placementFields?.fieldSource && typeof placementFields.fieldSource === 'object'
                        ? placementFields.fieldSource as Record<string, string>
                        : {};
                    const hasMerchantOwnedPlacementField = Object.values(placementFieldsSource).some(src => src === 'merchant');
                    const shouldGenerateFields = (!placementFields || Object.keys(placementFields).filter(k => k !== 'fieldSource').length === 0) && !hasMerchantOwnedPlacementField;
                    
                    const shouldGenerateV2Rules = (!sceneRole || !replacementRule || allowSpaceCreation === null) && 
                        (!isMerchantOwned('sceneRole') && !isMerchantOwned('replacementRule') && !isMerchantOwned('allowSpaceCreation'));
                    
                    const shouldGeneratePlacement = (shouldGeneratePrompt || shouldGenerateFields || shouldGenerateV2Rules);

                    if (shouldGeneratePlacement && asset.productTitle) {
                        try {
                            // Extract structured fields from product title (best effort without full product data)
                            // TODO: Enhance this by fetching full product data from Shopify Admin API
                            const productData = {
                                title: asset.productTitle,
                                description: '', // Not available in background processor yet
                                productType: null,
                                tags: [],
                            };
                            
                            const extractedFields = extractStructuredFields(productData);
                            
                            // Auto-detect v2 placement rules (same logic as PlacementTab)
                            const largeItemKeywords = ['sofa', 'couch', 'sectional', 'mirror', 'cabinet', 'dresser', 'bookshelf', 'bed', 'table', 'desk', 'console', 'credenza', 'sideboard'];
                            const titleLower = (asset.productTitle || '').toLowerCase();
                            const isLargeItem = largeItemKeywords.some(k => titleLower.includes(k));
                            
                            const autoSceneRole = isLargeItem ? 'Dominant' : 'Integrated';
                            const autoReplacementRule = isLargeItem ? 'Similar Size or Position' : 'None';
                            const autoAllowSpaceCreation = isLargeItem;

                            // Generate prose placement prompt (only if missing and not merchant-owned)
                            if (shouldGeneratePrompt) {
                                try {
                                    const promptResult = await generateProductDescription(
                                        productData,
                                        extractedFields,
                                        itemRequestId
                                    );
                                    renderInstructions = promptResult.description;
                                    
                                    logger.info(
                                        createLogContext("prepare", itemRequestId, "placement-prompt-generated", {
                                            assetId: asset.id,
                                            productId: asset.productId,
                                            length: renderInstructions.length
                                        }),
                                        `Generated placement prompt: ${renderInstructions.substring(0, 100)}...`
                                    );

                                    // Emit placement_prompt_generated event with raw text-model prompt for lineage
                                    if (promptResult.rawPrompt) {
                                        emitPrepEvent(
                                            {
                                                assetId: asset.id,
                                                productId: asset.productId,
                                                shopId: asset.shopId,
                                                eventType: "placement_prompt_generated",
                                                actorType: "system",
                                                payload: {
                                                    source: "auto",
                                                    model: promptResult.model,
                                                    confidence: promptResult.confidence,
                                                    description: promptResult.description,
                                                    rawPrompt: promptResult.rawPrompt, // Full prompt sent to text model
                                                    descriptionLength: promptResult.description.length,
                                                },
                                            },
                                            null,
                                            itemRequestId
                                        ).catch(() => {
                                            // Non-critical
                                        });
                                    }
                                } catch (promptError) {
                                    logger.warn(
                                        createLogContext("prepare", itemRequestId, "placement-prompt-failed", {
                                            error: promptError instanceof Error ? promptError.message : String(promptError)
                                        }),
                                        "Placement prompt generation failed, continuing without",
                                        promptError
                                    );
                                    // Fallback: use a basic description
                                    const article = /^[aeiou]/i.test(asset.productTitle) ? 'An' : 'A';
                                    renderInstructions = `${article} ${asset.productTitle.toLowerCase()}, described for realistic interior photography with accurate proportions and natural lighting.`;
                                }
                            }

                            // Set placementFields if not already set and not merchant-owned
                            if (shouldGenerateFields) {
                                placementFields = {
                                    surface: extractedFields.surface,
                                    material: extractedFields.material,
                                    orientation: extractedFields.orientation,
                                    shadow: extractedFields.shadow || (extractedFields.surface === 'ceiling' ? 'none' : 'contact'),
                                    dimensions: extractedFields.dimensions || { height: null, width: null },
                                    additionalNotes: '',
                                    fieldSource: {
                                        surface: 'auto',
                                        material: 'auto',
                                        orientation: 'auto',
                                        shadow: 'auto',
                                        dimensions: 'auto',
                                        additionalNotes: 'auto',
                                    }
                                };
                            }

                            // Set v2 fields if not already set and not merchant-owned
                            if (shouldGenerateV2Rules) {
                                if (!sceneRole && !isMerchantOwned('sceneRole')) {
                                    sceneRole = autoSceneRole;
                                }
                                if (!replacementRule && !isMerchantOwned('replacementRule')) {
                                    replacementRule = autoReplacementRule;
                                }
                                if (allowSpaceCreation === null && !isMerchantOwned('allowSpaceCreation')) {
                                    allowSpaceCreation = autoAllowSpaceCreation;
                                }
                            }

                            // Emit auto_placement_generated event
                            await emitPrepEvent(
                                {
                                    assetId: asset.id,
                                    productId: asset.productId,
                                    shopId: asset.shopId,
                                    eventType: "auto_placement_generated",
                                    actorType: "system",
                                    payload: {
                                        source: "auto",
                                        hasPrompt: !!renderInstructions,
                                        hasPlacementFields: !!placementFields,
                                        sceneRole: sceneRole,
                                        replacementRule: replacementRule,
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });

                        } catch (placementError) {
                            logger.warn(
                                createLogContext("prepare", itemRequestId, "placement-generation", { 
                                    error: placementError instanceof Error ? placementError.message : String(placementError) 
                                }),
                                "Placement generation failed, continuing without",
                                placementError
                            );
                        }
                    }

                    // Extract GCS key from the signed URL for on-demand URL generation
                    const preparedImageKey = extractGcsKeyFromUrl(prepareResult.url);

                    // Prepare update data (only include fields that changed or are being set)
                    const updateData: any = {
                        status: "ready",
                        preparedImageUrl: prepareResult.url,
                        preparedImageKey: preparedImageKey,
                        geminiFileUri: prepareResult.geminiFileUri,
                        geminiFileExpiresAt: prepareResult.geminiFileExpiresAt,
                        retryCount: 0, // Reset retry count on success
                        errorMessage: null,
                        updatedAt: new Date()
                    };

                    // Only update renderInstructions if we generated one or if it was already set
                    if (renderInstructions) {
                        updateData.renderInstructions = renderInstructions;
                    }

                    // Only update placementFields if we generated one
                    if (placementFields) {
                        updateData.placementFields = placementFields;
                    }

                    // Only update v2 fields if we have values
                    if (sceneRole) {
                        updateData.sceneRole = sceneRole;
                    }
                    if (replacementRule) {
                        updateData.replacementRule = replacementRule;
                    }
                    if (allowSpaceCreation !== null && allowSpaceCreation !== undefined) {
                        updateData.allowSpaceCreation = allowSpaceCreation;
                    }

                    // Update fieldSource to mark auto-generated fields
                    const updatedFieldSource = { ...existingFieldSource };
                    if (renderInstructions && !isMerchantOwned('renderInstructions')) {
                        updatedFieldSource.renderInstructions = 'auto';
                    }
                    if (placementFields && !isMerchantOwned('placementFields')) {
                        updatedFieldSource.placementFields = 'auto';
                    }
                    if (sceneRole && !isMerchantOwned('sceneRole')) {
                        updatedFieldSource.sceneRole = 'auto';
                    }
                    if (replacementRule && !isMerchantOwned('replacementRule')) {
                        updatedFieldSource.replacementRule = 'auto';
                    }
                    if (allowSpaceCreation !== null && !isMerchantOwned('allowSpaceCreation')) {
                        updatedFieldSource.allowSpaceCreation = 'auto';
                    }
                    if (Object.keys(updatedFieldSource).length > 0) {
                        updateData.fieldSource = updatedFieldSource;
                    }

                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: updateData
                    });

                    // Emit prep_confirmed event (system)
                    await emitPrepEvent(
                        {
                            assetId: asset.id,
                            productId: asset.productId,
                            shopId: asset.shopId,
                            eventType: "prep_confirmed",
                            actorType: "system",
                            payload: {
                                source: "auto",
                                status: "ready",
                            },
                        },
                        null,
                        itemRequestId
                    ).catch(() => {
                        // Non-critical
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

                    // Emit render_job_started event
                    if (productAsset?.id) {
                        emitPrepEvent(
                            {
                                assetId: productAsset.id,
                                productId: job.productId,
                                shopId: job.shopId,
                                eventType: "render_job_started",
                                actorType: "system",
                                payload: {
                                    renderJobId: job.id,
                                    roomSessionId: job.roomSessionId || undefined,
                                    attempt: currentRetryCount + 1,
                                    maxAttempts: MAX_RETRY_ATTEMPTS,
                                },
                            },
                            null,
                            itemRequestId
                        ).catch(() => {
                            // Non-critical
                        });
                    }

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
                    let capturedTelemetry: {
                        prompt: string;
                        model: string;
                        aspectRatio: string;
                        useRoomUri: boolean;
                        useProductUri: boolean;
                        placement: { x: number; y: number; scale: number; productWidthFraction?: number };
                        stylePreset: string;
                        productInstructions?: string;
                    } | null = null;

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

                            const placement = {
                                x: job.placementX,
                                y: job.placementY,
                                scale: job.placementScale,
                                productWidthFraction,
                            };

                            // Reset captured telemetry for this attempt
                            capturedTelemetry = null;

                            // compositeScene now returns { imageUrl, imageKey }
                            compositeResult = await compositeScene(
                                productImageUrl,
                                roomImageUrl,
                                placement,
                                job.stylePreset ?? "neutral",
                                itemRequestId,
                                productAsset?.renderInstructions ?? undefined,
                                {
                                    roomGeminiUri: roomSession.geminiFileUri,
                                    roomGeminiExpiresAt: roomSession.geminiFileExpiresAt,
                                    productGeminiUri: productAsset?.geminiFileUri ?? null,
                                    productGeminiExpiresAt: productAsset?.geminiFileExpiresAt ?? null,
                                    onPromptBuilt: (telemetry) => {
                                        capturedTelemetry = telemetry;
                                    },
                                }
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

                        // Emit render_prompt_built event (if we captured telemetry)
                        if (productAsset?.id && capturedTelemetry) {
                            // Simple hash function for prompt grouping (non-cryptographic)
                            const promptHash = capturedTelemetry.prompt.split('').reduce((acc, char) => {
                                const hash = ((acc << 5) - acc) + char.charCodeAt(0);
                                return hash & hash;
                            }, 0).toString(36);

                            emitPrepEvent(
                                {
                                    assetId: productAsset.id,
                                    productId: job.productId,
                                    shopId: job.shopId,
                                    eventType: "render_prompt_built",
                                    actorType: "system",
                                    payload: {
                                        renderJobId: job.id,
                                        roomSessionId: job.roomSessionId || undefined,
                                        provider: "gemini",
                                        model: capturedTelemetry.model,
                                        aspectRatio: capturedTelemetry.aspectRatio,
                                        prompt: capturedTelemetry.prompt,
                                        promptHash,
                                        placement: capturedTelemetry.placement,
                                        stylePreset: capturedTelemetry.stylePreset,
                                        productInstructions: capturedTelemetry.productInstructions || undefined,
                                        useRoomUri: capturedTelemetry.useRoomUri,
                                        useProductUri: capturedTelemetry.useProductUri,
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }

                        // Emit render_job_completed event
                        if (productAsset?.id) {
                            emitPrepEvent(
                                {
                                    assetId: productAsset.id,
                                    productId: job.productId,
                                    shopId: job.shopId,
                                    eventType: "render_job_completed",
                                    actorType: "system",
                                    payload: {
                                        renderJobId: job.id,
                                        roomSessionId: job.roomSessionId || undefined,
                                        outputImageKey: compositeResult.imageKey,
                                        outputImageUrl: compositeResult.imageUrl,
                                        promptHash: capturedTelemetry ? (capturedTelemetry.prompt.split('').reduce((acc, char) => {
                                            const hash = ((acc << 5) - acc) + char.charCodeAt(0);
                                            return hash & hash;
                                        }, 0).toString(36)) : undefined,
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }

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

                        // Emit render_job_failed event
                        if (productAsset?.id) {
                            emitPrepEvent(
                                {
                                    assetId: productAsset.id,
                                    productId: job.productId,
                                    shopId: job.shopId,
                                    eventType: "render_job_failed",
                                    actorType: "system",
                                    payload: {
                                        renderJobId: job.id,
                                        roomSessionId: job.roomSessionId || undefined,
                                        attempt: newRetryCount,
                                        isFinalFailure,
                                        errorMessage: errorMessage.substring(0, 500),
                                        errorCode: "PROCESSING_ERROR",
                                        isRetryable: isRetryableError(lastError),
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }
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

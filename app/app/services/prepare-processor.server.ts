import prisma from "../db.server";
import { prepareProduct } from "./gemini.server";

// Process pending product assets
export async function processPendingAssets() {
    const pendingAssets = await prisma.productAsset.findMany({
        where: { status: "pending" },
        take: 5 // Process 5 at a time
    });

    for (const asset of pendingAssets) {
        try {
            await processAsset(asset);
        } catch (error) {
            console.error(`[Prepare] Error processing asset ${asset.id}:`, error);
            await prisma.productAsset.update({
                where: { id: asset.id },
                data: { 
                    status: "failed",
                    updatedAt: new Date()
                }
            });
        }
    }
}

async function processAsset(asset: any) {
    console.log(`[Prepare] Processing asset ${asset.id} for product ${asset.productId}`);
    
    try {
        // Call Gemini directly - no more Cloud Run!
        const preparedImageUrl = await prepareProduct(
            asset.sourceImageUrl,
            asset.shopId,
            asset.productId,
            asset.id
        );
        
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                status: "ready",
                preparedImageUrl: preparedImageUrl,
                updatedAt: new Date()
            }
        });
        
        console.log(`[Prepare] Successfully processed asset ${asset.id}`);
    } catch (error) {
        console.error(`[Prepare] Failed to process asset ${asset.id}:`, error);
        throw error;
    }
}

// Run processor every 10 seconds
let processorInterval: ReturnType<typeof setInterval> | null = null;

export function startPrepareProcessor() {
    if (!processorInterval) {
        processorInterval = setInterval(processPendingAssets, 10000);
        console.log("[Prepare] Processor started");
        // Process immediately on start
        processPendingAssets();
    }
}

export function stopPrepareProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
        console.log("[Prepare] Processor stopped");
    }
}


import prisma from "../db.server";

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
            console.error(`Error processing asset ${asset.id}:`, error);
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

async function processAsset(asset) {
    console.log(`Processing asset ${asset.id} for product ${asset.productId}`);
    
    const imageServiceUrl = process.env.IMAGE_SERVICE_BASE_URL;
    const imageServiceToken = process.env.IMAGE_SERVICE_TOKEN;
    
    if (!imageServiceUrl || !imageServiceToken) {
        console.error("Image service not configured");
        // For now, simulate success with the original image
        // Remove this when image service is working
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                status: "ready",
                preparedImageUrl: asset.sourceImageUrl, // Use original for now
                updatedAt: new Date()
            }
        });
        return;
    }

    try {
        // Call image service to prepare the image
        const response = await fetch(`${imageServiceUrl}/product/prepare`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${imageServiceToken}`
            },
            body: JSON.stringify({
                image_url: asset.sourceImageUrl,
                remove_background: true,
                enhance_lighting: true
            })
        });

        if (!response.ok) {
            throw new Error(`Image service returned ${response.status}`);
        }

        const result = await response.json();
        
        // Update asset with prepared image URL
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                status: "ready",
                preparedImageUrl: result.prepared_url || asset.sourceImageUrl,
                updatedAt: new Date()
            }
        });
        
        console.log(`Successfully processed asset ${asset.id}`);
    } catch (error) {
        console.error(`Failed to process asset ${asset.id}:`, error);
        
        // For now, mark as ready with original image so merchant can continue
        // This is a temporary workaround until image service is fixed
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                status: "ready",
                preparedImageUrl: asset.sourceImageUrl,
                updatedAt: new Date()
            }
        });
    }
}

// Run processor every 10 seconds
let processorInterval;

export function startPrepareProcessor() {
    if (!processorInterval) {
        processorInterval = setInterval(processPendingAssets, 10000);
        console.log("Prepare processor started");
        // Process immediately on start
        processPendingAssets();
    }
}

export function stopPrepareProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
        console.log("Prepare processor stopped");
    }
}

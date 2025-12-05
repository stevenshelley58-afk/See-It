import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";
import { prepareProduct } from "../services/gemini.server";

export const action = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const productId = formData.get("productId");
    const imageUrl = formData.get("imageUrl");
    const imageId = formData.get("imageId");

    if (!productId || !imageUrl) {
        return json({ error: "Missing data" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop }
    });

    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }

    const existing = await prisma.productAsset.findFirst({
        where: { shopId: shop.id, productId: String(productId) }
    });

    // Enforce quota
    try {
        await enforceQuota(shop.id, "prep", 1);
    } catch (error) {
        if (error instanceof Response) {
            const data = await error.json();
            return json(data, { status: 429 });
        }
        throw error;
    }

    // 1. Create/Update record as PENDING
    let assetId;
    if (existing) {
        assetId = existing.id;
        await prisma.productAsset.update({
            where: { id: existing.id },
            data: { status: "pending", sourceImageUrl: String(imageUrl) }
        });
    } else {
        const newAsset = await prisma.productAsset.create({
            data: {
                shopId: shop.id,
                productId: String(productId),
                sourceImageId: String(imageId) || "unknown",
                sourceImageUrl: String(imageUrl),
                status: "pending",
                prepStrategy: "manual",
                promptVersion: 1,
                createdAt: new Date()
            }
        });
        assetId = newAsset.id;
    }

    // 2. Process image using local Gemini service (no external service needed)
    try {
        console.log(`[Prepare] Processing asset ${assetId} using local Gemini service...`);
        
        const preparedImageUrl = await prepareProduct(
            String(imageUrl),
            shop.id,
            String(productId),
            assetId
        );

        if (!preparedImageUrl) {
            throw new Error("prepareProduct returned no URL");
        }

        // 3. Update record as READY
        await prisma.productAsset.update({
            where: { id: assetId },
            data: { 
                status: "ready", 
                preparedImageUrl: preparedImageUrl 
            }
        });

        console.log(`[Prepare] Successfully processed asset ${assetId}`);
        return json({ success: true, preparedImageUrl: preparedImageUrl });

    } catch (error) {
        console.error("[Prepare] Failed:", error);
        
        // Update record as FAILED with error message
        await prisma.productAsset.update({
            where: { id: assetId },
            data: { 
                status: "failed",
                errorMessage: error.message || "Unknown error"
            }
        });

        return json({ error: error.message }, { status: 500 });
    }
};

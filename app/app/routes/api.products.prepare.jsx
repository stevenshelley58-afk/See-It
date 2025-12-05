import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";

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

    // 2. Call Image Service
    try {
        const imageServiceUrl = process.env.IMAGE_SERVICE_BASE_URL;
        const imageServiceToken = process.env.IMAGE_SERVICE_TOKEN;

        if (!imageServiceUrl) {
            throw new Error("IMAGE_SERVICE_BASE_URL not configured");
        }

        console.log(`Calling Image Service for asset ${assetId}...`);
        
        const response = await fetch(`${imageServiceUrl}/product/prepare`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${imageServiceToken}`
            },
            body: JSON.stringify({
                source_image_url: imageUrl,
                shop_id: shop.id,
                product_id: productId,
                asset_id: assetId
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Image Service failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        const { prepared_image_url } = data;

        if (!prepared_image_url) {
            throw new Error("Image Service returned no prepared_image_url");
        }

        // 3. Update record as READY
        await prisma.productAsset.update({
            where: { id: assetId },
            data: { 
                status: "ready", 
                preparedImageUrl: prepared_image_url 
            }
        });

        return json({ success: true, preparedImageUrl: prepared_image_url });

    } catch (error) {
        console.error("Prepare failed:", error);
        
        // Update record as FAILED
        await prisma.productAsset.update({
            where: { id: assetId },
            data: { status: "failed" }
        });

        return json({ error: error.message }, { status: 500 });
    }
};

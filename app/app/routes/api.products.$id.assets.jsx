import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /api/products/:id/assets — list product_assets for a product (spec Routes → Admin API)
export const loader = async ({ request, params }) => {
    const { session } = await authenticate.admin(request);
    const productId = params.id;

    if (!productId) {
        return json({ error: "missing_product_id" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
    });

    if (!shop) {
        return json({ error: "shop_not_found" }, { status: 404 });
    }

    const assets = await prisma.productAsset.findMany({
        where: { shopId: shop.id, productId: productId },
        orderBy: { updatedAt: "desc" }
    });

    return json({
        assets: assets.map((a) => ({
            id: a.id,
            product_id: a.productId,
            variant_id: a.variantId,
            source_image_id: a.sourceImageId,
            source_image_url: a.sourceImageUrl,
            prepared_image_url: a.preparedImageUrl,
            status: a.status,
            prep_strategy: a.prepStrategy,
            prompt_version: a.promptVersion,
            error_message: a.errorMessage,
            created_at: a.createdAt,
            updated_at: a.updatedAt,
        }))
    });
};





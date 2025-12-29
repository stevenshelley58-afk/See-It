import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { email, product_id, product_title, render_job_id, image_url } = body;

        if (!email || !product_id) {
            return json({ error: "Email and product_id required" }, { status: 400 });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return json({ error: "Invalid email format" }, { status: 400 });
        }

        const shop = await prisma.shop.findUnique({
            where: { shopDomain: session.shop }
        });

        if (!shop) {
            return json({ error: "Shop not found" }, { status: 404 });
        }

        const capture = await prisma.seeItCapture.create({
            data: {
                shopId: shop.id,
                email: email.toLowerCase().trim(),
                productId: String(product_id),
                productTitle: product_title || null,
                renderJobId: render_job_id || null,
                imageUrl: image_url || null
            }
        });

        console.log(`[See It] Email captured: ${email} for product ${product_id}`);

        return json({ success: true, id: capture.id });
    } catch (error) {
        console.error("[See It] Capture error:", error);
        return json({ error: "Failed to save email" }, { status: 500 });
    }
};

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { issueShopperToken } from "../utils/shopper-token.server";

/**
 * Validates email format
 */
function validateEmail(email: unknown): { valid: boolean; error?: string; sanitized?: string } {
    if (typeof email !== 'string') {
        return { valid: false, error: 'Email must be a string' };
    }

    const trimmed = email.trim().toLowerCase();

    // Basic email validation (RFC 5322 simplified)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
        return { valid: false, error: 'Invalid email format' };
    }

    // Reasonable length check
    if (trimmed.length > 254) {
        return { valid: false, error: 'Email too long' };
    }

    return { valid: true, sanitized: trimmed };
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const shopDomain = session.shop;

    // Get shop record
    const shop = await prisma.shop.findUnique({
        where: { shopDomain }
    });

    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }

    const body = await request.json();
    const { email } = body;

    // Validate email
    const emailResult = validateEmail(email);
    if (!emailResult.valid) {
        return json({ error: emailResult.error }, { status: 400 });
    }

    const sanitizedEmail = emailResult.sanitized!;

    // Find or create saved room owner
    const owner = await prisma.savedRoomOwner.upsert({
        where: {
            shopId_email: {
                shopId: shop.id,
                email: sanitizedEmail,
            }
        },
        update: {
            // Update doesn't change anything, but ensures it exists
        },
        create: {
            shopId: shop.id,
            email: sanitizedEmail,
        }
    });

    // Issue token
    const token = issueShopperToken(shopDomain, sanitizedEmail);

    return json({
        shopper_token: token,
    });
};

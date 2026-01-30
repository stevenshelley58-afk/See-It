import * as crypto from "crypto";

/**
 * Shopper Token Utility
 * 
 * Issues and validates signed tokens for Saved Rooms feature.
 * Tokens are scoped to shop + email and are opaque to clients.
 */

function requireTokenSecret(): string {
    const secret = process.env.SHOPPER_TOKEN_SECRET;
    if (!secret || secret.trim() === "") {
        throw new Error("SHOPPER_TOKEN_SECRET is required to issue shopper tokens");
    }
    return secret;
}

const TOKEN_SECRET = requireTokenSecret();
const TOKEN_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

export interface ShopperTokenPayload {
    shopDomain: string;
    email: string; // Already lowercased
    issuedAt: number;
    expiresAt: number;
}

/**
 * Issues a signed token for a shopper (shop + email combination)
 */
export function issueShopperToken(shopDomain: string, email: string): string {
    const issuedAt = Date.now();
    const expiresAt = issuedAt + TOKEN_EXPIRY_MS;

    const payload: ShopperTokenPayload = {
        shopDomain,
        email: email.toLowerCase().trim(),
        issuedAt,
        expiresAt,
    };

    // Create a simple payload string (base64 encoded JSON)
    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadJson).toString('base64url');

    // Create HMAC signature
    const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
    hmac.update(payloadBase64);
    const signature = hmac.digest('base64url');

    // Return token as payload.signature
    return `${payloadBase64}.${signature}`;
}

/**
 * Validates and extracts payload from a shopper token
 * Returns null if token is invalid or expired
 */
export function validateShopperToken(token: string): ShopperTokenPayload | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 2) {
            return null;
        }

        const [payloadBase64, signature] = parts;

        // Verify signature
        const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
        hmac.update(payloadBase64);
        const expectedSignature = hmac.digest('base64url');

        if (signature !== expectedSignature) {
            return null; // Invalid signature
        }

        // Decode payload
        const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
        const payload: ShopperTokenPayload = JSON.parse(payloadJson);

        // Check expiry
        if (Date.now() > payload.expiresAt) {
            return null; // Token expired
        }

        // Validate structure
        if (!payload.shopDomain || !payload.email || !payload.issuedAt || !payload.expiresAt) {
            return null;
        }

        return payload;
    } catch (error) {
        // Invalid token format or JSON parse error
        return null;
    }
}

/**
 * Extracts shopper token from request headers or query params
 */
export function extractShopperToken(request: Request): string | null {
    // Check header first
    const headerToken = request.headers.get('X-Shopper-Token');
    if (headerToken) {
        return headerToken;
    }

    // Check query param (for GET requests)
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('shopper_token');
    if (queryToken) {
        return queryToken;
    }

    return null;
}

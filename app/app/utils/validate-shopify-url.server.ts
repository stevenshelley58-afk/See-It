/**
 * Shopify URL Validator
 *
 * Prevents SSRF attacks by validating that URLs belong to Shopify CDN domains
 * before allowing the server to fetch them.
 *
 * Security: Only whitelisted Shopify domains are allowed.
 */

const SHOPIFY_CDN_DOMAINS = [
    'cdn.shopify.com',
    'cdn.shopifycdn.net',
    'shopify.com',
    'myshopify.com'
];

/**
 * Validates that a URL belongs to Shopify's CDN
 *
 * @param url - The URL to validate
 * @returns true if URL is from Shopify CDN, false otherwise
 * @throws Error if URL is malformed
 */
export function isValidShopifyUrl(url: string): boolean {
    try {
        const parsedUrl = new URL(url);

        // Only allow HTTPS
        if (parsedUrl.protocol !== 'https:') {
            return false;
        }

        // Check if hostname matches any whitelisted domain
        const hostname = parsedUrl.hostname.toLowerCase();

        return SHOPIFY_CDN_DOMAINS.some(domain =>
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
    } catch (error) {
        // Invalid URL format
        return false;
    }
}

/**
 * Validates and sanitizes a Shopify URL
 *
 * @param url - The URL to validate
 * @param context - Context string for error messages (e.g., "product image")
 * @returns The validated URL
 * @throws Error if URL is not from Shopify CDN
 */
export function validateShopifyUrl(url: string, context: string = "URL"): string {
    if (!isValidShopifyUrl(url)) {
        throw new Error(
            `Invalid ${context}: Must be from Shopify CDN (${SHOPIFY_CDN_DOMAINS.join(', ')}). Got: ${new URL(url).hostname}`
        );
    }

    return url;
}

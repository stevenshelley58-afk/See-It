/**
 * URL Validator for SSRF Prevention
 *
 * Prevents SSRF attacks by validating that URLs belong to trusted domains
 * before allowing the server to fetch them.
 *
 * Security: Only whitelisted domains are allowed:
 * - Shopify CDN domains (for product images)
 * - Google Cloud Storage (for internally processed images)
 */

// Shopify CDN domains - for product images
const SHOPIFY_CDN_DOMAINS = [
    'cdn.shopify.com',
    'cdn.shopifycdn.net',
    'shopify.com',
    'myshopify.com'
];

// GCS domains - for internally generated/processed images
const GCS_DOMAINS = [
    'storage.googleapis.com',
    'storage.cloud.google.com'
];

// Get the configured GCS bucket for additional validation
const GCS_BUCKET = process.env.GCS_BUCKET || 'see-it-room';

/**
 * Validates that a URL belongs to Shopify's CDN
 *
 * @param url - The URL to validate
 * @returns true if URL is from Shopify CDN, false otherwise
 */
export function isValidShopifyUrl(url: string): boolean {
    try {
        const parsedUrl = new URL(url);

        // Only allow HTTPS
        if (parsedUrl.protocol !== 'https:') {
            return false;
        }

        // Check if hostname matches any whitelisted Shopify domain
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
 * Validates that a URL belongs to Google Cloud Storage
 * Also validates the URL is for the configured bucket
 *
 * @param url - The URL to validate
 * @returns true if URL is from GCS and for our bucket, false otherwise
 */
export function isValidGcsUrl(url: string): boolean {
    try {
        const parsedUrl = new URL(url);

        // Only allow HTTPS
        if (parsedUrl.protocol !== 'https:') {
            return false;
        }

        const hostname = parsedUrl.hostname.toLowerCase();

        // Check if it's a GCS domain
        const isGcsDomain = GCS_DOMAINS.some(domain =>
            hostname === domain || hostname.endsWith(`.${domain}`)
        );

        if (!isGcsDomain) {
            return false;
        }

        // Validate it's for our configured bucket
        // GCS URLs can be:
        // - https://storage.googleapis.com/BUCKET/path
        // - https://BUCKET.storage.googleapis.com/path
        // - https://storage.cloud.google.com/BUCKET/path

        // Check subdomain-style bucket
        if (hostname.startsWith(`${GCS_BUCKET}.`)) {
            return true;
        }

        // Check path-style bucket
        const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0 && pathParts[0] === GCS_BUCKET) {
            return true;
        }

        return false;
    } catch (error) {
        // Invalid URL format
        return false;
    }
}

/**
 * Validates that a URL is from a trusted source (Shopify CDN or GCS)
 *
 * @param url - The URL to validate
 * @returns true if URL is from a trusted source, false otherwise
 */
export function isValidTrustedUrl(url: string): boolean {
    return isValidShopifyUrl(url) || isValidGcsUrl(url);
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
        // Try to extract hostname safely for error message
        let hostname = 'unknown';
        try {
            hostname = new URL(url).hostname;
        } catch {
            hostname = 'invalid URL';
        }
        throw new Error(
            `Invalid ${context}: Must be from Shopify CDN (${SHOPIFY_CDN_DOMAINS.join(', ')}). Got: ${hostname}`
        );
    }

    return url;
}

/**
 * Validates and sanitizes a URL from any trusted source
 *
 * @param url - The URL to validate
 * @param context - Context string for error messages
 * @returns The validated URL
 * @throws Error if URL is not from a trusted source
 */
export function validateTrustedUrl(url: string, context: string = "URL"): string {
    if (!isValidTrustedUrl(url)) {
        // Try to extract hostname safely for error message
        let hostname = 'unknown';
        try {
            hostname = new URL(url).hostname;
        } catch {
            hostname = 'invalid URL';
        }
        throw new Error(
            `Invalid ${context}: Must be from Shopify CDN or GCS. Got: ${hostname}`
        );
    }

    return url;
}

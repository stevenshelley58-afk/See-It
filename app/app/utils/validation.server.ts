/**
 * Input Validation Utilities
 *
 * Provides validation functions for user inputs in app-proxy routes
 * to prevent malformed data and potential security issues.
 */

/**
 * Validates placement coordinates for render requests
 * x and y should be normalized coordinates (0-1 range)
 * scale should be a positive number within reasonable bounds
 */
export function validatePlacement(placement: unknown): {
    valid: boolean;
    error?: string;
    sanitized?: { x: number; y: number; scale: number };
} {
    if (!placement || typeof placement !== 'object') {
        return { valid: false, error: 'Placement object is required' };
    }

    const p = placement as Record<string, unknown>;

    // Validate x coordinate
    if (typeof p.x !== 'number' || !Number.isFinite(p.x)) {
        return { valid: false, error: 'Placement x must be a finite number' };
    }

    // Validate y coordinate
    if (typeof p.y !== 'number' || !Number.isFinite(p.y)) {
        return { valid: false, error: 'Placement y must be a finite number' };
    }

    // Clamp x and y to 0-1 range (normalized coordinates)
    const x = Math.max(0, Math.min(1, p.x));
    const y = Math.max(0, Math.min(1, p.y));

    // Validate and clamp scale (allow 0.1 to 5.0)
    let scale = typeof p.scale === 'number' && Number.isFinite(p.scale) ? p.scale : 1.0;
    scale = Math.max(0.1, Math.min(5.0, scale));

    return {
        valid: true,
        sanitized: { x, y, scale }
    };
}

/**
 * Validates a UUID-like session ID
 */
export function validateSessionId(sessionId: unknown): {
    valid: boolean;
    error?: string;
    sanitized?: string;
} {
    if (typeof sessionId !== 'string') {
        return { valid: false, error: 'Session ID must be a string' };
    }

    // Trim and check length (UUIDs are 36 chars, CUIDs are ~25 chars)
    const trimmed = sessionId.trim();
    if (trimmed.length < 10 || trimmed.length > 50) {
        return { valid: false, error: 'Session ID has invalid length' };
    }

    // Only allow alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return { valid: false, error: 'Session ID contains invalid characters' };
    }

    return { valid: true, sanitized: trimmed };
}

/**
 * Validates a product ID (Shopify numeric ID)
 */
export function validateProductId(productId: unknown): {
    valid: boolean;
    error?: string;
    sanitized?: string;
} {
    if (productId === undefined || productId === null) {
        return { valid: false, error: 'Product ID is required' };
    }

    // Convert to string if number
    const idStr = String(productId).trim();

    // Remove GID prefix if present
    const numericId = idStr.replace(/^gid:\/\/shopify\/Product\//, '');

    // Should be a numeric string
    if (!/^\d+$/.test(numericId)) {
        return { valid: false, error: 'Product ID must be numeric' };
    }

    // Check reasonable length (Shopify IDs are up to 15 digits)
    if (numericId.length > 15) {
        return { valid: false, error: 'Product ID too long' };
    }

    return { valid: true, sanitized: numericId };
}

/**
 * Validates a base64 data URL (for masks)
 * Limits size to prevent memory issues
 */
export function validateMaskDataUrl(dataUrl: unknown, maxSizeBytes: number = 10 * 1024 * 1024): {
    valid: boolean;
    error?: string;
    sanitized?: string;
} {
    if (typeof dataUrl !== 'string') {
        return { valid: false, error: 'Mask data URL must be a string' };
    }

    // Check prefix
    if (!dataUrl.startsWith('data:image/')) {
        return { valid: false, error: 'Mask must be a valid image data URL' };
    }

    // Check size (base64 is ~33% larger than binary)
    if (dataUrl.length > maxSizeBytes * 1.5) {
        return { valid: false, error: `Mask image too large (max ${Math.round(maxSizeBytes / 1024 / 1024)}MB)` };
    }

    // Validate format (data:image/png;base64,...)
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,/);
    if (!match) {
        return { valid: false, error: 'Mask must be PNG, JPEG, or WebP format' };
    }

    return { valid: true, sanitized: dataUrl };
}

/**
 * Validates content type for uploads
 */
export function validateContentType(contentType: unknown): {
    valid: boolean;
    error?: string;
    sanitized?: string;
} {
    if (typeof contentType !== 'string') {
        return { valid: false, error: 'Content type must be a string' };
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const normalized = contentType.toLowerCase().trim();

    if (!allowedTypes.includes(normalized)) {
        return { valid: false, error: `Invalid content type. Allowed: ${allowedTypes.join(', ')}` };
    }

    return { valid: true, sanitized: normalized };
}

/**
 * Validates style preset for renders
 */
export function validateStylePreset(preset: unknown): string {
    const allowedPresets = ['neutral', 'warm', 'cool', 'dramatic', 'natural'];
    if (typeof preset === 'string' && allowedPresets.includes(preset.toLowerCase())) {
        return preset.toLowerCase();
    }
    return 'neutral'; // Default
}

/**
 * Validates quality setting for renders
 */
export function validateQuality(quality: unknown): string {
    const allowedQualities = ['standard', 'high', 'ultra'];
    if (typeof quality === 'string' && allowedQualities.includes(quality.toLowerCase())) {
        return quality.toLowerCase();
    }
    return 'standard'; // Default
}

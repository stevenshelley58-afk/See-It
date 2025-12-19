/**
 * Canvas Performance Utilities
 *
 * Shared optimizations for all canvas-based brush tools:
 * - Throttled event handlers
 * - Pre-rendered checkerboard pattern
 * - requestAnimationFrame batching
 * - Region-of-interest (ROI) processing
 */

// ============================================================================
// THROTTLING & DEBOUNCING
// ============================================================================

/**
 * Throttle function calls using requestAnimationFrame
 * This ensures we don't update faster than the display can render
 */
export function rafThrottle(callback) {
    let rafId = null;
    let lastArgs = null;

    const throttled = (...args) => {
        lastArgs = args;
        if (rafId === null) {
            rafId = requestAnimationFrame(() => {
                rafId = null;
                callback(...lastArgs);
            });
        }
    };

    throttled.cancel = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    };

    return throttled;
}

/**
 * Throttle with minimum time interval (useful for expensive operations)
 * @param {Function} callback
 * @param {number} minInterval - Minimum ms between calls
 */
export function timeThrottle(callback, minInterval = 16) {
    let lastCall = 0;
    let timeoutId = null;

    const throttled = (...args) => {
        const now = Date.now();
        const timeSinceLastCall = now - lastCall;

        if (timeSinceLastCall >= minInterval) {
            lastCall = now;
            callback(...args);
        } else if (!timeoutId) {
            // Schedule trailing call
            timeoutId = setTimeout(() => {
                lastCall = Date.now();
                timeoutId = null;
                callback(...args);
            }, minInterval - timeSinceLastCall);
        }
    };

    throttled.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    return throttled;
}

/**
 * Debounce function calls
 * @param {Function} callback
 * @param {number} delay - Delay in ms
 */
export function debounce(callback, delay = 100) {
    let timeoutId = null;

    const debounced = (...args) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            timeoutId = null;
            callback(...args);
        }, delay);
    };

    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    debounced.flush = (...args) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
            callback(...args);
        }
    };

    return debounced;
}

// ============================================================================
// CHECKERBOARD PATTERN
// ============================================================================

// Cache for pre-rendered checkerboard patterns
const checkerboardCache = new Map();

/**
 * Get or create a cached checkerboard pattern
 * @param {number} checkSize - Size of each check in pixels
 * @param {string} lightColor - Light square color
 * @param {string} darkColor - Dark square color
 * @returns {CanvasPattern}
 */
export function getCheckerboardPattern(checkSize = 16, lightColor = '#ffffff', darkColor = '#e0e0e0') {
    const key = `${checkSize}-${lightColor}-${darkColor}`;

    if (checkerboardCache.has(key)) {
        return checkerboardCache.get(key);
    }

    // Create a small canvas with just 2x2 checks
    const patternSize = checkSize * 2;
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = patternSize;
    patternCanvas.height = patternSize;
    const patternCtx = patternCanvas.getContext('2d');

    // Draw the 4 squares
    patternCtx.fillStyle = lightColor;
    patternCtx.fillRect(0, 0, checkSize, checkSize);
    patternCtx.fillRect(checkSize, checkSize, checkSize, checkSize);

    patternCtx.fillStyle = darkColor;
    patternCtx.fillRect(checkSize, 0, checkSize, checkSize);
    patternCtx.fillRect(0, checkSize, checkSize, checkSize);

    checkerboardCache.set(key, patternCanvas);
    return patternCanvas;
}

/**
 * Draw checkerboard background efficiently using pattern fill
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} checkSize
 */
export function drawCheckerboard(ctx, width, height, checkSize = 16) {
    const patternCanvas = getCheckerboardPattern(checkSize);
    const pattern = ctx.createPattern(patternCanvas, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
}

// ============================================================================
// OPTIMIZED IMAGE DATA OPERATIONS
// ============================================================================

/**
 * Get ImageData for a region of interest only
 * Much faster than getting full canvas data for large images
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} radius
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
export function getROIImageData(ctx, centerX, centerY, radius, canvasWidth, canvasHeight) {
    const padding = 2; // Small padding for edge cases
    const x = Math.max(0, Math.floor(centerX - radius - padding));
    const y = Math.max(0, Math.floor(centerY - radius - padding));
    const width = Math.min(canvasWidth - x, Math.ceil(radius * 2 + padding * 2));
    const height = Math.min(canvasHeight - y, Math.ceil(radius * 2 + padding * 2));

    return {
        imageData: ctx.getImageData(x, y, width, height),
        offsetX: x,
        offsetY: y,
        width,
        height,
    };
}

/**
 * Apply a circular brush to ImageData (alpha channel only)
 * Optimized with early bounds checking and integer math
 * @param {ImageData} imageData
 * @param {number} centerX - Center X relative to imageData
 * @param {number} centerY - Center Y relative to imageData
 * @param {number} radius
 * @param {string} mode - 'add' or 'subtract'
 * @param {number} strength - 0-255
 */
export function applyCircularBrushToAlpha(imageData, centerX, centerY, radius, mode = 'add', strength = 255) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const radiusSq = radius * radius;

    // Pre-calculate bounds
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(width - 1, Math.ceil(centerX + radius));

    for (let y = minY; y <= maxY; y++) {
        const dy = y - centerY;
        const dySq = dy * dy;
        const rowOffset = y * width;

        for (let x = minX; x <= maxX; x++) {
            const dx = x - centerX;
            const distSq = dx * dx + dySq;

            if (distSq <= radiusSq) {
                // Quadratic falloff for smooth edges
                const dist = Math.sqrt(distSq);
                const falloff = 1 - (dist / radius);
                const pixelStrength = falloff * falloff * strength;

                const alphaIdx = (rowOffset + x) * 4 + 3;
                const current = data[alphaIdx];

                if (mode === 'add') {
                    data[alphaIdx] = Math.min(255, current + pixelStrength);
                } else {
                    data[alphaIdx] = Math.max(0, current - pixelStrength);
                }
            }
        }
    }
}

/**
 * Composite two ImageData arrays (source onto dest with alpha)
 * Uses Uint32Array for faster pixel access
 * @param {ImageData} destData
 * @param {ImageData} srcData
 * @param {ImageData} maskData - Alpha mask to apply
 */
export function compositeWithMask(destData, srcData, maskData) {
    const dest = new Uint32Array(destData.data.buffer);
    const src = new Uint32Array(srcData.data.buffer);
    const mask = maskData.data;
    const length = dest.length;

    for (let i = 0; i < length; i++) {
        const alpha = mask[i * 4 + 3];
        if (alpha > 0) {
            // Extract RGBA from source (little-endian: ABGR)
            const srcPixel = src[i];
            const srcR = srcPixel & 0xFF;
            const srcG = (srcPixel >> 8) & 0xFF;
            const srcB = (srcPixel >> 16) & 0xFF;

            // Set with new alpha
            dest[i] = (alpha << 24) | (srcB << 16) | (srcG << 8) | srcR;
        }
    }
}

/**
 * Fast pixel counting for mask coverage
 * Uses Uint32Array for 4x faster iteration
 * @param {ImageData} imageData
 * @param {number} threshold - Alpha threshold (0-255)
 * @returns {number} - Count of pixels above threshold
 */
export function countPixelsAboveThreshold(imageData, threshold = 128) {
    const data = imageData.data;
    let count = 0;
    // Only check alpha channel (every 4th byte starting at index 3)
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > threshold) count++;
    }
    return count;
}

// ============================================================================
// OVERLAY RENDERING
// ============================================================================

/**
 * Draw a mask overlay efficiently using ImageData manipulation
 * Much faster than pixel-by-pixel fillRect
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} mask - Mask object with data, width, height
 * @param {string} color - 'green' or 'red'
 * @param {number} alpha - Overlay alpha (0-1)
 */
export function drawMaskOverlay(ctx, mask, color = 'green', alpha = 0.3) {
    if (!mask || !mask.data) return;

    const { width, height } = mask;
    const overlayData = ctx.createImageData(width, height);
    const pixels = overlayData.data;

    // Pre-calculate color values
    const r = color === 'green' ? 34 : 239;
    const g = color === 'green' ? 197 : 68;
    const b = color === 'green' ? 94 : 68;
    const a = Math.round(alpha * 255);

    for (let i = 0; i < mask.data.length; i++) {
        if (mask.data[i] === 1) {
            const pixelIndex = i * 4;
            pixels[pixelIndex] = r;
            pixels[pixelIndex + 1] = g;
            pixels[pixelIndex + 2] = b;
            pixels[pixelIndex + 3] = a;
        }
    }

    // Use a temporary canvas for alpha blending
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(overlayData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
}

// ============================================================================
// OFFSCREEN CANVAS SUPPORT
// ============================================================================

/**
 * Check if OffscreenCanvas is available
 */
export function hasOffscreenCanvas() {
    return typeof OffscreenCanvas !== 'undefined';
}

/**
 * Create an offscreen or regular canvas
 * @param {number} width
 * @param {number} height
 */
export function createWorkCanvas(width, height) {
    if (hasOffscreenCanvas()) {
        return new OffscreenCanvas(width, height);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

// ============================================================================
// BRUSH INTERPOLATION
// ============================================================================

/**
 * Interpolate brush strokes between two points for smooth lines
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} spacing - Spacing between points (fraction of brush size)
 * @param {Function} callback - Called for each interpolated point
 */
export function interpolateBrushStroke(x1, y1, x2, y2, spacing, callback) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < spacing) {
        callback(x2, y2);
        return;
    }

    const steps = Math.ceil(dist / spacing);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = x1 + dx * t;
        const y = y1 + dy * t;
        callback(x, y);
    }
}

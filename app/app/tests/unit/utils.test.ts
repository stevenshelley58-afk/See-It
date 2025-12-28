/**
 * Unit tests for utility functions
 *
 * Tests for status-mapping and validation utilities
 */

import { describe, it, expect } from "vitest";
import { getStatusInfo, formatErrorMessage } from "../../utils/status-mapping";
import {
    validatePlacement,
    validateSessionId,
    validateProductId,
    validateStylePreset,
    validateQuality,
    validateContentType,
} from "../../utils/validation.server";

describe("status-mapping", () => {
    describe("getStatusInfo", () => {
        it("should return 'Not Processed' for null status", () => {
            const result = getStatusInfo(null);
            expect(result.label).toBe("Not Processed");
            expect(result.tone).toBe("new");
            expect(result.buttonDisabled).toBe(false);
        });

        it("should return 'Not Processed' for undefined status", () => {
            const result = getStatusInfo(undefined);
            expect(result.label).toBe("Not Processed");
        });

        it("should return 'Not Processed' for 'unprepared' status", () => {
            const result = getStatusInfo("unprepared");
            expect(result.label).toBe("Not Processed");
            expect(result.buttonLabel).toBe("Remove BG");
        });

        it("should return 'Queued' for 'pending' status", () => {
            const result = getStatusInfo("pending");
            expect(result.label).toBe("Queued");
            expect(result.tone).toBe("attention");
            expect(result.buttonDisabled).toBe(true);
            expect(result.showSpinner).toBe(true);
        });

        it("should return 'Removing BG...' for 'processing' status", () => {
            const result = getStatusInfo("processing");
            expect(result.label).toBe("Removing BG...");
            expect(result.showSpinner).toBe(true);
        });

        it("should return 'BG Removed' for 'ready' status", () => {
            const result = getStatusInfo("ready");
            expect(result.label).toBe("BG Removed");
            expect(result.tone).toBe("success");
            expect(result.buttonLabel).toBe("Re-process");
        });

        it("should return 'Error' for 'failed' status", () => {
            const result = getStatusInfo("failed");
            expect(result.label).toBe("Error");
            expect(result.tone).toBe("critical");
            expect(result.buttonLabel).toBe("Retry");
        });

        it("should return 'Outdated' for 'stale' status", () => {
            const result = getStatusInfo("stale");
            expect(result.label).toBe("Outdated");
            expect(result.tone).toBe("warning");
        });

        it("should return 'Missing Source' for 'orphaned' status", () => {
            const result = getStatusInfo("orphaned");
            expect(result.label).toBe("Missing Source");
            expect(result.tone).toBe("info");
        });

        it("should handle unknown status gracefully", () => {
            const result = getStatusInfo("unknown-status");
            expect(result.label).toBe("unknown-status");
            expect(result.tone).toBe("new");
        });
    });

    describe("formatErrorMessage", () => {
        it("should return null for null input", () => {
            expect(formatErrorMessage(null)).toBe(null);
        });

        it("should return null for undefined input", () => {
            expect(formatErrorMessage(undefined)).toBe(null);
        });

        it("should return short messages unchanged", () => {
            const message = "Short error";
            expect(formatErrorMessage(message)).toBe(message);
        });

        it("should truncate long messages with ellipsis", () => {
            const longMessage = "A".repeat(150);
            const result = formatErrorMessage(longMessage, 100);
            expect(result).toBe("A".repeat(100) + "...");
        });

        it("should use default maxLength of 100", () => {
            const message = "A".repeat(105);
            const result = formatErrorMessage(message);
            expect(result?.length).toBe(103); // 100 + "..."
        });

        it("should handle exactly maxLength characters", () => {
            const message = "A".repeat(100);
            const result = formatErrorMessage(message, 100);
            expect(result).toBe(message);
        });
    });
});

describe("validation", () => {
    describe("validatePlacement", () => {
        it("should reject null placement", () => {
            const result = validatePlacement(null);
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Placement object is required");
        });

        it("should reject non-object placement", () => {
            const result = validatePlacement("string");
            expect(result.valid).toBe(false);
        });

        it("should reject non-finite x coordinate", () => {
            const result = validatePlacement({ x: NaN, y: 0.5, scale: 1 });
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Placement x must be a finite number");
        });

        it("should reject non-finite y coordinate", () => {
            const result = validatePlacement({ x: 0.5, y: Infinity, scale: 1 });
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Placement y must be a finite number");
        });

        it("should accept valid placement", () => {
            const result = validatePlacement({ x: 0.5, y: 0.5, scale: 1 });
            expect(result.valid).toBe(true);
            expect(result.sanitized).toEqual({ x: 0.5, y: 0.5, scale: 1 });
        });

        it("should clamp x to 0-1 range", () => {
            const result = validatePlacement({ x: 1.5, y: 0.5, scale: 1 });
            expect(result.valid).toBe(true);
            expect(result.sanitized?.x).toBe(1);
        });

        it("should clamp y to 0-1 range", () => {
            const result = validatePlacement({ x: 0.5, y: -0.5, scale: 1 });
            expect(result.valid).toBe(true);
            expect(result.sanitized?.y).toBe(0);
        });

        it("should clamp scale to 0.1-5.0 range", () => {
            const result = validatePlacement({ x: 0.5, y: 0.5, scale: 10 });
            expect(result.valid).toBe(true);
            expect(result.sanitized?.scale).toBe(5.0);
        });

        it("should default scale to 1.0 if not provided", () => {
            const result = validatePlacement({ x: 0.5, y: 0.5 });
            expect(result.valid).toBe(true);
            expect(result.sanitized?.scale).toBe(1.0);
        });
    });

    describe("validateSessionId", () => {
        it("should reject non-string session ID", () => {
            const result = validateSessionId(123);
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Session ID must be a string");
        });

        it("should reject too short session ID", () => {
            const result = validateSessionId("abc");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Session ID has invalid length");
        });

        it("should reject too long session ID", () => {
            const result = validateSessionId("a".repeat(51));
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Session ID has invalid length");
        });

        it("should reject invalid characters", () => {
            const result = validateSessionId("session@id#123");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Session ID contains invalid characters");
        });

        it("should accept valid UUID-like session ID", () => {
            const result = validateSessionId("550e8400-e29b-41d4-a716-446655440000");
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe("550e8400-e29b-41d4-a716-446655440000");
        });

        it("should trim whitespace", () => {
            const result = validateSessionId("  session-id-123  ");
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe("session-id-123");
        });
    });

    describe("validateProductId", () => {
        it("should reject null product ID", () => {
            const result = validateProductId(null);
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Product ID is required");
        });

        it("should reject non-numeric product ID", () => {
            const result = validateProductId("abc123");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Product ID must be numeric");
        });

        it("should reject too long product ID", () => {
            const result = validateProductId("1".repeat(16));
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Product ID too long");
        });

        it("should accept numeric string product ID", () => {
            const result = validateProductId("123456789");
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe("123456789");
        });

        it("should accept numeric product ID", () => {
            const result = validateProductId(123456789);
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe("123456789");
        });

        it("should strip GID prefix", () => {
            const result = validateProductId("gid://shopify/Product/123456789");
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe("123456789");
        });
    });

    describe("validateStylePreset", () => {
        it("should return valid preset", () => {
            expect(validateStylePreset("warm")).toBe("warm");
            expect(validateStylePreset("cool")).toBe("cool");
            expect(validateStylePreset("dramatic")).toBe("dramatic");
        });

        it("should normalize to lowercase", () => {
            expect(validateStylePreset("WARM")).toBe("warm");
        });

        it("should return default for invalid preset", () => {
            expect(validateStylePreset("invalid")).toBe("neutral");
        });

        it("should return default for non-string", () => {
            expect(validateStylePreset(123)).toBe("neutral");
        });
    });

    describe("validateQuality", () => {
        it("should return valid quality", () => {
            expect(validateQuality("standard")).toBe("standard");
            expect(validateQuality("high")).toBe("high");
            expect(validateQuality("ultra")).toBe("ultra");
        });

        it("should normalize to lowercase", () => {
            expect(validateQuality("HIGH")).toBe("high");
        });

        it("should return default for invalid quality", () => {
            expect(validateQuality("invalid")).toBe("standard");
        });
    });

    describe("validateContentType", () => {
        it("should reject non-string content type", () => {
            const result = validateContentType(123);
            expect(result.valid).toBe(false);
        });

        it("should accept valid image types", () => {
            expect(validateContentType("image/jpeg").valid).toBe(true);
            expect(validateContentType("image/png").valid).toBe(true);
            expect(validateContentType("image/webp").valid).toBe(true);
        });

        it("should reject invalid content types", () => {
            const result = validateContentType("text/html");
            expect(result.valid).toBe(false);
        });

        it("should normalize to lowercase", () => {
            const result = validateContentType("IMAGE/JPEG");
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe("image/jpeg");
        });
    });
});

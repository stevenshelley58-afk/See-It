import { describe, it, expect } from "vitest";
import { buildPlacementTabMetadata } from "../../components/ProductDetailPanel/placementTabMetadata.js";

describe("buildPlacementTabMetadata", () => {
    const base = {
        enabled: false,
        originalEnabled: false,
    } as const;

    it("omits enabled when unchanged", () => {
        const meta = buildPlacementTabMetadata(base);
        expect(meta.enabled).toBeUndefined();
        expect(meta.dirty).toBe(false);
    });

    it("includes enabled and marks dirty when changed", () => {
        const meta = buildPlacementTabMetadata({
            ...base,
            enabled: false,
            originalEnabled: true,
        });

        expect(meta.enabled).toBe(false);
        expect(meta.dirty).toBe(true);
    });

    it("returns only enabled field", () => {
        const meta = buildPlacementTabMetadata(base);
        // Should only have enabled and dirty fields
        expect(meta).toHaveProperty("dirty");
        // Should NOT have removed fields
        expect(meta).not.toHaveProperty("merchantOverrides");
        expect(meta).not.toHaveProperty("merchantOverridesDirty");
        expect(meta).not.toHaveProperty("_uiFields");
        expect(meta).not.toHaveProperty("renderInstructions");
        expect(meta).not.toHaveProperty("placementFields");
        expect(meta).not.toHaveProperty("placementRulesConfig");
    });
});

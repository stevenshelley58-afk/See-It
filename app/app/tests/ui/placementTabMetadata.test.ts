import { describe, it, expect } from "vitest";
import { buildPlacementTabMetadata } from "../../components/ProductDetailPanel/placementTabMetadata.js";

describe("buildPlacementTabMetadata", () => {
    const base = {
        description: "",
        seeItNowPrompt: "",
        seeItNowDirty: false,
        fields: {
            surface: "floor",
            material: "wood",
            orientation: "upright",
            shadow: "none",
            dimensions: undefined,
            additionalNotes: "",
        },
        placementRulesFields: {
            sceneRole: null,
            replacementRule: null,
            allowSpaceCreation: undefined,
        },
        merchantOverrides: {},
        merchantOverridesDirty: false,
        hasEdited: false,
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

    it("returns only canonical fields (no legacy fields)", () => {
        const meta = buildPlacementTabMetadata(base);
        // Should only have canonical fields
        expect(meta).toHaveProperty("merchantOverrides");
        expect(meta).toHaveProperty("merchantOverridesDirty");
        expect(meta).toHaveProperty("dirty");
        // Should have UI-only fields under _uiFields
        expect(meta).toHaveProperty("_uiFields");
        // Legacy fields should NOT exist at top level
        expect(meta).not.toHaveProperty("renderInstructions");
        expect(meta).not.toHaveProperty("placementFields");
        expect(meta).not.toHaveProperty("placementRulesConfig");
    });

    it("marks dirty when merchantOverrides change", () => {
        const meta = buildPlacementTabMetadata({
            ...base,
            merchantOverrides: { material_profile: { primary: "glass" } },
            merchantOverridesDirty: true,
        });

        expect(meta.dirty).toBe(true);
        expect(meta.merchantOverridesDirty).toBe(true);
    });
});

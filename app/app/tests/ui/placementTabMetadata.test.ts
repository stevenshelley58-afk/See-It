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
});


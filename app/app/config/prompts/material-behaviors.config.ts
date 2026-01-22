/**
 * Material-specific rendering rules
 *
 * These are selected deterministically based on resolved_facts.material_profile.primary
 * and injected into the LLM #2 input. The LLM must incorporate them into product_context.
 */

export interface MaterialBehavior {
  material: string;
  rules: string[];
}

export const MATERIAL_BEHAVIORS: Record<string, MaterialBehavior> = {
  mirror: {
    material: "mirror",
    rules: [
      "Reflections must be consistent with room lighting and camera viewpoint.",
      "Show realistic reflectivity with proper edge definition.",
      "Reflection should show plausible room content at correct angles, not invented details.",
      "Preserve exact frame and any mounting hardware from the product image.",
    ],
  },

  glass: {
    material: "glass",
    rules: [
      "Show correct transparency with visible background through the glass.",
      "Include appropriate highlights and edge reflections.",
      "Must not look like plastic or acrylic.",
      "If containing objects, ensure they are visible through the glass.",
    ],
  },

  reclaimed_teak: {
    material: "reclaimed_teak",
    rules: [
      "Preserve natural grain pattern exactly as shown in product image.",
      "Do not smooth, polish, or homogenize the wood texture.",
      "Maintain visible weathering, knots, and character marks — these are features.",
      "Match ambient color temperature; teak has warm undertones.",
      "Product should look substantial — reclaimed teak is heavy.",
    ],
  },

  painted_wood: {
    material: "painted_wood",
    rules: [
      "Preserve paint finish as shown — matte, satin, or gloss.",
      "Maintain any visible brush strokes, wear patterns, or distressing.",
      "Color should match product image exactly under room lighting.",
    ],
  },

  ceramic: {
    material: "ceramic",
    rules: [
      "Preserve glaze characteristics — pooling in crevices, breaking on edges.",
      "Maintain surface texture including any throwing marks or hand-made qualities.",
      "Show appropriate light reflection based on glaze finish.",
    ],
  },

  metal: {
    material: "metal",
    rules: [
      "Preserve patina, brushing direction, or polished finish as shown.",
      "Show appropriate reflectivity based on finish type.",
      "Maintain any oxidation, aging, or intentional distressing.",
    ],
  },

  stone: {
    material: "stone",
    rules: [
      "Preserve natural veining and color variation exactly.",
      "Maintain surface finish — polished, honed, or natural.",
      "Product should appear heavy and substantial.",
    ],
  },

  fabric: {
    material: "fabric",
    rules: [
      "Preserve texture and weave pattern visible in product image.",
      "Show appropriate light absorption or sheen based on fabric type.",
      "Maintain any intentional wrinkles, draping, or cushion compression.",
    ],
  },

  leather: {
    material: "leather",
    rules: [
      "Preserve grain pattern and any natural markings.",
      "Maintain patina, wear patterns, or distressing if present.",
      "Show appropriate sheen based on leather finish.",
    ],
  },

  mixed: {
    material: "mixed",
    rules: [
      "Preserve the distinct character of each material component.",
      "Maintain transitions between materials as shown in product image.",
      "Each material should exhibit its natural properties.",
    ],
  },

  unknown: {
    material: "unknown",
    rules: [
      "Preserve surface characteristics exactly as shown in product image.",
      "Maintain any visible texture, finish, or material qualities.",
    ],
  },
};

/**
 * Get material rules for a given material type
 */
export function getMaterialRulesForPrompt(materialPrimary: string): string {
  const behavior =
    MATERIAL_BEHAVIORS[materialPrimary] || MATERIAL_BEHAVIORS.unknown;
  return behavior.rules.join("\n");
}

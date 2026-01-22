/**
 * JSON Schema for ProductPlacementFacts
 * Used for Gemini structured output
 */

export const PRODUCT_PLACEMENT_FACTS_SCHEMA = {
  type: "object",
  properties: {
    identity: {
      type: "object",
      properties: {
        title: { type: "string" },
        product_kind: { type: ["string", "null"] },
        category_path: { type: "array", items: { type: "string" } },
        style_cues: { type: "array", items: { type: "string" } },
      },
      required: ["title", "category_path", "style_cues"],
    },
    dimensions_cm: {
      type: "object",
      properties: {
        h: { type: ["number", "null"] },
        w: { type: ["number", "null"] },
        d: { type: ["number", "null"] },
        diameter: { type: ["number", "null"] },
        thickness: { type: ["number", "null"] },
      },
    },
    weight_class: {
      type: "string",
      enum: ["very_heavy", "heavy", "medium", "light", "unknown"],
    },
    deformability: {
      type: "string",
      enum: ["rigid", "semi_rigid", "flexible_drape", "unknown"],
    },
    placement: {
      type: "object",
      properties: {
        allowed_modes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mode: { type: "string" },
              confidence: { type: "number" },
              evidence: { type: ["string", "null"] },
            },
            required: ["mode", "confidence"],
          },
        },
        support_surfaces: {
          type: "array",
          items: {
            type: "object",
            properties: {
              surface: { type: "string" },
              confidence: { type: "number" },
              evidence: { type: ["string", "null"] },
            },
            required: ["surface", "confidence"],
          },
        },
        constraints: { type: "array", items: { type: "string" } },
        do_not_do: { type: "array", items: { type: "string" } },
      },
      required: ["allowed_modes", "support_surfaces", "constraints", "do_not_do"],
    },
    orientation: {
      type: "object",
      properties: {
        constraint: {
          type: "string",
          enum: [
            "upright_only",
            "can_rotate_slightly",
            "free_rotation",
            "unknown",
          ],
        },
        notes: { type: ["string", "null"] },
      },
      required: ["constraint"],
    },
    scale: {
      type: "object",
      properties: {
        priority: {
          type: "string",
          enum: [
            "strict_true_to_dimensions",
            "prefer_true_to_dimensions",
            "flexible_if_no_reference",
          ],
        },
        notes: { type: ["string", "null"] },
      },
      required: ["priority"],
    },
    relative_scale: {
      type: "object",
      properties: {
        class: {
          type: "string",
          enum: [
            "tiny",
            "small",
            "medium",
            "large",
            "oversized",
            "architectural",
            "unknown",
          ],
        },
        evidence: { type: ["string", "null"] },
        comparisons: {
          type: "array",
          items: {
            type: "object",
            properties: {
              to: { type: "string" },
              confidence: { type: "number" },
              evidence: { type: ["string", "null"] },
            },
            required: ["to", "confidence"],
          },
        },
      },
      required: ["class", "comparisons"],
    },
    material_profile: {
      type: "object",
      properties: {
        primary: {
          type: "string",
          enum: [
            "reclaimed_teak",
            "painted_wood",
            "glass",
            "mirror",
            "ceramic",
            "metal",
            "stone",
            "fabric",
            "leather",
            "mixed",
            "unknown",
          ],
        },
        sheen: {
          type: "string",
          enum: ["matte", "satin", "gloss", "unknown"],
        },
        transparency: {
          type: "string",
          enum: ["opaque", "translucent", "transparent", "unknown"],
        },
        notes: { type: ["string", "null"] },
      },
      required: ["primary", "sheen", "transparency"],
    },
    render_behavior: {
      type: "object",
      properties: {
        surface: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string" },
              strength: { type: ["string", "null"] },
              notes: { type: ["string", "null"] },
            },
            required: ["kind"],
          },
        },
        lighting: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string" },
              notes: { type: ["string", "null"] },
            },
            required: ["kind"],
          },
        },
        interaction_rules: { type: "array", items: { type: "string" } },
        cropping_policy: {
          type: "string",
          enum: ["never_crop_product", "allow_small_crop", "allow_crop_if_needed"],
        },
      },
      required: ["surface", "lighting", "interaction_rules", "cropping_policy"],
    },
    scale_guardrails: { type: ["string", "null"] },
    affordances: { type: "array", items: { type: "string" } },
    unknowns: { type: "array", items: { type: "string" } },
  },
  required: [
    "identity",
    "dimensions_cm",
    "weight_class",
    "deformability",
    "placement",
    "orientation",
    "scale",
    "relative_scale",
    "material_profile",
    "render_behavior",
    "affordances",
    "unknowns",
  ],
};

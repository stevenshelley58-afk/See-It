// =============================================================================
// ProductPlacementFacts - LLM #1 Output
// =============================================================================

export interface ProductPlacementFacts {
  identity: {
    title: string;
    product_kind: string | null;
    category_path: string[];
    style_cues: string[];
  };

  dimensions_cm: {
    h: number | null;
    w: number | null;
    d: number | null;
    diameter: number | null;
    thickness: number | null;
  };

  weight_class: "very_heavy" | "heavy" | "medium" | "light" | "unknown";

  deformability: "rigid" | "semi_rigid" | "flexible_drape" | "unknown";

  placement: {
    allowed_modes: Array<{
      mode: string;
      confidence: number;
      evidence: string | null;
    }>;
    support_surfaces: Array<{
      surface: string;
      confidence: number;
      evidence: string | null;
    }>;
    constraints: string[];
    do_not_do: string[];
  };

  orientation: {
    constraint:
      | "upright_only"
      | "can_rotate_slightly"
      | "free_rotation"
      | "unknown";
    notes: string | null;
  };

  scale: {
    priority:
      | "strict_true_to_dimensions"
      | "prefer_true_to_dimensions"
      | "flexible_if_no_reference";
    notes: string | null;
  };

  relative_scale: {
    class:
      | "tiny"
      | "small"
      | "medium"
      | "large"
      | "oversized"
      | "architectural"
      | "unknown";
    evidence: string | null;
    comparisons: Array<{
      to: string;
      confidence: number;
      evidence: string | null;
    }>;
  };

  material_profile: {
    primary:
      | "reclaimed_teak"
      | "painted_wood"
      | "glass"
      | "mirror"
      | "ceramic"
      | "metal"
      | "stone"
      | "fabric"
      | "leather"
      | "mixed"
      | "unknown";
    sheen: "matte" | "satin" | "gloss" | "unknown";
    transparency: "opaque" | "translucent" | "transparent" | "unknown";
    notes: string | null;
  };

  render_behavior: {
    surface: Array<{
      kind: string;
      strength: string | null;
      notes: string | null;
    }>;
    lighting: Array<{
      kind: string;
      notes: string | null;
    }>;
    interaction_rules: string[];
    cropping_policy:
      | "never_crop_product"
      | "allow_small_crop"
      | "allow_crop_if_needed";
  };

  scale_guardrails: string | null;

  affordances: string[];
  unknowns: string[];
}

// =============================================================================
// PromptPack - LLM #2 Output
// =============================================================================

export interface PromptPackVariant {
  id: string; // "V01" .. "V08"
  variation: string;
}

export interface PromptPack {
  product_context: string;
  variants: PromptPackVariant[];
}

// =============================================================================
// Extraction Input
// =============================================================================

export interface ExtractionInput {
  title: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  metafields: Record<string, string>;
  imageUrls: string[]; // 1-3 representative product images
}

// =============================================================================
// Render Types
// =============================================================================

export interface ImageMeta {
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export interface RenderInput {
  shopId: string;
  productAssetId: string;
  roomSessionId: string;
  requestId: string;
  productImage: {
    buffer: Buffer;
    hash: string;
    meta: ImageMeta;
    geminiUri?: string;
  };
  roomImage: {
    buffer: Buffer;
    hash: string;
    meta: ImageMeta;
    geminiUri?: string;
  };
  resolvedFacts: ProductPlacementFacts;
  promptPack: PromptPack;
  promptPackVersion: number;
}

export interface VariantRenderResult {
  variantId: string;
  status: "success" | "failed" | "timeout";
  latencyMs: number;
  imageBase64?: string;
  imageKey?: string;
  imageHash?: string;
  errorMessage?: string;
}

export interface RenderRunResult {
  runId: string;
  status: "complete" | "partial" | "failed";
  totalDurationMs: number;
  variants: VariantRenderResult[];
}

// =============================================================================
// Variant Intent Config
// =============================================================================

export interface VariantIntent {
  id: string;
  intent: string;
  placementMode: "primary" | "secondary" | "alternative";
  scaleStrategy:
    | "best-guess"
    | "smaller"
    | "larger"
    | "context-heavy"
    | "conservative";
  scaleNote: string;
  anchorRule: string | null; // null for V07, V08 which have special rules
}

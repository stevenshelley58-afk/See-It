// =============================================================================
// Core Domain Types
// =============================================================================

/** LLM #1 output - product facts extracted from Shopify data */
export interface ProductFacts {
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
  weight_class: 'very_heavy' | 'heavy' | 'medium' | 'light' | 'unknown';
  deformability: 'rigid' | 'semi_rigid' | 'flexible_drape' | 'unknown';
  placement: {
    allowed_modes: Array<{ mode: string; confidence: number; evidence: string | null }>;
    support_surfaces: Array<{ surface: string; confidence: number; evidence: string | null }>;
    constraints: string[];
    do_not_do: string[];
  };
  orientation: {
    constraint: 'upright_only' | 'can_rotate_slightly' | 'free_rotation' | 'unknown';
    notes: string | null;
  };
  scale: {
    priority: 'strict_true_to_dimensions' | 'prefer_true_to_dimensions' | 'flexible_if_no_reference';
    notes: string | null;
  };
  relative_scale: {
    class: 'tiny' | 'small' | 'medium' | 'large' | 'oversized' | 'architectural' | 'unknown';
    evidence: string | null;
    comparisons: Array<{ to: string; confidence: number; evidence: string | null }>;
  };
  material_profile: {
    primary: 'reclaimed_teak' | 'painted_wood' | 'glass' | 'mirror' | 'ceramic' | 'metal' | 'stone' | 'fabric' | 'leather' | 'mixed' | 'unknown';
    sheen: 'matte' | 'satin' | 'gloss' | 'unknown';
    transparency: 'opaque' | 'translucent' | 'transparent' | 'unknown';
    notes: string | null;
  };
  render_behavior: {
    surface: Array<{ kind: string; strength: string | null; notes: string | null }>;
    lighting: Array<{ kind: string; notes: string | null }>;
    interaction_rules: string[];
    cropping_policy: 'never_crop_product' | 'allow_small_crop' | 'allow_crop_if_needed';
  };
  scale_guardrails: string | null;
  affordances: string[];
  unknowns: string[];
}

/** LLM #2 output - placement set with product description and variants */
export interface PlacementSet {
  productDescription: string;  // NOT product_context
  variants: PlacementVariant[];
}

export interface PlacementVariant {
  id: string;  // 'V01' .. 'V08'
  placementInstruction: string;  // NOT variation
}

// =============================================================================
// Pipeline Config Types
// =============================================================================

/** Canonical prompt names - stored as strings in DB */
export type PromptName = 'product_fact_extractor' | 'placement_set_generator' | 'composite_instruction';

export interface ResolvedPrompt {
  name: PromptName;
  versionId: string;
  templateHash: string;
  model: string;
  params: Record<string, unknown>;
}

export interface PipelineConfigSnapshot {
  prompts: Record<PromptName, ResolvedPrompt>;
  runtimeConfig: {
    timeouts: { perVariantMs: number; totalMs: number };
    retries: { maxPerVariant: number };
    variantCount: number;
    earlyReturnAt: number;
  };
  // NOTE: resolvedAt is NOT included in hash computation
  resolvedAt: string;
}

// =============================================================================
// Observability Types (Gemini Best Practice)
// =============================================================================

export type ImageRole = 'prepared_product_image' | 'customer_room_image' | 'reference';
export type InputMethod = 'INLINE' | 'FILES_API' | 'GCS_REGISTERED' | 'URL';
export type AspectRatioSource = 'EXPLICIT' | 'ROOM_IMAGE_LAST' | 'UNKNOWN';

export interface PreparedImage {
  role: ImageRole;
  ref: string;  // GCS key, file URI, or URL
  hash: string;
  mimeType: string;
  inputMethod: InputMethod;
  orderIndex: number;  // 0-indexed position in content parts
}

export interface DebugPayload {
  promptText: string;  // Exact text sent to Gemini
  model: string;
  params: {
    responseModalities: string[];
    aspectRatio?: string;
    mediaResolution?: string;
    [key: string]: unknown;
  };
  images: PreparedImage[];
  aspectRatioSource: AspectRatioSource;  // How aspect ratio was determined
}

export interface OutputSummary {
  finishReason: string;
  safetyRatings?: Array<{ category: string; probability: string }>;
  imageRef?: string;
  providerRequestId?: string;
}

export interface CallSummary {
  promptName: PromptName;
  model: string;
  imageCount: number;
  promptPreview: string;  // First 200 chars of promptText
}

// =============================================================================
// Execution Types
// =============================================================================

export interface WaterfallMs {
  prep: number;
  render: number;
  upload: number;
  total: number;
}

export interface RunTotals {
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
  callsTotal: number;
  callsFailed: number;
}

export type OwnerType = 'COMPOSITE_RUN' | 'PRODUCT_ASSET' | 'TEST_RUN';
export type CallStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT';
export type RunStatus = 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
export type VariantStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT';

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
// Composite Types
// =============================================================================

export interface ImageMeta {
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export interface CompositeInput {
  shopId: string;
  productAssetId: string;
  roomSessionId: string;
  traceId: string;  // Renamed from requestId
  productImage: {
    buffer: Buffer;
    hash: string;
    meta: ImageMeta;
    ref: string;  // GCS key or gemini URI
  };
  roomImage: {
    buffer: Buffer;
    hash: string;
    meta: ImageMeta;
    ref: string;  // GCS key or gemini URI
  };
  resolvedFacts: ProductFacts;
  placementSet: PlacementSet;  // Renamed from promptPack
}

/** @deprecated Use CompositeInput instead */
export type RenderInput = CompositeInput;

export interface CompositeVariantResult {
  variantId: string;
  status: VariantStatus;
  latencyMs: number;
  imageRef?: string;  // Renamed from imageKey
  imageHash?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** @deprecated Use CompositeVariantResult instead */
export type VariantRenderResult = CompositeVariantResult;

export interface CompositeRunResult {
  runId: string;
  status: RunStatus;
  totalDurationMs: number;
  variants: CompositeVariantResult[];
  waterfallMs: WaterfallMs;
  runTotals: RunTotals;
}

/** @deprecated Use CompositeRunResult instead */
export type RenderRunResult = CompositeRunResult;

// =============================================================================
// Variant Intent Config
// =============================================================================

export interface VariantIntent {
  id: string;
  intent: string;
  placementMode: 'primary' | 'secondary' | 'alternative';
  scaleStrategy:
    | 'best-guess'
    | 'smaller'
    | 'larger'
    | 'context-heavy'
    | 'conservative';
  scaleNote: string;
  anchorRule: string | null; // null for V07, V08 which have special rules
}

// =============================================================================
// Legacy Type Aliases (for migration compatibility)
// =============================================================================

/** @deprecated Use ProductFacts instead */
export type ProductPlacementFacts = ProductFacts;

/** @deprecated Use PlacementVariant instead */
export interface PromptPackVariant {
  id: string;
  variation: string;
}

/** @deprecated Use PlacementSet instead */
export interface PromptPack {
  product_context: string;
  variants: PromptPackVariant[];
}

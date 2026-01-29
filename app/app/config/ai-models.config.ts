/**
 * Locked AI model configuration.
 *
 * This file is the single source of truth for image model names used with Gemini/Imagen.
 * If you think a model name is wrong, verify against Google's official docs first.
 *
 * Last verified: December 8, 2025 (TODO: re-verify against docs)
 * Docs:
 * - https://ai.google.dev/gemini-api/docs/image-generation
 * - https://ai.google.dev/gemini-api/docs/models/gemini
 */

// =============================================================================
// IMAGE EDITING MODELS (use generateContent API)
// =============================================================================
// These models support: text-to-image, image editing, background removal,
// style transfer, multi-image composition, and inpainting.

/**
 * Fast image model for high-volume tasks.
 * - Max resolution: 1024px
 * - Use for: quick edits, background removal, simple composites
 * 
 * @constant
 * @readonly
 */
export const GEMINI_IMAGE_MODEL_FAST = "gemini-2.5-flash-image" as const;

/**
 * Professional image model for complex edits.
 * - Max resolution: Up to 4K
 * - Use for: final composites and other high-quality outputs
 * 
 * @constant
 * @readonly
 */
export const GEMINI_IMAGE_MODEL_PRO = "gemini-3-pro-image-preview" as const;

// =============================================================================
// PURE TEXT-TO-IMAGE MODELS (use generateImages API) - NOT FOR EDITING
// =============================================================================
// These models ONLY generate images from text. They CANNOT edit existing images.
// DO NOT use these for background removal, compositing, or any editing task.

/**
 * Standard Imagen model for text-to-image generation.
 * NOT suitable for image editing tasks.
 * 
 * @constant
 * @readonly
 */
export const IMAGEN_MODEL_STANDARD = "imagen-4.0-generate-001" as const;

/**
 * Ultra quality Imagen model for text-to-image generation.
 * NOT suitable for image editing tasks.
 * 
 * @constant
 * @readonly
 */
export const IMAGEN_MODEL_ULTRA = "imagen-4.0-ultra-generate-001" as const;

/**
 * Fast Imagen model for text-to-image generation.
 * NOT suitable for image editing tasks.
 * 
 * @constant
 * @readonly
 */
export const IMAGEN_MODEL_FAST = "imagen-4.0-fast-generate-001" as const;

// =============================================================================
// DEFAULT EXPORTS FOR COMMON USE CASES
// =============================================================================

/**
 * Default model for product preparation (background removal).
 * Uses PhotoRoom background removal, NOT Gemini (Gemini doesn't support transparency)
 */
export const MODEL_FOR_PRODUCT_PREP = "photoroom-background-removal" as const;

/**
 * Default model for scene compositing.
 */
export const MODEL_FOR_COMPOSITING = GEMINI_IMAGE_MODEL_FAST;

// =============================================================================
// INVALID MODEL NAMES - DO NOT USE THESE
// =============================================================================
// These are commonly mistaken model names that DO NOT EXIST:
// 
// - "gemini-2.5-flash-image-preview"  - Wrong! Remove the "-preview"
// - "gemini-3-pro-image"              - Wrong! Needs "-preview" at the end
// - "imagen-3.0-capability-001"       - Does not exist
// - "gemini-2.0-flash-preview-image-generation" - Old preview name, deprecated
// =============================================================================

/**
 * Type for valid image editing model names.
 */
export type GeminiImageModel = 
  | typeof GEMINI_IMAGE_MODEL_FAST 
  | typeof GEMINI_IMAGE_MODEL_PRO;

/**
 * Type for valid text-to-image model names.
 */
export type ImagenModel = 
  | typeof IMAGEN_MODEL_STANDARD 
  | typeof IMAGEN_MODEL_ULTRA 
  | typeof IMAGEN_MODEL_FAST;

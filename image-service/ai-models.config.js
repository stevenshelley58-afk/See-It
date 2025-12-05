/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║                                                                            ║
 * ║   🔒 LOCKED AI MODEL CONFIGURATION - DO NOT MODIFY WITHOUT APPROVAL 🔒    ║
 * ║                                                                            ║
 * ║   This file is the SINGLE SOURCE OF TRUTH for all AI model names.         ║
 * ║   These model names have been verified against Google's official docs.    ║
 * ║                                                                            ║
 * ║   Last Verified: December 5, 2024                                          ║
 * ║   Docs: https://ai.google.dev/gemini-api/docs/image-generation            ║
 * ║                                                                            ║
 * ║   ⚠️  AGENTS: DO NOT CHANGE THESE VALUES ⚠️                               ║
 * ║   If you think a model name is wrong, CHECK THE DOCS FIRST:               ║
 * ║   https://ai.google.dev/gemini-api/docs/models/gemini                     ║
 * ║                                                                            ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
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
 */
export const GEMINI_IMAGE_MODEL_FAST = "gemini-2.5-flash-image";

/**
 * Professional image model for complex edits.
 * - Max resolution: Up to 4K
 * - Use for: final composites, room cleanup, high-quality output
 */
export const GEMINI_IMAGE_MODEL_PRO = "gemini-3-pro-image-preview";

// =============================================================================
// PURE TEXT-TO-IMAGE MODELS (use generateImages API) - NOT FOR EDITING
// =============================================================================
// These models ONLY generate images from text. They CANNOT edit existing images.
// DO NOT use these for background removal, compositing, or any editing task.

/**
 * Standard Imagen model for text-to-image generation.
 * NOT suitable for image editing tasks.
 */
export const IMAGEN_MODEL_STANDARD = "imagen-4.0-generate-001";

/**
 * Ultra quality Imagen model for text-to-image generation.
 * NOT suitable for image editing tasks.
 */
export const IMAGEN_MODEL_ULTRA = "imagen-4.0-ultra-generate-001";

/**
 * Fast Imagen model for text-to-image generation.
 * NOT suitable for image editing tasks.
 */
export const IMAGEN_MODEL_FAST = "imagen-4.0-fast-generate-001";

// =============================================================================
// DEFAULT EXPORTS FOR COMMON USE CASES
// =============================================================================

/**
 * Default model for product preparation (background removal).
 * Uses @imgly/background-removal-node, NOT Gemini (Gemini doesn't support transparency)
 */
export const MODEL_FOR_PRODUCT_PREP = "imgly-background-removal";

/**
 * Default model for room cleanup (eraser/inpainting).
 */
export const MODEL_FOR_ROOM_CLEANUP = GEMINI_IMAGE_MODEL_PRO;

/**
 * Default model for scene compositing.
 */
export const MODEL_FOR_COMPOSITING = GEMINI_IMAGE_MODEL_PRO;

// =============================================================================
// INVALID MODEL NAMES - DO NOT USE THESE
// =============================================================================
// These are commonly mistaken model names that DO NOT EXIST:
// 
// ❌ "gemini-2.5-flash-image-preview"  - Wrong! Remove the "-preview"
// ❌ "gemini-3-pro-image"              - Wrong! Needs "-preview" at the end
// ❌ "imagen-3.0-capability-001"       - Does not exist
// ❌ "gemini-2.0-flash-preview-image-generation" - Old preview name, deprecated
// =============================================================================

// Default export for CommonJS compatibility
export default {
    GEMINI_IMAGE_MODEL_FAST,
    GEMINI_IMAGE_MODEL_PRO,
    IMAGEN_MODEL_STANDARD,
    IMAGEN_MODEL_ULTRA,
    IMAGEN_MODEL_FAST,
    MODEL_FOR_PRODUCT_PREP,
    MODEL_FOR_ROOM_CLEANUP,
    MODEL_FOR_COMPOSITING,
};

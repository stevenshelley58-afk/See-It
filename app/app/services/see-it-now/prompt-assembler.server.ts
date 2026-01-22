import { GLOBAL_RENDER_STATIC } from "~/config/prompts/global-render.prompt";

/**
 * Assemble the final prompt deterministically
 *
 * final_prompt = GLOBAL_RENDER_STATIC + product_context + variation
 *
 * This function does NO LLM calls. It is pure string concatenation.
 */
export function assembleFinalPrompt(
  productContext: string,
  variation: string
): string {
  return [
    GLOBAL_RENDER_STATIC,
    "",
    "Product context:",
    productContext,
    "",
    "Variation:",
    variation,
  ].join("\n\n");
}

/**
 * Compute a hash for a prompt (for deduplication and tracking)
 */
export function hashPrompt(prompt: string): string {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

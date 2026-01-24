import { GLOBAL_RENDER_STATIC } from "~/config/prompts/global-render.prompt";

const SEE_IT_NOW_INVARIANTS_BLOCK = `COMPOSITION: Place the product from prepared_product_image into customer_room_image. The room remains the base image.
LIGHTING MATCH: Match direction, softness, intensity, and color temperature of the room light. Ensure the product's contact shadow matches room cues.
PHOTOGRAPHIC MATCH: Match the room photo's camera height and perspective. Match lens look and depth of field behavior to the room.
Do not redesign the product. Preserve exact geometry, proportions, materials, texture, and color.`;

const SEE_IT_NOW_REQUIRED_SNIPPETS = [
  "COMPOSITION: Place the product from prepared_product_image into customer_room_image. The room remains the base image.",
  "LIGHTING MATCH: Match direction, softness, intensity, and color temperature of the room light. Ensure the product's contact shadow matches room cues.",
  "PHOTOGRAPHIC MATCH: Match the room photo's camera height and perspective. Match lens look and depth of field behavior to the room.",
  "Do not redesign the product. Preserve exact geometry, proportions, materials, texture, and color.",
] as const;

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
  const needsInvariants = SEE_IT_NOW_REQUIRED_SNIPPETS.some(
    (s) => !GLOBAL_RENDER_STATIC.includes(s)
  );

  return [
    GLOBAL_RENDER_STATIC,
    ...(needsInvariants ? [SEE_IT_NOW_INVARIANTS_BLOCK] : []),
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

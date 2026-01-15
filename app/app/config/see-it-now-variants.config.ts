export type SeeItNowVariantConfig = {
  id: string;
  prompt: string;
};

/**
 * Canonical 10-option See It Now variant library.
 *
 * - This is intentionally shared by:
 *   - Merchant UI (per-product selection/editing)
 *   - App proxy renderer (fallback defaults)
 *   - Settings defaults (shop-level seed)
 */
export const SEE_IT_NOW_VARIANT_LIBRARY: SeeItNowVariantConfig[] = [
  {
    id: "safe-baseline",
    prompt:
      "Place the product in the most obvious, low-risk location where it would naturally belong in this room, prioritizing realism, correct scale, and physical plausibility.",
  },
  {
    id: "conservative-scale",
    prompt:
      "Place the product in a natural location and scale it conservatively so it clearly fits the room without feeling visually dominant.",
  },
  {
    id: "confident-scale",
    prompt:
      "Place the product in a natural location and scale it confidently so it feels intentionally sized for the space while remaining physically believable.",
  },
  {
    id: "dominant-presence",
    prompt:
      "Place the product so it reads as a primary visual element in the room, drawing attention while still making physical and spatial sense.",
  },
  {
    id: "integrated-placement",
    prompt:
      "Place the product so it feels integrated with existing elements in the room, allowing natural proximity or partial occlusion if it would realistically occur.",
  },
  {
    id: "minimal-interaction",
    prompt:
      "Place the product in a clean, uncluttered area of the room with minimal interaction from surrounding objects, emphasizing clarity and realism.",
  },
  {
    id: "alternative-location",
    prompt:
      "Place the product in a plausible but less obvious location than the most typical choice, while maintaining realistic scale and placement.",
  },
  {
    id: "architectural-alignment",
    prompt:
      "Place the product aligned cleanly with architectural features in the room such as walls, corners, or vertical planes, emphasizing structural coherence.",
  },
  {
    id: "spatial-balance",
    prompt:
      "Place the product in a position that creates visual balance within the room's composition, avoiding crowding or awkward spacing.",
  },
  {
    id: "last-resort-realism",
    prompt:
      "Choose the placement and scale that would most likely result in a believable real photograph, even if it means a less dramatic composition.",
  },
];

/**
 * Default to 5 selected variants (from the 10-option library).
 *
 * Merchants can adjust per product.
 */
export const DEFAULT_SELECTED_SEE_IT_NOW_VARIANT_IDS: string[] = [
  "safe-baseline",
  "conservative-scale",
  "confident-scale",
  "integrated-placement",
  "last-resort-realism",
];

export function pickDefaultSelectedSeeItNowVariants(
  library: SeeItNowVariantConfig[] = SEE_IT_NOW_VARIANT_LIBRARY
): SeeItNowVariantConfig[] {
  const byId = new Map(library.map((v) => [v.id, v]));
  return DEFAULT_SELECTED_SEE_IT_NOW_VARIANT_IDS.map((id) => byId.get(id))
    .filter(Boolean)
    .map((v) => ({ id: v!.id, prompt: v!.prompt }));
}

export function normalizeSeeItNowVariants(
  selected: unknown,
  library: SeeItNowVariantConfig[] = SEE_IT_NOW_VARIANT_LIBRARY
): SeeItNowVariantConfig[] {
  if (!Array.isArray(selected)) return [];

  const byId = new Map(library.map((v) => [v.id, v.prompt]));
  const out: SeeItNowVariantConfig[] = [];

  for (const raw of selected) {
    const id = (raw as any)?.id;
    const prompt = (raw as any)?.prompt;
    if (typeof id !== "string" || !id.trim()) continue;

    const trimmedId = id.trim();
    const trimmedPrompt =
      typeof prompt === "string" && prompt.trim()
        ? prompt.trim()
        : (byId.get(trimmedId) ?? "");

    // Keep unknown IDs (legacy/custom) but ensure prompt is a string.
    out.push({ id: trimmedId, prompt: trimmedPrompt });
  }

  return out;
}


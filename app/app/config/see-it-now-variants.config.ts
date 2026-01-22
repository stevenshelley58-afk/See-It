/**
 * Legacy compatibility shim (DO NOT ADD NEW DEPENDENCIES ON THIS FILE)
 *
 * Historically, See It Now used a “variant library” of creative prompts configured in settings
 * and selectable per product.
 *
 * The new See It Now v2 pipeline uses a controlled V01–V08 bracket (not a creative library).
 * Many parts of the admin UI still import this module, so it MUST NOT throw at runtime.
 *
 * The goal is to migrate callers to:
 * - `app/app/config/prompts/variant-intents.config.ts` for V01–V08 definitions
 * - `app/app/services/see-it-now/*` for the v2 pipeline
 *
 * Once all callers are migrated, this file can be deleted.
 */

import { VARIANT_INTENTS } from "./prompts/variant-intents.config";

export interface SeeItNowVariantLibraryItem {
  id: string;
  prompt: string;
}

/**
 * V01–V08 controlled bracket surfaced as a “library” for legacy UI.
 * Prompt text is informational only; the v2 pipeline does not use these strings.
 */
export const SEE_IT_NOW_VARIANT_LIBRARY: SeeItNowVariantLibraryItem[] =
  VARIANT_INTENTS.map((v) => ({
    id: v.id,
    prompt: [
      v.intent,
      v.scaleNote ? `Scale: ${v.scaleNote}` : null,
      v.anchorRule ? `Anchor: ${v.anchorRule}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  }));

/**
 * Normalize a saved per-product variant array against the canonical library.
 * - Ensures known IDs exist and have prompts
 * - Preserves any legacy/custom variants that aren’t in the canonical set
 */
export function normalizeSeeItNowVariants(
  saved: unknown,
  library: SeeItNowVariantLibraryItem[] = SEE_IT_NOW_VARIANT_LIBRARY
): SeeItNowVariantLibraryItem[] {
  const libById = new Map(library.map((v) => [v.id, v]));

  const arr = Array.isArray(saved) ? saved : [];
  const normalized: SeeItNowVariantLibraryItem[] = [];

  for (const item of arr) {
    const id = (item as any)?.id?.toString?.() || "";
    if (!id) continue;

    const lib = libById.get(id);
    const prompt =
      ((item as any)?.prompt?.toString?.() ?? "").trim() || lib?.prompt || "";

    normalized.push({ id, prompt });
  }

  return normalized;
}

/**
 * Default selection (legacy behavior):
 * The v2 bracket always runs V01–V08, so default to all.
 */
export function pickDefaultSelectedSeeItNowVariants(
  library: SeeItNowVariantLibraryItem[] = SEE_IT_NOW_VARIANT_LIBRARY
): SeeItNowVariantLibraryItem[] {
  return [...library];
}

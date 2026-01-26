import type { ProductFacts } from "./types";
import { deriveScaleGuardrails } from "~/config/prompts/scale-guardrails.config";

/**
 * Merge extractedFacts with merchantOverrides to produce resolvedFacts
 *
 * merchantOverrides is a sparse object — only contains fields the merchant changed.
 * We deep-merge it over extractedFacts.
 */
export function resolveProductFacts(
  extractedFacts: ProductFacts,
  merchantOverrides: Partial<ProductFacts> | null
): ProductFacts {
  if (!merchantOverrides || Object.keys(merchantOverrides).length === 0) {
    return extractedFacts;
  }

  // Deep merge helper
  function deepMerge<T extends object>(base: T, override: Partial<T>): T {
    const result = { ...base };

    for (const key of Object.keys(override) as (keyof T)[]) {
      const overrideValue = override[key];
      const baseValue = base[key];

      if (
        overrideValue !== null &&
        typeof overrideValue === "object" &&
        !Array.isArray(overrideValue) &&
        baseValue !== null &&
        typeof baseValue === "object" &&
        !Array.isArray(baseValue)
      ) {
        result[key] = deepMerge(
          baseValue as object,
          overrideValue as object
        ) as T[keyof T];
      } else if (overrideValue !== undefined) {
        result[key] = overrideValue as T[keyof T];
      }
    }

    return result;
  }

  const resolved = deepMerge(extractedFacts, merchantOverrides);

  // Re-derive scale_guardrails after merge (in case relative_scale or dimensions changed)
  resolved.scale_guardrails = deriveScaleGuardrails(resolved);

  return resolved;
}

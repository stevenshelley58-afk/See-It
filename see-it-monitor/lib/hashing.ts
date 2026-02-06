import { createHash } from "crypto";
import type { PromptMessage } from "./types-prompt-control";

/**
 * Stable JSON canonicalization with recursive key sorting.
 * - Objects: keys sorted alphabetically, values recursively processed
 * - Arrays: order preserved, elements recursively processed
 * - Primitives: JSON.stringify() output
 *
 * NOTE: Intentionally mirrors `app/app/services/see-it-now/hashing.server.ts` to
 * avoid hash drift between deploy units.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map(
      (key) => JSON.stringify(key) + ":" + canonicalize(obj[key])
    );
    return "{" + pairs.join(",") + "}";
  }

  return JSON.stringify(value);
}

function sha25616(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function computeCanonicalHash(value: unknown): string {
  return sha25616(canonicalize(value));
}

export function computeTemplateHash(data: {
  systemTemplate: string | null;
  developerTemplate: string | null;
  userTemplate: string | null;
  model: string | null;
  params: unknown;
}): string {
  return sha25616(canonicalize(data));
}

export function computeResolutionHash(
  messages: PromptMessage[],
  model: string,
  params: Record<string, unknown>
): string {
  return sha25616(canonicalize({ messages, model, params }));
}

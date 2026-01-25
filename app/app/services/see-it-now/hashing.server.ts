// =============================================================================
// CANONICAL HASHING SERVICE
// Deterministic hashing with recursive canonicalization
// =============================================================================

import { createHash } from 'crypto';
import type { PipelineConfigSnapshot, PreparedImage } from './types';

/**
 * Stable JSON canonicalization with recursive key sorting.
 * - Objects: keys sorted alphabetically, values recursively processed
 * - Arrays: order preserved, elements recursively processed
 * - Primitives: passed through as-is
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map(key =>
      JSON.stringify(key) + ':' + canonicalize(obj[key])
    );
    return '{' + pairs.join(',') + '}';
  }

  return JSON.stringify(value);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compute pipeline config hash.
 * EXCLUDES: resolvedAt (timestamp), any trace/request IDs
 */
export function computePipelineConfigHash(snapshot: PipelineConfigSnapshot): string {
  const hashable = {
    prompts: Object.fromEntries(
      Object.entries(snapshot.prompts).map(([name, prompt]) => [
        name,
        {
          versionId: prompt.versionId,
          model: prompt.model,
          params: prompt.params
        }
      ])
    ),
    runtimeConfig: snapshot.runtimeConfig
    // NOTE: resolvedAt explicitly excluded
  };
  return sha256(canonicalize(hashable));
}

/**
 * Compute call identity hash.
 * Includes: promptText, model, params
 * EXCLUDES: images (those go in dedupeHash)
 */
export function computeCallIdentityHash(input: {
  promptText: string;
  model: string;
  params: Record<string, unknown>;
}): string {
  return sha256(canonicalize(input));
}

/**
 * Compute dedupe hash for caching.
 * Includes: callIdentityHash + ordered image descriptors
 */
export function computeDedupeHash(input: {
  callIdentityHash: string;
  images: PreparedImage[];
}): string {
  const imageDescriptors = input.images.map(img => ({
    role: img.role,
    hash: img.hash,
    mimeType: img.mimeType,
    inputMethod: img.inputMethod,
    orderIndex: img.orderIndex
  }));
  return sha256(canonicalize({
    callIdentityHash: input.callIdentityHash,
    images: imageDescriptors
  }));
}

/**
 * Compute content hash for an image buffer
 */
export function computeImageHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute hash for arbitrary JSON data (for snapshots)
 */
export function computeJsonHash(data: unknown): string {
  return sha256(canonicalize(data));
}

// =============================================================================
// Utility Exports
// =============================================================================

export { canonicalize, sha256 };

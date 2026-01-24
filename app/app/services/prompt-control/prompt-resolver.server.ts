// =============================================================================
// PROMPT RESOLVER SERVICE - v3 (All bugs fixed)
// =============================================================================

import { createHash } from "crypto";
import prisma from "~/db.server";

// =============================================================================
// Constants
// =============================================================================

// System tenant for global/shared prompts (fallback)
export const SYSTEM_TENANT_ID = "SYSTEM";

// =============================================================================
// Types
// =============================================================================

export interface PromptMessage {
  role: "system" | "developer" | "user";
  content: string;
}

export interface PromptOverride {
  systemTemplate?: string;
  developerTemplate?: string;
  userTemplate?: string;
  model?: string;
  params?: Record<string, unknown>;
}

export interface ResolvedPrompt {
  promptDefinitionId: string;
  promptVersionId: string | null;
  version: number | null;
  templateHash: string; // From PromptVersion, NOT recomputed
  model: string;
  params: Record<string, unknown>;
  messages: PromptMessage[];
  templates: {
    system: string | null;
    developer: string | null;
    user: string | null;
  };
  resolutionHash: string; // Hash of rendered messages + resolved model + params
  source: "active" | "system-fallback" | "override";
  overridesApplied: string[];
}

export interface RuntimeConfigSnapshot {
  maxConcurrency: number;
  forceFallbackModel: string | null;
  modelAllowList: string[];
  caps: {
    maxTokensOutput: number;
    maxImageBytes: number;
  };
  dailyCostCap: number;
  disabledPrompts: string[];
}

export interface ResolvedConfigSnapshot {
  resolvedAt: string;
  runtime: RuntimeConfigSnapshot;
  prompts: Record<string, ResolvedPrompt>;
  blockedPrompts: Record<string, string>; // promptName -> reason
}

interface ResolvePromptInput {
  shopId: string;
  promptName: string;
  variables: Record<string, string>;
  override?: PromptOverride;
  runtimeConfig: RuntimeConfigSnapshot; // Passed in, not re-fetched
}

interface ResolvePromptResult {
  resolved: ResolvedPrompt | null;
  blocked: boolean;
  blockReason?: string;
}

// =============================================================================
// Hashing Utilities
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/**
 * Compute resolution hash from rendered messages + resolved model + params
 * This is the "call identity" - what was actually sent to the provider
 */
function computeResolutionHash(
  messages: PromptMessage[],
  model: string,
  params: Record<string, unknown>
): string {
  return sha256(JSON.stringify({ messages, model, params }));
}

/**
 * Compute request hash for deduplication
 * Includes all context that would make two requests "the same"
 */
export function computeRequestHash(
  promptName: string,
  resolutionHash: string,
  imageRefs: string[]
): string {
  // CRITICAL: Sort imageRefs for stable hashing regardless of input order
  const sortedImageRefs = [...imageRefs].sort();
  return sha256(JSON.stringify({ promptName, resolutionHash, imageRefs: sortedImageRefs }));
}

// =============================================================================
// Template Rendering
// =============================================================================

/**
 * Render template with variable substitution
 * Supports both {{key}} and {{object.key}} syntax
 *
 * Uses regex: /\{\{([\w.]+)\}\}/g to match {{var}} and {{dot.path}}
 */
export function renderTemplate(
  template: string | null,
  variables: Record<string, string>
): string | null {
  if (!template) return null;

  // Match {{word}} or {{word.word.word}} patterns
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, path: string) => {
    // Handle dot-separated paths like "product.title"
    const value = resolveDotPath(variables, path);
    return value ?? match; // Keep original if not found
  });
}

/**
 * Safely resolve dot-separated path in object
 *
 * Resolution order (per PRD Section 5.1):
 * 1. Check flat key first: variables["product.title"]
 * 2. Fall back to nested path: variables.product.title
 *
 * Example:
 *   Variables: { "product.title": "Teak Chair" }
 *   Path: "product.title"
 *   Result: "Teak Chair" (found via flat key lookup)
 */
export function resolveDotPath(obj: Record<string, unknown>, path: string): string | undefined {
  // 1. Check flat key first (handles { "product.title": "value" })
  if (path in obj) {
    const value = obj[path];
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  // 2. Fall back to nested path traversal (handles { product: { title: "value" } })
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  if (current === null || current === undefined) return undefined;
  return String(current);
}

// =============================================================================
// Load Runtime Config (once, not per prompt)
// =============================================================================

export async function loadRuntimeConfig(shopId: string): Promise<RuntimeConfigSnapshot> {
  const config = await prisma.shopRuntimeConfig.findUnique({
    where: { shopId },
  });

  // Return config or defaults
  return {
    maxConcurrency: config?.maxConcurrency ?? 5,
    forceFallbackModel: config?.forceFallbackModel ?? null,
    modelAllowList: config?.modelAllowList ?? [],
    caps: {
      maxTokensOutput: config?.maxTokensOutputCap ?? 8192,
      maxImageBytes: config?.maxImageBytesCap ?? 20_000_000,
    },
    dailyCostCap: config ? Number(config.dailyCostCap) : 50,
    disabledPrompts: config?.disabledPromptNames ?? [],
  };
}

// =============================================================================
// Prompt Resolver
// =============================================================================

/**
 * Resolve a single prompt for a shop
 * 
 * Resolution order:
 * 1. Shop's own PromptDefinition (shopId)
 * 2. System PromptDefinition (SYSTEM_TENANT_ID) as fallback
 * 3. Error if neither exists
 */
export async function resolvePrompt(
  input: ResolvePromptInput
): Promise<ResolvePromptResult> {
  const { shopId, promptName, variables, override, runtimeConfig } = input;

  // 1. Check if prompt is disabled
  if (runtimeConfig.disabledPrompts.includes(promptName)) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `Prompt "${promptName}" is disabled in runtime config`,
    };
  }

  // 2. Load prompt definition - shop first, then system fallback
  let definition = await prisma.promptDefinition.findUnique({
    where: { shopId_name: { shopId, name: promptName } },
    include: {
      versions: {
        where: { status: "ACTIVE" },
        take: 1,
      },
    },
  });

  let isSystemFallback = false;

  // Fallback to system tenant if shop doesn't have this prompt
  if (!definition) {
    definition = await prisma.promptDefinition.findUnique({
      where: { shopId_name: { shopId: SYSTEM_TENANT_ID, name: promptName } },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          take: 1,
        },
      },
    });
    isSystemFallback = true;
  }

  if (!definition) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `Prompt "${promptName}" not found for shop or system`,
    };
  }

  const activeVersion = definition.versions[0] || null;

  if (!activeVersion && !override) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `No active version for "${promptName}" and no override provided`,
    };
  }

  // 3. Resolve templates (override > version)
  const systemTemplate = override?.systemTemplate ?? activeVersion?.systemTemplate ?? null;
  const developerTemplate = override?.developerTemplate ?? activeVersion?.developerTemplate ?? null;
  const userTemplate = override?.userTemplate ?? activeVersion?.userTemplate ?? null;

  // Must have at least one template
  if (!systemTemplate && !developerTemplate && !userTemplate) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `No templates found for "${promptName}"`,
    };
  }

  // 4. Resolve model (override > version > definition default > force fallback)
  let model = override?.model ?? activeVersion?.model ?? definition.defaultModel;

  // Apply force fallback if configured
  if (runtimeConfig.forceFallbackModel) {
    model = runtimeConfig.forceFallbackModel;
  }

  // Check model allow list
  if (runtimeConfig.modelAllowList.length > 0 && !runtimeConfig.modelAllowList.includes(model)) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `Model "${model}" not in allow list: [${runtimeConfig.modelAllowList.join(", ")}]`,
    };
  }

  // 5. Resolve params (merge: definition defaults < version < override)
  const params: Record<string, unknown> = {
    ...((definition.defaultParams as Record<string, unknown>) ?? {}),
    ...((activeVersion?.params as Record<string, unknown>) ?? {}),
    ...(override?.params ?? {}),
  };

  // Apply caps
  if (typeof params.max_tokens === "number" && runtimeConfig.caps.maxTokensOutput) {
    params.max_tokens = Math.min(params.max_tokens, runtimeConfig.caps.maxTokensOutput);
  }

  // 6. Render templates with variables
  const renderedSystem = renderTemplate(systemTemplate, variables);
  const renderedDeveloper = renderTemplate(developerTemplate, variables);
  const renderedUser = renderTemplate(userTemplate, variables);

  // 7. Build messages array
  const messages: PromptMessage[] = [];
  if (renderedSystem) messages.push({ role: "system", content: renderedSystem });
  if (renderedDeveloper) messages.push({ role: "developer", content: renderedDeveloper });
  if (renderedUser) messages.push({ role: "user", content: renderedUser });

  // 8. Get templateHash from version (DO NOT RECOMPUTE)
  // If override changes templates, we still track the base version
  const templateHash = activeVersion?.templateHash ?? sha256("no-version");

  // 9. Compute resolutionHash (this IS computed - it's the actual rendered call)
  const resolutionHash = computeResolutionHash(messages, model, params);

  // 10. Track which overrides were applied
  const overridesApplied: string[] = [];
  if (override?.systemTemplate !== undefined) overridesApplied.push("systemTemplate");
  if (override?.developerTemplate !== undefined) overridesApplied.push("developerTemplate");
  if (override?.userTemplate !== undefined) overridesApplied.push("userTemplate");
  if (override?.model !== undefined) overridesApplied.push("model");
  if (override?.params !== undefined) overridesApplied.push("params");

  // 11. Determine source
  let source: ResolvedPrompt["source"] = "active";
  if (overridesApplied.length > 0) {
    source = "override";
  } else if (isSystemFallback) {
    source = "system-fallback";
  }

  // 12. Build resolved prompt
  const resolved: ResolvedPrompt = {
    promptDefinitionId: definition.id,
    promptVersionId: activeVersion?.id ?? null, // Always store version ID even if overridden
    version: activeVersion?.version ?? null,
    templateHash,
    model,
    params,
    messages,
    templates: {
      system: systemTemplate,
      developer: developerTemplate,
      user: userTemplate,
    },
    resolutionHash,
    source,
    overridesApplied,
  };

  return { resolved, blocked: false };
}

// =============================================================================
// Build Full Config Snapshot
// =============================================================================

export async function buildResolvedConfigSnapshot(input: {
  shopId: string;
  promptNames: string[];
  variables: Record<string, string>;
  overrides?: Record<string, PromptOverride>;
}): Promise<ResolvedConfigSnapshot> {
  const { shopId, promptNames, variables, overrides } = input;

  // Load runtime config ONCE
  const runtimeConfig = await loadRuntimeConfig(shopId);

  const snapshot: ResolvedConfigSnapshot = {
    resolvedAt: new Date().toISOString(),
    runtime: runtimeConfig,
    prompts: {},
    blockedPrompts: {},
  };

  // Resolve each prompt (passing runtimeConfig, not re-fetching)
  for (const promptName of promptNames) {
    const result = await resolvePrompt({
      shopId,
      promptName,
      variables,
      override: overrides?.[promptName],
      runtimeConfig, // Pass in, don't re-fetch
    });

    if (result.resolved) {
      snapshot.prompts[promptName] = result.resolved;
    } else if (result.blocked) {
      snapshot.blockedPrompts[promptName] = result.blockReason ?? "Unknown reason";
    }
  }

  return snapshot;
}

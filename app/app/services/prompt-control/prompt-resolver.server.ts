// =============================================================================
// PROMPT RESOLVER SERVICE - v4 (Canonical Pipeline)
// The ONLY entry point for prompt resolution
// =============================================================================

import { createHash } from "crypto";
import prisma from "~/db.server";
import { canonicalize } from "../see-it-now/hashing.server";
import type {
  PromptName,
  ResolvedPrompt as CanonicalResolvedPrompt,
  PipelineConfigSnapshot,
} from "../see-it-now/types";

// =============================================================================
// Constants
// =============================================================================

// Default runtime config for pipeline
const DEFAULT_RUNTIME_CONFIG = {
  timeouts: { perVariantMs: 45000, totalMs: 180000 },
  retries: { maxPerVariant: 1 },
  variantCount: 8,
  earlyReturnAt: 4,
};

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
  source: "active" | "override";
  overridesApplied: string[];
}

export interface RuntimeConfigSnapshot {
  maxConcurrency: number;
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
  return sha256(
    canonicalize({
      messages,
      model,
      params,
    })
  );
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
  return sha256(
    canonicalize({
      promptName,
      resolutionHash,
      imageRefs: sortedImageRefs,
    })
  );
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
  variables: Record<string, unknown>
): string | null {
  if (!template) return null;

  // Match {{word}} or {{word.word.word}} patterns
  const result = template.replace(/\{\{([\w.]+)\}\}/g, (match, path: string) => {
    // Handle dot-separated paths like "product.title"
    const value = resolveDotPath(variables, path);
    return value ?? match; // Keep original if not found
  });

  // VALIDATION: Check for unreplaced variables
  const unreplaced = result.match(/\{\{[\w.]+\}\}/g);
  if (unreplaced) {
    console.warn(
      `[Template Validation] Unreplaced variables: ${unreplaced.join(", ")}`,
      { unreplacedVariables: unreplaced }
    );
  }

  return result;
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
 * 2. Error if it does not exist
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

  // 2. Load prompt definition - try shop first, fallback to SYSTEM
  let definition = await prisma.promptDefinition.findUnique({
    where: { shopId_name: { shopId, name: promptName } },
    include: {
      versions: {
        where: { status: "ACTIVE" },
        take: 1,
      },
    },
  });

  // Fallback to SYSTEM tenant if not found for shop
  if (!definition && shopId !== "SYSTEM") {
    definition = await prisma.promptDefinition.findUnique({
      where: { shopId_name: { shopId: "SYSTEM", name: promptName } },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          take: 1,
        },
      },
    });
  }

  if (!definition) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `Prompt "${promptName}" not found for shop or SYSTEM fallback`,
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

  // 4. Resolve model (override > version > definition default)
  let model = override?.model ?? activeVersion?.model ?? definition.defaultModel;

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
// Build Full Config Snapshot (OPTIMIZED - batch loading)
// =============================================================================

// Type for pre-loaded prompt definition with active version
interface LoadedDefinition {
  id: string;
  shopId: string;
  name: string;
  defaultModel: string;
  defaultParams: unknown;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    systemTemplate: string | null;
    developerTemplate: string | null;
    userTemplate: string | null;
    model: string | null;
    params: unknown;
    templateHash: string;
  }>;
}

/**
 * Resolve a prompt from pre-loaded definition data (in-memory, no DB queries)
 * This is the core resolution logic extracted for batch processing
 */
function resolvePromptFromData(
  promptName: string,
  shopDefinition: LoadedDefinition | undefined,
  variables: Record<string, string>,
  override: PromptOverride | undefined,
  runtimeConfig: RuntimeConfigSnapshot
): ResolvePromptResult {
  // 1. Check if prompt is disabled
  if (runtimeConfig.disabledPrompts.includes(promptName)) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `Prompt "${promptName}" is disabled in runtime config`,
    };
  }

  // 2. Select definition - try shop first, fallback to SYSTEM
  // NOTE: The upstream loader is responsible for SYSTEM fallback (see batchLoadDefinitions).
  // This function must remain in-memory only (no DB queries).
  const definition = shopDefinition;

  if (!definition) {
    return {
      resolved: null,
      blocked: true,
      blockReason: `Prompt "${promptName}" not found for shop or SYSTEM fallback`,
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

  // 4. Resolve model (override > version > definition default)
  let model = override?.model ?? activeVersion?.model ?? definition.defaultModel;

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
  }

  // 12. Build resolved prompt
  const resolved: ResolvedPrompt = {
    promptDefinitionId: definition.id,
    promptVersionId: activeVersion?.id ?? null,
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

/**
 * Batch load all prompt definitions for given names from both shop and system tenants
 * Returns a map keyed by `${shopId}:${name}` for easy lookup
 * Falls back to SYSTEM tenant for missing shop definitions
 */
async function batchLoadDefinitions(
  shopId: string,
  promptNames: string[]
): Promise<Map<string, LoadedDefinition>> {
  // Load ALL definitions for this shop
  const shopDefinitions = await prisma.promptDefinition.findMany({
    where: {
      shopId,
      name: { in: promptNames },
    },
    include: {
      versions: {
        where: { status: "ACTIVE" },
        take: 1,
      },
    },
  });

  // Build lookup map: `${shopId}:${name}` -> definition
  const map = new Map<string, LoadedDefinition>();
  for (const def of shopDefinitions) {
    map.set(`${def.shopId}:${def.name}`, def as LoadedDefinition);
  }

  // Find missing prompts and load from SYSTEM tenant
  if (shopId !== "SYSTEM") {
    const foundNames = new Set(shopDefinitions.map((d: { name: string }) => d.name));
    const missingNames = promptNames.filter(name => !foundNames.has(name));

    if (missingNames.length > 0) {
      const systemDefinitions = (await prisma.promptDefinition.findMany({
        where: {
          shopId: "SYSTEM",
          name: { in: missingNames },
        },
        include: {
          versions: {
            where: { status: "ACTIVE" },
            take: 1,
          },
        },
      })) ?? [];

      // Add SYSTEM definitions to map (keyed by shopId for resolution logic)
      for (const def of systemDefinitions) {
        map.set(`${shopId}:${def.name}`, def as LoadedDefinition);
      }
    }
  }

  return map;
}

export async function buildResolvedConfigSnapshot(input: {
  shopId: string;
  promptNames: string[];
  variables: Record<string, string>;
  overrides?: Record<string, PromptOverride>;
}): Promise<ResolvedConfigSnapshot> {
  const { shopId, promptNames, variables, overrides } = input;

  // ==========================================================================
  // OPTIMIZED: Only 2 DB queries total regardless of promptNames.length
  // 1. Load runtime config
  // 2. Batch load all definitions with active versions
  // ==========================================================================

  // Query 1: Load runtime config ONCE
  const runtimeConfig = await loadRuntimeConfig(shopId);

  // Query 2: Batch load ALL definitions (shop + system) in single query
  const definitionsMap = await batchLoadDefinitions(shopId, promptNames);

  const snapshot: ResolvedConfigSnapshot = {
    resolvedAt: new Date().toISOString(),
    runtime: runtimeConfig,
    prompts: {},
    blockedPrompts: {},
  };

  // Resolve each prompt IN MEMORY (no additional DB queries)
  for (const promptName of promptNames) {
    // Look up shop definition from pre-loaded map
    const shopDefinition = definitionsMap.get(`${shopId}:${promptName}`);

    const result = resolvePromptFromData(
      promptName,
      shopDefinition,
      variables,
      overrides?.[promptName],
      runtimeConfig
    );

    if (result.resolved) {
      snapshot.prompts[promptName] = result.resolved;
    } else if (result.blocked) {
      snapshot.blockedPrompts[promptName] = result.blockReason ?? "Unknown reason";
    }
  }

  return snapshot;
}

// =============================================================================
// CANONICAL: Build Pipeline Config Snapshot
// Returns the full pipeline configuration for a render run
// =============================================================================

/**
 * Build a complete pipeline config snapshot for a shop.
 * This is the ONLY way to get pipeline config for a render run.
 *
 * @param shopId - Shop ID
 * @returns PipelineConfigSnapshot with all 3 prompts and runtime config
 */
export async function buildPipelineConfigSnapshot(
  shopId: string,
  promptNames: string[]
): Promise<PipelineConfigSnapshot> {
  // Load runtime config
  const runtime = await loadRuntimeConfig(shopId);

  // Batch load prompts
  const definitionsMap = await batchLoadDefinitions(shopId, promptNames);

  // Build prompts record
  const prompts: Record<string, CanonicalResolvedPrompt> = {};

  for (const promptName of promptNames) {
    // Look up definition (may be from shop or SYSTEM fallback)
    const definition = definitionsMap.get(`${shopId}:${promptName}`);

    if (!definition) {
      throw new Error(`Missing prompt definition: ${promptName} (shop and SYSTEM fallback)`);
    }

    const activeVersion = definition.versions[0];
    if (!activeVersion) {
      throw new Error(`No active version for prompt: ${promptName}`);
    }

    // Get model and params
    const model = activeVersion.model ?? definition.defaultModel;
    const params: Record<string, unknown> = {
      ...((definition.defaultParams as Record<string, unknown>) ?? {}),
      ...((activeVersion.params as Record<string, unknown>) ?? {}),
    };

    prompts[promptName] = {
      name: promptName,
      versionId: activeVersion.id,
      templateHash: activeVersion.templateHash,
      model,
      params,
    };
  }

  return {
    prompts,
    runtimeConfig: {
      timeouts: {
        perVariantMs: DEFAULT_RUNTIME_CONFIG.timeouts.perVariantMs,
        totalMs: DEFAULT_RUNTIME_CONFIG.timeouts.totalMs,
      },
      retries: {
        maxPerVariant: DEFAULT_RUNTIME_CONFIG.retries.maxPerVariant,
      },
      variantCount: DEFAULT_RUNTIME_CONFIG.variantCount,
      earlyReturnAt: DEFAULT_RUNTIME_CONFIG.earlyReturnAt,
    },
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Resolve a single prompt and render it with variables.
 * Returns the rendered prompt text along with version info.
 *
 * @param shopId - Shop ID
 * @param promptName - Canonical prompt name
 * @param variables - Template variables to substitute
 * @returns Rendered prompt text and metadata
 */
export async function resolvePromptText(
  shopId: string,
  promptName: PromptName,
  variables: Record<string, string>
): Promise<{
  promptText: string;
  versionId: string;
  model: string;
  params: Record<string, unknown>;
}> {
  const runtimeConfig = await loadRuntimeConfig(shopId);

  const result = await resolvePrompt({
    shopId,
    promptName,
    variables,
    runtimeConfig,
  });

  if (!result.resolved) {
    throw new Error(`Failed to resolve prompt ${promptName}: ${result.blockReason}`);
  }

  // Build prompt text from messages
  const promptText = result.resolved.messages
    .map(m => m.content)
    .join('\n\n');

  return {
    promptText,
    versionId: result.resolved.promptVersionId ?? '',
    model: result.resolved.model,
    params: result.resolved.params,
  };
}

// =============================================================================
// PROMPT SERVICE - Server-side functions for prompt management
// Based on PRD Section 5 specifications
// =============================================================================

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { GoogleGenAI } from "@google/genai";
import prisma from "./db";
import type {
  PromptSummary,
  VersionSummary,
  VersionDetail,
  PromptMetrics,
  PromptDetailResponse,
  PromptListResponse,
  CreateVersionRequest,
  PromptStatus,
  PromptMessage,
  PromptOverride,
  TestPromptResponse,
} from "./types-prompt-control";

// =============================================================================
// Constants
// =============================================================================

const SYSTEM_TENANT_ID = "SYSTEM";

// =============================================================================
// Hashing Utilities
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function computeTemplateHash(data: {
  systemTemplate: string | null;
  developerTemplate: string | null;
  userTemplate: string | null;
  model: string | null;
  params: unknown;
}): string {
  return sha256(JSON.stringify(data));
}

function computeResolutionHash(
  messages: PromptMessage[],
  model: string,
  params: Record<string, unknown>
): string {
  return sha256(JSON.stringify({ messages, model, params }));
}

// =============================================================================
// Template Rendering
// =============================================================================

function resolveDotPath(obj: Record<string, unknown>, path: string): string | undefined {
  // 1. Check flat key first (handles { "product.title": "value" })
  if (path in obj) {
    const value = obj[path];
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  // 2. Fall back to nested path traversal
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

function renderTemplate(
  template: string | null,
  variables: Record<string, string>
): string | null {
  if (!template) return null;

  return template.replace(/\{\{([\w.]+)\}\}/g, (match, path: string) => {
    const value = resolveDotPath(variables, path);
    return value ?? match;
  });
}

// =============================================================================
// Metrics Calculation
// =============================================================================

async function getPromptMetrics(
  shopId: string,
  promptName: string
): Promise<PromptMetrics> {
  const since = new Date();
  since.setHours(since.getHours() - 24);

  // Fetch stats using parallel queries
  const [countResult, latencyResult, costResult] = await Promise.all([
    prisma.lLMCall.groupBy({
      by: ["status"],
      where: {
        shopId,
        // Canonical schema uses promptKey (not promptName)
        promptKey: promptName,
        startedAt: { gte: since },
      },
      _count: { id: true },
    }),
    prisma.lLMCall.findMany({
      where: {
        shopId,
        // Canonical schema uses promptKey (not promptName)
        promptKey: promptName,
        startedAt: { gte: since },
        latencyMs: { not: null },
      },
      select: { latencyMs: true },
      orderBy: { latencyMs: "asc" },
    }),
    prisma.lLMCall.aggregate({
      where: {
        shopId,
        // Canonical schema uses promptKey (not promptName)
        promptKey: promptName,
        startedAt: { gte: since },
        status: "SUCCEEDED",
        costEstimate: { not: null },
      },
      _avg: { costEstimate: true },
    }),
  ]);

  // Calculate totals
  let totalCalls = 0;
  let succeeded = 0;
  for (const group of countResult) {
    const count = group._count.id;
    totalCalls += count;
    if (group.status === "SUCCEEDED") {
      succeeded = count;
    }
  }

  // Calculate percentiles
  const latencies = latencyResult
    .map((r) => r.latencyMs)
    .filter((l): l is number => l !== null);

  const latencyP50 =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : null;
  const latencyP95 =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : null;

  return {
    calls24h: totalCalls,
    successRate24h: totalCalls > 0 ? (succeeded / totalCalls) * 100 : 0,
    latencyP50,
    latencyP95,
    avgCost: costResult._avg.costEstimate
      ? Number(costResult._avg.costEstimate)
      : null,
  };
}

// =============================================================================
// List Prompts for Shop
// =============================================================================

export async function listPromptsForShop(shopId: string): Promise<PromptListResponse> {
  // Get runtime config to check disabled prompts
  const runtimeConfig = await prisma.shopRuntimeConfig.findUnique({
    where: { shopId },
    select: { disabledPromptNames: true },
  });
  const disabledPrompts = runtimeConfig?.disabledPromptNames ?? [];

  // Get prompt definitions for shop + system fallback.
  // System definitions act as defaults for shops that haven't customized prompts yet.
  const [shopDefinitions, systemDefinitions] = await Promise.all([
    prisma.promptDefinition.findMany({
      where: { shopId },
      include: {
        versions: {
          where: { status: { in: ["ACTIVE", "DRAFT"] } },
          orderBy: { version: "desc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    shopId === SYSTEM_TENANT_ID
      ? Promise.resolve([])
      : prisma.promptDefinition.findMany({
          where: { shopId: SYSTEM_TENANT_ID },
          include: {
            versions: {
              where: { status: { in: ["ACTIVE", "DRAFT"] } },
              orderBy: { version: "desc" },
            },
          },
          orderBy: { name: "asc" },
        }),
  ]);

  // Merge by name: shop overrides system.
  const byName = new Map<string, (typeof shopDefinitions)[number]>();
  for (const def of systemDefinitions) byName.set(def.name, def);
  for (const def of shopDefinitions) byName.set(def.name, def);
  const definitions = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Build response
  const prompts: PromptSummary[] = await Promise.all(
    definitions.map(async (def) => {
      const activeVersion = def.versions.find((v) => v.status === "ACTIVE") ?? null;
      const draftVersion = def.versions.find((v) => v.status === "DRAFT") ?? null;

      const metrics = await getPromptMetrics(shopId, def.name);

      const mapVersion = (v: typeof activeVersion): VersionSummary | null => {
        if (!v) return null;
        return {
          id: v.id,
          version: v.version,
          model: v.model,
          templateHash: v.templateHash,
          createdAt: v.createdAt.toISOString(),
          activatedAt: v.activatedAt?.toISOString() ?? null,
        };
      };

      return {
        id: def.id,
        name: def.name,
        description: def.description,
        defaultModel: def.defaultModel,
        activeVersion: mapVersion(activeVersion),
        draftVersion: mapVersion(draftVersion),
        metrics,
        isDisabled: disabledPrompts.includes(def.name),
      };
    })
  );

  return { prompts };
}

// =============================================================================
// Get Prompt Detail
// =============================================================================

export async function getPromptDetail(
  shopId: string,
  promptName: string
): Promise<PromptDetailResponse | null> {
  const definition =
    (await prisma.promptDefinition.findUnique({
      where: { shopId_name: { shopId, name: promptName } },
      include: { versions: { orderBy: { version: "desc" } } },
    })) ??
    // System fallback (only if not already requesting SYSTEM)
    (shopId === SYSTEM_TENANT_ID
      ? null
      : await prisma.promptDefinition.findUnique({
          where: { shopId_name: { shopId: SYSTEM_TENANT_ID, name: promptName } },
          include: { versions: { orderBy: { version: "desc" } } },
        }));

  if (!definition) {
    return null;
  }

  const activeVersion = definition.versions.find((v) => v.status === "ACTIVE") ?? null;
  const draftVersion = definition.versions.find((v) => v.status === "DRAFT") ?? null;

  const metrics = await getPromptMetrics(shopId, promptName);

  const mapVersionSummary = (v: typeof activeVersion): VersionSummary => ({
    id: v!.id,
    version: v!.version,
    model: v!.model,
    templateHash: v!.templateHash,
    createdAt: v!.createdAt.toISOString(),
    activatedAt: v!.activatedAt?.toISOString() ?? null,
  });

  const mapVersionDetail = (v: typeof activeVersion): VersionDetail | null => {
    if (!v) return null;
    return {
      id: v.id,
      version: v.version,
      status: v.status as PromptStatus,
      systemTemplate: v.systemTemplate,
      developerTemplate: v.developerTemplate,
      userTemplate: v.userTemplate,
      model: v.model,
      params: v.params as Record<string, unknown> | null,
      templateHash: v.templateHash,
      changeNotes: v.changeNotes,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy,
      activatedAt: v.activatedAt?.toISOString() ?? null,
      activatedBy: v.activatedBy,
    };
  };

  return {
    definition: {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      defaultModel: definition.defaultModel,
      defaultParams: (definition.defaultParams as Record<string, unknown>) ?? {},
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    },
    activeVersion: mapVersionDetail(activeVersion),
    draftVersion: mapVersionDetail(draftVersion),
    versions: definition.versions.map(mapVersionSummary),
    metrics,
  };
}

// =============================================================================
// Create Version
// =============================================================================

export async function createVersion(
  shopId: string,
  promptName: string,
  data: CreateVersionRequest,
  createdBy: string
): Promise<VersionDetail> {
  const { systemTemplate, developerTemplate, userTemplate, model, params, changeNotes } =
    data;

  // Must have at least one template
  if (!systemTemplate && !developerTemplate && !userTemplate) {
    throw new Error("At least one template (system, developer, or user) is required");
  }

  // Compute template hash
  const templateHash = computeTemplateHash({
    systemTemplate: systemTemplate ?? null,
    developerTemplate: developerTemplate ?? null,
    userTemplate: userTemplate ?? null,
    model: model ?? null,
    params: params ?? null,
  });

  // Use a transaction with serializable isolation to prevent race conditions
  const version = await prisma.$transaction(
    async (tx) => {
      // 1. Find the prompt definition
      const definition = await tx.promptDefinition.findUnique({
        where: { shopId_name: { shopId, name: promptName } },
      });

      if (!definition) {
        throw new Error(`Prompt definition "${promptName}" not found for shop`);
      }

      // 2. Get the current max version number for this definition
      const maxVersionResult = await tx.promptVersion.aggregate({
        where: { promptDefinitionId: definition.id },
        _max: { version: true },
      });

      const nextVersion = (maxVersionResult._max.version ?? 0) + 1;

      // 3. Create the new version
      const newVersion = await tx.promptVersion.create({
        data: {
          promptDefinitionId: definition.id,
          version: nextVersion,
          status: "DRAFT",
          systemTemplate: systemTemplate ?? null,
          developerTemplate: developerTemplate ?? null,
          userTemplate: userTemplate ?? null,
          model: model ?? null,
          params: params ? (params as Prisma.InputJsonValue) : Prisma.DbNull,
          templateHash,
          changeNotes: changeNotes ?? null,
          createdBy,
        },
      });

      return newVersion;
    },
    {
      isolationLevel: "Serializable",
      timeout: 10000,
    }
  );

  // Audit log (outside transaction for performance)
  await prisma.promptAuditLog.create({
    data: {
      shopId,
      actor: createdBy,
      action: "PROMPT_UPDATE_DRAFT",
      targetType: "prompt_version",
      targetId: version.id,
      targetName: `${promptName} v${version.version}`,
      before: Prisma.DbNull,
      after: {
        id: version.id,
        version: version.version,
        status: version.status,
        templateHash: version.templateHash,
        model: version.model,
      },
    },
  });

  return {
    id: version.id,
    version: version.version,
    status: version.status as PromptStatus,
    systemTemplate: version.systemTemplate,
    developerTemplate: version.developerTemplate,
    userTemplate: version.userTemplate,
    model: version.model,
    params: version.params as Record<string, unknown> | null,
    templateHash: version.templateHash,
    changeNotes: version.changeNotes,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt?.toISOString() ?? null,
    activatedBy: version.activatedBy,
  };
}

// =============================================================================
// Activate Version
// =============================================================================

export async function activateVersion(
  shopId: string,
  promptName: string,
  versionId: string,
  activatedBy: string
): Promise<{ success: boolean; previousActiveId: string | null; newActiveId: string }> {
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Find the prompt definition
      const definition = await tx.promptDefinition.findUnique({
        where: { shopId_name: { shopId, name: promptName } },
      });

      if (!definition) {
        throw new Error(`Prompt definition "${promptName}" not found for shop`);
      }

      // 2. Find the version to activate
      const versionToActivate = await tx.promptVersion.findUnique({
        where: { id: versionId },
      });

      if (!versionToActivate) {
        throw new Error(`Version "${versionId}" not found`);
      }

      if (versionToActivate.promptDefinitionId !== definition.id) {
        throw new Error(`Version "${versionId}" does not belong to prompt "${promptName}"`);
      }

      if (versionToActivate.status === "ACTIVE") {
        // Already active, no-op
        return { previousActiveId: null, newActiveId: versionId, wasAlreadyActive: true };
      }

      // 3. Find current active version (if any)
      const currentActive = await tx.promptVersion.findFirst({
        where: {
          promptDefinitionId: definition.id,
          status: "ACTIVE",
        },
      });

      // 4. Archive the current active version (if exists)
      if (currentActive) {
        await tx.promptVersion.update({
          where: { id: currentActive.id },
          data: { status: "ARCHIVED" },
        });
      }

      // 5. Activate the new version
      await tx.promptVersion.update({
        where: { id: versionId },
        data: {
          status: "ACTIVE",
          activatedAt: new Date(),
          activatedBy,
        },
      });

      return {
        previousActiveId: currentActive?.id ?? null,
        newActiveId: versionId,
        wasAlreadyActive: false,
      };
    },
    {
      isolationLevel: "Serializable",
      timeout: 10000,
    }
  );

  // Audit log (outside transaction)
  if (!result.wasAlreadyActive) {
    await prisma.promptAuditLog.create({
      data: {
        shopId,
        actor: activatedBy,
        action: "PROMPT_ACTIVATE",
        targetType: "prompt_version",
        targetId: result.newActiveId,
        targetName: promptName,
        before: result.previousActiveId
          ? { activeVersionId: result.previousActiveId }
          : Prisma.DbNull,
        after: {
          activeVersionId: result.newActiveId,
        },
      },
    });
  }

  return {
    success: true,
    previousActiveId: result.previousActiveId,
    newActiveId: result.newActiveId,
  };
}

// =============================================================================
// Rollback to Previous Version
// =============================================================================

export async function rollbackToPreviousVersion(
  shopId: string,
  promptName: string,
  rolledBackBy: string
): Promise<{ previousActiveVersion: number; newActiveVersion: number }> {
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Find the prompt definition
      const definition = await tx.promptDefinition.findUnique({
        where: { shopId_name: { shopId, name: promptName } },
      });

      if (!definition) {
        throw new Error(`Prompt definition "${promptName}" not found for shop`);
      }

      // 2. Find current active version
      const currentActive = await tx.promptVersion.findFirst({
        where: {
          promptDefinitionId: definition.id,
          status: "ACTIVE",
        },
      });

      if (!currentActive) {
        throw new Error(`No active version found for "${promptName}"`);
      }

      // 3. Find most recent archived version
      const previousVersion = await tx.promptVersion.findFirst({
        where: {
          promptDefinitionId: definition.id,
          status: "ARCHIVED",
        },
        orderBy: { activatedAt: "desc" },
      });

      if (!previousVersion) {
        throw new Error(`No previous version found to rollback to for "${promptName}"`);
      }

      // 4. Archive current active
      await tx.promptVersion.update({
        where: { id: currentActive.id },
        data: { status: "ARCHIVED" },
      });

      // 5. Re-activate previous version
      await tx.promptVersion.update({
        where: { id: previousVersion.id },
        data: {
          status: "ACTIVE",
          activatedAt: new Date(),
          activatedBy: rolledBackBy,
        },
      });

      return {
        previousActiveId: currentActive.id,
        previousActiveVersion: currentActive.version,
        newActiveId: previousVersion.id,
        newActiveVersion: previousVersion.version,
      };
    },
    {
      isolationLevel: "Serializable",
      timeout: 10000,
    }
  );

  // Audit log
  await prisma.promptAuditLog.create({
    data: {
      shopId,
      actor: rolledBackBy,
      action: "PROMPT_ROLLBACK",
      targetType: "prompt_version",
      targetId: result.newActiveId,
      targetName: `${promptName} v${result.newActiveVersion}`,
      before: {
        activeVersionId: result.previousActiveId,
        version: result.previousActiveVersion,
      },
      after: {
        activeVersionId: result.newActiveId,
        version: result.newActiveVersion,
      },
    },
  });

  return {
    previousActiveVersion: result.previousActiveVersion,
    newActiveVersion: result.newActiveVersion,
  };
}

// =============================================================================
// Test Prompt
// =============================================================================

export async function testPrompt(
  shopId: string,
  promptName: string,
  options: {
    variables?: Record<string, string>;
    imageRefs?: string[];
    overrides?: PromptOverride;
    versionId?: string;
  },
  testedBy: string
): Promise<TestPromptResponse> {
  // 1. Load runtime config
  const runtimeConfig = await prisma.shopRuntimeConfig.findUnique({
    where: { shopId },
  });

  const disabledPrompts = runtimeConfig?.disabledPromptNames ?? [];
  if (disabledPrompts.includes(promptName)) {
    throw new Error(`Prompt "${promptName}" is disabled`);
  }

  // 2. Load prompt definition and version
  const definition = await prisma.promptDefinition.findUnique({
    where: { shopId_name: { shopId, name: promptName } },
    include: {
      versions: {
        where: options.versionId
          ? { id: options.versionId }
          : { status: "ACTIVE" },
        take: 1,
      },
    },
  });

  // Fallback to system tenant if not found
  let isSystemFallback = false;
  let resolvedDefinition = definition;
  if (!definition) {
    resolvedDefinition = await prisma.promptDefinition.findUnique({
      where: { shopId_name: { shopId: SYSTEM_TENANT_ID, name: promptName } },
      include: {
        versions: {
          where: options.versionId
            ? { id: options.versionId }
            : { status: "ACTIVE" },
          take: 1,
        },
      },
    });
    isSystemFallback = true;
  }

  if (!resolvedDefinition) {
    throw new Error(`Prompt "${promptName}" not found`);
  }

  const activeVersion = resolvedDefinition.versions[0] || null;

  // 3. Resolve templates (override > version)
  const { overrides = {} } = options;
  const systemTemplate =
    overrides.systemTemplate ?? activeVersion?.systemTemplate ?? null;
  const developerTemplate =
    overrides.developerTemplate ?? activeVersion?.developerTemplate ?? null;
  const userTemplate =
    overrides.userTemplate ?? activeVersion?.userTemplate ?? null;

  if (!systemTemplate && !developerTemplate && !userTemplate) {
    throw new Error(`No templates found for "${promptName}"`);
  }

  // 4. Resolve model
  let model =
    overrides.model ?? activeVersion?.model ?? resolvedDefinition.defaultModel;

  if (runtimeConfig?.forceFallbackModel) {
    model = runtimeConfig.forceFallbackModel;
  }

  // 5. Resolve params
  const params: Record<string, unknown> = {
    ...((resolvedDefinition.defaultParams as Record<string, unknown>) ?? {}),
    ...((activeVersion?.params as Record<string, unknown>) ?? {}),
    ...(overrides.params ?? {}),
  };

  // Apply caps
  if (runtimeConfig?.maxTokensOutputCap && typeof params.max_tokens === "number") {
    params.max_tokens = Math.min(params.max_tokens, runtimeConfig.maxTokensOutputCap);
  }

  // 6. Render templates
  const variables = options.variables ?? {};
  const renderedSystem = renderTemplate(systemTemplate, variables);
  const renderedDeveloper = renderTemplate(developerTemplate, variables);
  const renderedUser = renderTemplate(userTemplate, variables);

  // 7. Build messages array
  const messages: PromptMessage[] = [];
  if (renderedSystem) messages.push({ role: "system", content: renderedSystem });
  if (renderedDeveloper) messages.push({ role: "developer", content: renderedDeveloper });
  if (renderedUser) messages.push({ role: "user", content: renderedUser });

  // 8. Compute resolution hash
  const resolutionHash = computeResolutionHash(messages, model, params);

  // 9. Create test run record
  const testRun = await prisma.promptTestRun.create({
    data: {
      shopId,
      promptName,
      promptVersionId: activeVersion?.id ?? null,
      variables: variables,
      imageRefs: options.imageRefs ?? [],
      overrides: overrides as object,
      status: "running",
      createdBy: testedBy,
    },
  });

  // 10. Create LLM call record
  const requestHash = sha256(
    JSON.stringify({
      promptName,
      resolutionHash,
      imageRefs: [...(options.imageRefs ?? [])].sort(),
    })
  );

  const llmCall = await prisma.lLMCall.create({
    data: {
      shopId,
      ownerType: "TEST_RUN",
      ownerId: testRun.id,
      promptKey: promptName,
      promptVersionId: activeVersion?.id ?? null,
      status: "STARTED",
      startedAt: new Date(),

      // Canonical identity hashes
      callIdentityHash: resolutionHash,
      dedupeHash: requestHash,

      // Canonical payloads (required)
      callSummary: {
        promptName,
        model,
        imageCount: options.imageRefs?.length ?? 0,
        promptPreview: messages.map((m) => m.content).join("\n").slice(0, 500),
      } as unknown as Prisma.InputJsonValue,
      debugPayload: {
        messages,
        model,
        params,
        variables,
        imageRefs: options.imageRefs ?? [],
        resolutionHash,
        requestHash,
        overrides,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // 11. Execute the test call with real Gemini API
  const startTime = Date.now();

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Build content parts: messages + images
  const parts: any[] = [];

  // Add text messages
  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      // System/developer messages go as system role
      parts.push({ text: msg.content });
    } else if (msg.role === "user") {
      parts.push({ text: msg.content });
    }
  }

  // Add image parts if provided
  const imageRefs = options.imageRefs ?? [];
  for (const imageRef of imageRefs) {
    if (imageRef.startsWith("https://generativelanguage.googleapis.com/")) {
      // Gemini file URI - use fileData
      parts.push({
        fileData: {
          fileUri: imageRef,
        },
      });
    } else if (imageRef.startsWith("https://") || imageRef.startsWith("http://")) {
      // HTTP(S) URL - download and inline
      try {
        const response = await fetch(imageRef);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const base64 = buffer.toString("base64");
          const mimeType = response.headers.get("content-type") || "image/jpeg";
          parts.push({
            inlineData: {
              mimeType,
              data: base64,
            },
          });
        }
      } catch (err) {
        // Log but continue - don't fail the test if image fetch fails
        console.warn(`Failed to fetch image ${imageRef}:`, err);
      }
    }
  }

  // Determine response modalities based on params
  const responseModalitiesParam = params.responseModalities as string[] | undefined;
  const hasImageOutput = Array.isArray(responseModalitiesParam) && 
                         (responseModalitiesParam.includes("IMAGE") || responseModalitiesParam.includes("image"));
  const responseModalities = hasImageOutput ? ["TEXT", "IMAGE"] : ["TEXT"];

  let result: any;
  let latencyMs: number;
  let tokensIn = 0;
  let tokensOut = 0;
  let costEstimate = 0;
  let providerRequestId: string | null = null;
  let outputText: string | null = null;
  let outputImageBase64: string | null = null;
  let finishReason: string | null = null;

  try {
    // Make the actual API call
    result = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        ...params,
        responseModalities: responseModalities as any,
      },
    });

    latencyMs = Date.now() - startTime;

    // Extract provider request ID
    providerRequestId =
      result?.response?.requestId ??
      result?.requestId ??
      result?.responseId ??
      result?.response?.id ??
      result?.id ??
      null;

    // Extract usage metadata
    const usageMetadata = result?.usageMetadata;
    tokensIn = usageMetadata?.promptTokenCount ?? 0;
    tokensOut = usageMetadata?.candidatesTokenCount ?? 0;

    // Estimate cost (rough estimate based on Gemini pricing)
    const inCost = (tokensIn / 1_000_000) * 0.10;
    const outCost = (tokensOut / 1_000_000) * 0.40;
    costEstimate = inCost + outCost;

    // Extract output
    const candidates = result?.candidates;
    finishReason = candidates?.[0]?.finishReason ?? null;

    // Extract text output
    if (result?.text) {
      outputText = result.text;
    } else if (candidates?.[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.text) {
          outputText = (outputText || "") + part.text;
        }
        if (part.inlineData?.data) {
          outputImageBase64 = part.inlineData.data;
        }
      }
    }

    // Build bounded output structure (truncate if too large)
    const output: any = {
      text: outputText ? outputText.slice(0, 10000) : null, // Truncate to 10k chars
      textLength: outputText?.length ?? 0,
      hasImage: !!outputImageBase64,
      imagePreview: outputImageBase64
        ? outputImageBase64.slice(0, 100) + "... (truncated)"
        : null,
      finishReason,
      model,
    };

    // 12. Update LLM call and test run with success
    await prisma.lLMCall.update({
      where: { id: llmCall.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        latencyMs,
        tokensIn,
        tokensOut,
        costEstimate,
        providerModel: model,
        providerRequestId,
        outputSummary: {
          finishReason: String(finishReason ?? "STOP"),
          hasImage: !!outputImageBase64,
          textLength: outputText?.length ?? 0,
          providerRequestId,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.promptTestRun.update({
      where: { id: testRun.id },
      data: {
        status: "succeeded",
        output: output as unknown as Prisma.InputJsonValue,
        latencyMs,
        tokensIn,
        tokensOut,
        costEstimate,
      },
    });
  } catch (error: any) {
    latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.name : "UnknownError";

    // Update LLM call with failure
    await prisma.lLMCall.update({
      where: { id: llmCall.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        latencyMs,
        errorType,
        errorMessage,
      },
    });

    await prisma.promptTestRun.update({
      where: { id: testRun.id },
      data: {
        status: "failed",
        output: {
          error: errorMessage,
          errorType,
        } as unknown as Prisma.InputJsonValue,
        latencyMs,
      },
    });

    throw error;
  }

  // 13. Audit log
  await prisma.promptAuditLog.create({
    data: {
      shopId,
      actor: testedBy,
      action: "TEST_RUN",
      targetType: "prompt_test_run",
      targetId: testRun.id,
      targetName: promptName,
      before: Prisma.DbNull,
      after: {
        testRunId: testRun.id,
        promptName,
        versionId: activeVersion?.id,
        model,
      },
    },
  });

  return {
    testRunId: testRun.id,
    status: "succeeded",
    output: {
      text: outputText,
      hasImage: !!outputImageBase64,
      finishReason,
      model,
    },
    latencyMs,
    tokensIn,
    tokensOut,
    costEstimate,
    providerRequestId,
    providerModel: model,
    messages,
    resolutionHash,
  };
}

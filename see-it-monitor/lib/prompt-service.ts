// =============================================================================
// PROMPT SERVICE - Server-side functions for prompt management
// Based on PRD Section 5 specifications
// =============================================================================

import { createHash } from "crypto";
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
        promptName,
        startedAt: { gte: since },
      },
      _count: { id: true },
    }),
    prisma.lLMCall.findMany({
      where: {
        shopId,
        promptName,
        startedAt: { gte: since },
        latencyMs: { not: null },
      },
      select: { latencyMs: true },
      orderBy: { latencyMs: "asc" },
    }),
    prisma.lLMCall.aggregate({
      where: {
        shopId,
        promptName,
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

  // Get all prompt definitions for shop with active/draft versions
  const definitions = await prisma.promptDefinition.findMany({
    where: { shopId },
    include: {
      versions: {
        where: {
          status: { in: ["ACTIVE", "DRAFT"] },
        },
        orderBy: { version: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

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
  const definition = await prisma.promptDefinition.findUnique({
    where: { shopId_name: { shopId, name: promptName } },
    include: {
      versions: {
        orderBy: { version: "desc" },
      },
    },
  });

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
          params: params ?? null,
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
      before: null,
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
          : null,
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
      testRunId: testRun.id,
      promptName,
      promptVersionId: activeVersion?.id ?? null,
      model,
      resolutionHash,
      requestHash,
      status: "STARTED",
      startedAt: new Date(),
      inputRef: {
        messageCount: messages.length,
        imageCount: options.imageRefs?.length ?? 0,
        preview: messages.map((m) => m.content).join("\n").slice(0, 500),
        resolutionHash,
      },
    },
  });

  // 11. Execute the test call (simulated for now - in real implementation, would call Gemini)
  // For now, we return a mock response. In production, this would integrate with the actual LLM.
  const startTime = Date.now();

  // Simulate API call delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  const latencyMs = Date.now() - startTime;
  const mockOutput = {
    message: "Test execution simulated. Integrate with actual LLM provider for real results.",
    model,
    renderedMessages: messages,
  };

  // 12. Update LLM call and test run
  await prisma.lLMCall.update({
    where: { id: llmCall.id },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      latencyMs,
      tokensIn: 0,
      tokensOut: 0,
      costEstimate: 0,
      outputRef: {
        preview: JSON.stringify(mockOutput).slice(0, 500),
        length: JSON.stringify(mockOutput).length,
      },
    },
  });

  await prisma.promptTestRun.update({
    where: { id: testRun.id },
    data: {
      status: "succeeded",
      output: mockOutput,
      latencyMs,
      tokensIn: 0,
      tokensOut: 0,
      costEstimate: 0,
    },
  });

  // 13. Audit log
  await prisma.promptAuditLog.create({
    data: {
      shopId,
      actor: testedBy,
      action: "TEST_RUN",
      targetType: "prompt_test_run",
      targetId: testRun.id,
      targetName: promptName,
      before: null,
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
    output: mockOutput,
    latencyMs,
    tokensIn: 0,
    tokensOut: 0,
    costEstimate: 0,
    providerRequestId: null,
    providerModel: model,
    messages,
    resolutionHash,
  };
}

// =============================================================================
// PROMPT VERSION MANAGEMENT SERVICE
// Race-safe version creation and activation with transactions
// =============================================================================

import { createHash } from "crypto";
import prisma from "~/db.server";
import { canonicalize } from "../see-it-now/hashing.server";
import type { Prisma, PromptStatus, AuditAction } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

export interface CreatePromptDefinitionInput {
  shopId: string;
  name: string;
  description?: string;
  defaultModel?: string;
  defaultParams?: Record<string, unknown>;
  createdBy: string;
}

export interface CreateVersionInput {
  shopId: string;
  promptName: string;
  systemTemplate?: string;
  developerTemplate?: string;
  userTemplate?: string;
  model?: string;
  params?: Record<string, unknown>;
  changeNotes?: string;
  createdBy: string;
}

export interface ActivateVersionInput {
  shopId: string;
  promptName: string;
  versionId: string;
  activatedBy: string;
}

// =============================================================================
// Hashing
// =============================================================================

function computeTemplateHash(data: {
  systemTemplate: string | null;
  developerTemplate: string | null;
  userTemplate: string | null;
  model: string | null;
  params: unknown;
}): string {
  return createHash("sha256")
    .update(canonicalize(data))
    .digest("hex")
    .slice(0, 16);
}

// =============================================================================
// Create Prompt Definition
// =============================================================================

export async function createPromptDefinition(
  input: CreatePromptDefinitionInput
) {
  const { shopId, name, description, defaultModel, defaultParams, createdBy } = input;

  const definition = await prisma.promptDefinition.create({
    data: {
      shopId,
      name,
      description,
      defaultModel: defaultModel ?? "gemini-2.5-flash",
      defaultParams: defaultParams ?? null,
    },
  });

  // Audit log
  await prisma.promptAuditLog.create({
    data: {
      shopId,
      actor: createdBy,
      action: "PROMPT_CREATE",
      targetType: "prompt_definition",
      targetId: definition.id,
      targetName: name,
      before: null,
      after: {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        defaultModel: definition.defaultModel,
      },
    },
  });

  return definition;
}

// =============================================================================
// Create Version (with race-safe version number assignment)
// =============================================================================

export async function createVersion(input: CreateVersionInput) {
  const {
    shopId,
    promptName,
    systemTemplate,
    developerTemplate,
    userTemplate,
    model,
    params,
    changeNotes,
    createdBy,
  } = input;

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
  const version = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
        // Prisma JSON inputs require InputJsonValue (not Record<string, unknown>)
        params: (params ?? undefined) as unknown as Prisma.InputJsonValue,
        templateHash,
        changeNotes,
        createdBy,
      },
    });

    return newVersion;
  }, {
    // Serializable isolation prevents concurrent version number collisions
    isolationLevel: "Serializable",
    timeout: 10000,
  });

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

  return version;
}

// =============================================================================
// Activate Version (with transactional uniqueness enforcement)
// =============================================================================

export async function activateVersion(input: ActivateVersionInput) {
  const { shopId, promptName, versionId, activatedBy } = input;

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
      return { version: versionToActivate, previousActiveId: null, wasAlreadyActive: true };
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

    // 5. Activate the new version, storing the previous active version for rollback
    const activatedVersion = await tx.promptVersion.update({
      where: { id: versionId },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        activatedBy,
        previousActiveVersionId: currentActive?.id ?? null,
      },
    });

    return {
      version: activatedVersion,
      previousActiveId: currentActive?.id ?? null,
      wasAlreadyActive: false,
    };
  }, {
    isolationLevel: "Serializable",
    timeout: 10000,
  });

  // Audit log (outside transaction)
  if (!result.wasAlreadyActive) {
    await prisma.promptAuditLog.create({
      data: {
        shopId,
        actor: activatedBy,
        action: "PROMPT_ACTIVATE",
        targetType: "prompt_version",
        targetId: result.version.id,
        targetName: `${promptName} v${result.version.version}`,
        before: result.previousActiveId
          ? { activeVersionId: result.previousActiveId }
          : null,
        after: {
          activeVersionId: result.version.id,
          version: result.version.version,
          activatedAt: result.version.activatedAt,
        },
      },
    });
  }

  return result;
}

// =============================================================================
// Rollback to Previous Version
// =============================================================================

export async function rollbackToPreviousVersion(input: {
  shopId: string;
  promptName: string;
  rolledBackBy: string;
}) {
  const { shopId, promptName, rolledBackBy } = input;

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    // 3. Find the previous version using the stored rollback chain
    if (!currentActive.previousActiveVersionId) {
      throw new Error(`No previous version found to rollback to for "${promptName}". This may be the first version ever activated.`);
    }

    const previousVersion = await tx.promptVersion.findUnique({
      where: { id: currentActive.previousActiveVersionId },
    });

    if (!previousVersion) {
      throw new Error(`Previous version "${currentActive.previousActiveVersionId}" no longer exists`);
    }

    if (previousVersion.status !== "ARCHIVED") {
      // Should not happen in normal flow, but handle gracefully
      throw new Error(`Previous version is in unexpected state: ${previousVersion.status}`);
    }

    // 4. Archive current active
    await tx.promptVersion.update({
      where: { id: currentActive.id },
      data: { status: "ARCHIVED" },
    });

    // 5. Re-activate previous version, updating the chain to point to what we just deactivated
    const reactivatedVersion = await tx.promptVersion.update({
      where: { id: previousVersion.id },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        activatedBy: rolledBackBy,
        previousActiveVersionId: currentActive.id, // Enable rolling forward again if needed
      },
    });

    return {
      previousActiveId: currentActive.id,
      previousActiveVersion: currentActive.version,
      newActiveId: reactivatedVersion.id,
      newActiveVersion: reactivatedVersion.version,
    };
  }, {
    isolationLevel: "Serializable",
    timeout: 10000,
  });

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

  return result;
}

// =============================================================================
// Archive Version
// =============================================================================

export async function archiveVersion(input: {
  shopId: string;
  versionId: string;
  archivedBy: string;
}) {
  const { shopId, versionId, archivedBy } = input;

  const version = await prisma.promptVersion.findUnique({
    where: { id: versionId },
    include: { promptDefinition: true },
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found`);
  }

  if (version.promptDefinition.shopId !== shopId) {
    throw new Error(`Version does not belong to this shop`);
  }

  if (version.status === "ACTIVE") {
    throw new Error(`Cannot archive active version. Activate another version first.`);
  }

  if (version.status === "ARCHIVED") {
    // Already archived, no-op
    return version;
  }

  const archivedVersion = await prisma.promptVersion.update({
    where: { id: versionId },
    data: { status: "ARCHIVED" },
  });

  // Audit log
  await prisma.promptAuditLog.create({
    data: {
      shopId,
      actor: archivedBy,
      action: "PROMPT_ARCHIVE",
      targetType: "prompt_version",
      targetId: versionId,
      targetName: `${version.promptDefinition.name} v${version.version}`,
      before: { status: version.status },
      after: { status: "ARCHIVED" },
    },
  });

  return archivedVersion;
}

// =============================================================================
// Get Prompt with Versions
// =============================================================================

export async function getPromptWithVersions(shopId: string, promptName: string) {
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

  const activeVersion = definition.versions.find((v: any) => v.status === "ACTIVE") ?? null;
  const draftVersion = definition.versions.find((v: any) => v.status === "DRAFT") ?? null;

  return {
    definition,
    versions: definition.versions,
    activeVersion,
    draftVersion,
  };
}

// =============================================================================
// List All Prompts for Shop
// =============================================================================

export async function listPromptsForShop(shopId: string) {
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

  return definitions.map((def: any) => ({
    ...def,
    activeVersion: def.versions.find((v: any) => v.status === "ACTIVE") ?? null,
    draftVersion: def.versions.find((v: any) => v.status === "DRAFT") ?? null,
  }));
}

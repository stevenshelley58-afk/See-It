// =============================================================================
// LEGACY VERSIONING SERVICE
// This file is DEPRECATED - use Prompt Control Plane (prompt-resolver.server.ts)
// These exports are kept for backward compatibility during migration.
// =============================================================================

import prisma from "~/db.server";
import { logger, createLogContext } from "~/utils/logger.server";

const SYSTEM_TENANT_ID = "SYSTEM";

/**
 * @deprecated Use Prompt Control Plane instead
 * Get current prompt version number from canonical PromptVersion table
 */
export async function getCurrentPromptVersion(): Promise<number> {
  // Return highest version number from any canonical prompt
  const latest = await prisma.promptVersion.findFirst({
    where: {
      status: "ACTIVE",
      promptDefinition: {
        shopId: SYSTEM_TENANT_ID,
      },
    },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return latest?.version || 1;
}

/**
 * @deprecated Use Prompt Control Plane instead
 * Returns current version - no longer creates versions (done via seed/admin)
 */
export async function ensurePromptVersion(): Promise<number> {
  const version = await getCurrentPromptVersion();

  logger.debug(
    createLogContext("system", "system", "version-check", { version }),
    `Current prompt version: ${version} (via Prompt Control Plane)`
  );

  return version;
}

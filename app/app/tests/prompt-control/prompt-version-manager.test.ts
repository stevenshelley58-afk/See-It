/**
 * Acceptance Tests for Prompt Control Plane - Version Manager
 *
 * Tests:
 * - #1: Create draft, edit, activate -> next run uses new prompt
 * - #2: Shop isolation (Shop A changes don't affect Shop B)
 * - #4: Rollback functionality
 * - #10: All changes recorded in audit log
 * - #12: Concurrent version creation -> no duplicate version numbers
 * - #13: Concurrent activation -> only one ACTIVE version
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "crypto";

// =============================================================================
// Mock Prisma
// =============================================================================

interface MockTransaction {
  promptDefinition: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  promptVersion: {
    aggregate: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  promptAuditLog: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
}

const mockTx: MockTransaction = {
  promptDefinition: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  promptVersion: {
    aggregate: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  promptAuditLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
};

const mockPrisma = vi.hoisted(() => ({
  promptDefinition: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  promptVersion: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
  },
  promptAuditLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

// Mock the db.server module
vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

// Import after mocking
import {
  createPromptDefinition,
  createVersion,
  activateVersion,
  rollbackToPreviousVersion,
  archiveVersion,
  getPromptWithVersions,
  listPromptsForShop,
} from "~/services/prompt-control/prompt-version-manager.server";

// =============================================================================
// Test Helpers
// =============================================================================

function computeTemplateHash(data: {
  systemTemplate: string | null;
  developerTemplate: string | null;
  userTemplate: string | null;
  model: string | null;
  params: unknown;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

function createMockDefinition(shopId: string, name: string, id: string = "def-1") {
  return {
    id,
    shopId,
    name,
    description: null,
    defaultModel: "gemini-2.5-flash",
    defaultParams: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockVersion(
  definitionId: string,
  version: number,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED",
  id: string = `ver-${version}`
) {
  return {
    id,
    promptDefinitionId: definitionId,
    version,
    status,
    systemTemplate: `System template v${version}`,
    developerTemplate: null,
    userTemplate: `User template v${version}`,
    model: "gemini-2.5-flash",
    params: null,
    templateHash: `hash-${version}`,
    changeNotes: null,
    createdAt: new Date(),
    createdBy: "test@example.com",
    activatedAt: status === "ACTIVE" ? new Date() : null,
    activatedBy: status === "ACTIVE" ? "test@example.com" : null,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Prompt Version Manager", () => {
  beforeEach(() => {
    // Reset implementations between tests to avoid cross-test leakage.
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Test #1: Create draft, edit, activate -> next run uses new prompt
  // ===========================================================================

  describe("AC #1: Create draft, edit, activate workflow", () => {
    it("should create a new DRAFT version with auto-incremented version number", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);

      // Setup transaction mock
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.aggregate.mockResolvedValue({ _max: { version: 2 } });
        mockTx.promptVersion.create.mockResolvedValue(
          createMockVersion(definition.id, 3, "DRAFT", "ver-3")
        );
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      const result = await createVersion({
        shopId,
        promptName,
        systemTemplate: "New system template",
        userTemplate: "New user template",
        createdBy: "test@example.com",
      });

      expect(result.version).toBe(3);
      expect(result.status).toBe("DRAFT");
      expect(mockTx.promptVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 3,
            status: "DRAFT",
          }),
        })
      );
    });

    it("should activate a draft version and archive the current active", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const currentActive = createMockVersion(definition.id, 1, "ACTIVE", "ver-1");
      const draftToActivate = createMockVersion(definition.id, 2, "DRAFT", "ver-2");

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findUnique.mockResolvedValue(draftToActivate);
        mockTx.promptVersion.findFirst.mockResolvedValue(currentActive);
        mockTx.promptVersion.update
          .mockResolvedValueOnce({ ...currentActive, status: "ARCHIVED" })
          .mockResolvedValueOnce({
            ...draftToActivate,
            status: "ACTIVE",
            activatedAt: new Date(),
          });
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      const result = await activateVersion({
        shopId,
        promptName,
        versionId: "ver-2",
        activatedBy: "test@example.com",
      });

      expect(result.version.status).toBe("ACTIVE");
      expect(result.previousActiveId).toBe("ver-1");
      expect(mockTx.promptVersion.update).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Test #2: Shop isolation (Shop A changes don't affect Shop B)
  // ===========================================================================

  describe("AC #2: Shop isolation", () => {
    it("should not find prompt from another shop", async () => {
      const shopAId = "shop-A";
      const shopBId = "shop-B";
      const promptName = "extractor";

      // Shop A has the definition, Shop B does not
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(null);
        return callback(mockTx);
      });

      await expect(
        createVersion({
          shopId: shopBId,
          promptName,
          systemTemplate: "Template",
          createdBy: "test@example.com",
        })
      ).rejects.toThrow(`Prompt definition "${promptName}" not found for shop`);
    });

    it("should maintain separate version sequences per shop", async () => {
      const shopAId = "shop-A";
      const shopBId = "shop-B";
      const promptName = "extractor";

      // Shop A has versions 1-5
      const shopADefinition = createMockDefinition(shopAId, promptName, "def-A");

      // Shop B has versions 1-3
      const shopBDefinition = createMockDefinition(shopBId, promptName, "def-B");

      // Shop A creates version 6
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(shopADefinition);
        mockTx.promptVersion.aggregate.mockResolvedValue({ _max: { version: 5 } });
        mockTx.promptVersion.create.mockResolvedValue(
          createMockVersion(shopADefinition.id, 6, "DRAFT")
        );
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      const shopAResult = await createVersion({
        shopId: shopAId,
        promptName,
        systemTemplate: "Shop A template",
        createdBy: "test@example.com",
      });

      expect(shopAResult.version).toBe(6);

      // Shop B creates version 4 (independent)
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(shopBDefinition);
        mockTx.promptVersion.aggregate.mockResolvedValue({ _max: { version: 3 } });
        mockTx.promptVersion.create.mockResolvedValue(
          createMockVersion(shopBDefinition.id, 4, "DRAFT")
        );
        return callback(mockTx);
      });

      const shopBResult = await createVersion({
        shopId: shopBId,
        promptName,
        systemTemplate: "Shop B template",
        createdBy: "test@example.com",
      });

      expect(shopBResult.version).toBe(4);
    });
  });

  // ===========================================================================
  // Test #4: Rollback functionality
  // ===========================================================================

  describe("AC #4: Rollback to previous version", () => {
    it("should rollback to the most recent archived version", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const previousVersion = createMockVersion(definition.id, 2, "ARCHIVED", "ver-2");
      const currentActive = {
        ...createMockVersion(definition.id, 3, "ACTIVE", "ver-3"),
        previousActiveVersionId: previousVersion.id,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findFirst.mockResolvedValueOnce(currentActive); // Find current active
        mockTx.promptVersion.findUnique.mockResolvedValueOnce(previousVersion); // Follow rollback chain
        mockTx.promptVersion.update
          .mockResolvedValueOnce({ ...currentActive, status: "ARCHIVED" }) // Archive current
          .mockResolvedValueOnce({
            ...previousVersion,
            status: "ACTIVE",
            activatedAt: new Date(),
            previousActiveVersionId: currentActive.id,
          }); // Reactivate previous
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      const result = await rollbackToPreviousVersion({
        shopId,
        promptName,
        rolledBackBy: "test@example.com",
      });

      expect(result.previousActiveVersion).toBe(3);
      expect(result.newActiveVersion).toBe(2);
    });

    it("should throw error when no active version exists", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findFirst.mockResolvedValue(null); // No active version
        return callback(mockTx);
      });

      await expect(
        rollbackToPreviousVersion({
          shopId,
          promptName,
          rolledBackBy: "test@example.com",
        })
      ).rejects.toThrow(`No active version found for "${promptName}"`);
    });

    it("should throw error when no previous version to rollback to", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const currentActive = {
        ...createMockVersion(definition.id, 1, "ACTIVE", "ver-1"),
        previousActiveVersionId: null,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findFirst.mockResolvedValueOnce(currentActive); // Find current active
        return callback(mockTx);
      });

      await expect(
        rollbackToPreviousVersion({
          shopId,
          promptName,
          rolledBackBy: "test@example.com",
        })
      ).rejects.toThrow(`No previous version found to rollback to`);
    });
  });

  // ===========================================================================
  // Test #10: All changes recorded in audit log
  // ===========================================================================

  describe("AC #10: Audit log records all changes", () => {
    it("should create audit log entry when creating a definition", async () => {
      const shopId = "shop-1";
      const name = "new-prompt";
      const definition = createMockDefinition(shopId, name);

      mockPrisma.promptDefinition.create.mockResolvedValue(definition);
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      await createPromptDefinition({
        shopId,
        name,
        description: "Test prompt",
        createdBy: "admin@example.com",
      });

      expect(mockPrisma.promptAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId,
          actor: "admin@example.com",
          action: "PROMPT_CREATE",
          targetType: "prompt_definition",
          targetId: definition.id,
          targetName: name,
        }),
      });
    });

    it("should create audit log entry when creating a version", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const newVersion = createMockVersion(definition.id, 1, "DRAFT");

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.aggregate.mockResolvedValue({ _max: { version: null } });
        mockTx.promptVersion.create.mockResolvedValue(newVersion);
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      await createVersion({
        shopId,
        promptName,
        systemTemplate: "Template",
        createdBy: "test@example.com",
      });

      expect(mockPrisma.promptAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId,
          actor: "test@example.com",
          action: "PROMPT_UPDATE_DRAFT",
          targetType: "prompt_version",
        }),
      });
    });

    it("should create audit log entry when activating a version", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const versionToActivate = createMockVersion(definition.id, 1, "DRAFT", "ver-1");

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findUnique.mockResolvedValue(versionToActivate);
        mockTx.promptVersion.findFirst.mockResolvedValue(null); // No current active
        mockTx.promptVersion.update.mockResolvedValue({
          ...versionToActivate,
          status: "ACTIVE",
          activatedAt: new Date(),
        });
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      await activateVersion({
        shopId,
        promptName,
        versionId: "ver-1",
        activatedBy: "test@example.com",
      });

      expect(mockPrisma.promptAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId,
          actor: "test@example.com",
          action: "PROMPT_ACTIVATE",
          targetType: "prompt_version",
        }),
      });
    });

    it("should create audit log entry when rolling back", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const previousVersion = createMockVersion(definition.id, 1, "ARCHIVED", "ver-1");
      const currentActive = {
        ...createMockVersion(definition.id, 2, "ACTIVE", "ver-2"),
        previousActiveVersionId: previousVersion.id,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findFirst.mockResolvedValueOnce(currentActive);
        mockTx.promptVersion.findUnique.mockResolvedValueOnce(previousVersion);
        mockTx.promptVersion.update
          .mockResolvedValueOnce({ ...currentActive, status: "ARCHIVED" })
          .mockResolvedValueOnce({
            ...previousVersion,
            status: "ACTIVE",
            previousActiveVersionId: currentActive.id,
          });
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      await rollbackToPreviousVersion({
        shopId,
        promptName,
        rolledBackBy: "test@example.com",
      });

      expect(mockPrisma.promptAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId,
          actor: "test@example.com",
          action: "PROMPT_ROLLBACK",
          targetType: "prompt_version",
          before: expect.objectContaining({ version: 2 }),
          after: expect.objectContaining({ version: 1 }),
        }),
      });
    });
  });

  // ===========================================================================
  // Test #12: Concurrent version creation -> no duplicate version numbers
  // ===========================================================================

  describe("AC #12: Concurrent version creation - race safety", () => {
    it("should use Serializable transaction isolation for version creation", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);

      mockPrisma.$transaction.mockImplementation(async (callback, options) => {
        // Verify isolation level is Serializable
        expect(options?.isolationLevel).toBe("Serializable");
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.aggregate.mockResolvedValue({ _max: { version: 1 } });
        mockTx.promptVersion.create.mockResolvedValue(
          createMockVersion(definition.id, 2, "DRAFT")
        );
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      await createVersion({
        shopId,
        promptName,
        systemTemplate: "Template",
        createdBy: "test@example.com",
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: "Serializable" })
      );
    });

    it("should simulate concurrent version creation and verify sequential incrementing", async () => {
      // This test verifies the transaction logic by simulating what happens
      // when multiple concurrent requests try to create versions
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);

      let currentMaxVersion = 0;

      // Simulate Serializable isolation: each transaction sees the max version
      // that was committed before it started, and increments from there
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        // Each transaction reads max version at start
        const maxAtStart = currentMaxVersion;
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.aggregate.mockResolvedValue({
          _max: { version: maxAtStart },
        });

        // Simulate creating with incremented version
        const newVersion = maxAtStart + 1;
        const created = createMockVersion(definition.id, newVersion, "DRAFT");
        mockTx.promptVersion.create.mockResolvedValue(created);

        // Commit increments the global max
        currentMaxVersion = newVersion;

        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      // Create 3 versions sequentially (simulating serialized execution)
      const results = [];
      for (let i = 0; i < 3; i++) {
        const result = await createVersion({
          shopId,
          promptName,
          systemTemplate: `Template ${i}`,
          createdBy: "test@example.com",
        });
        results.push(result);
      }

      // Verify all versions are unique and sequential
      expect(results[0].version).toBe(1);
      expect(results[1].version).toBe(2);
      expect(results[2].version).toBe(3);
    });
  });

  // ===========================================================================
  // Test #13: Concurrent activation -> only one ACTIVE version
  // ===========================================================================

  describe("AC #13: Concurrent activation - only one ACTIVE", () => {
    it("should use Serializable transaction isolation for activation", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const versionToActivate = createMockVersion(definition.id, 1, "DRAFT", "ver-1");

      mockPrisma.$transaction.mockImplementation(async (callback, options) => {
        expect(options?.isolationLevel).toBe("Serializable");
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findUnique.mockResolvedValue(versionToActivate);
        mockTx.promptVersion.findFirst.mockResolvedValue(null);
        mockTx.promptVersion.update.mockResolvedValue({
          ...versionToActivate,
          status: "ACTIVE",
        });
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      await activateVersion({
        shopId,
        promptName,
        versionId: "ver-1",
        activatedBy: "test@example.com",
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: "Serializable" })
      );
    });

    it("should archive current active before activating new", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const currentActive = createMockVersion(definition.id, 1, "ACTIVE", "ver-1");
      const newVersion = createMockVersion(definition.id, 2, "DRAFT", "ver-2");

      const updateCalls: Array<{ id: string; status: string }> = [];

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findUnique.mockResolvedValue(newVersion);
        mockTx.promptVersion.findFirst.mockResolvedValue(currentActive);
        mockTx.promptVersion.update.mockImplementation(async (args) => {
          updateCalls.push({ id: args.where.id, status: args.data.status });
          return { ...args.where, ...args.data };
        });
        return callback(mockTx);
      });
      mockPrisma.promptAuditLog.create.mockResolvedValue({});

      await activateVersion({
        shopId,
        promptName,
        versionId: "ver-2",
        activatedBy: "test@example.com",
      });

      // Verify order: archive current first, then activate new
      expect(updateCalls).toHaveLength(2);
      expect(updateCalls[0]).toEqual({ id: "ver-1", status: "ARCHIVED" });
      expect(updateCalls[1]).toEqual(
        expect.objectContaining({ id: "ver-2", status: "ACTIVE" })
      );
    });

    it("should not create audit log when version is already active", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const alreadyActive = createMockVersion(definition.id, 1, "ACTIVE", "ver-1");

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findUnique.mockResolvedValue(alreadyActive);
        return callback(mockTx);
      });

      const result = await activateVersion({
        shopId,
        promptName,
        versionId: "ver-1",
        activatedBy: "test@example.com",
      });

      expect(result.wasAlreadyActive).toBe(true);
      expect(mockPrisma.promptAuditLog.create).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Additional edge cases
  // ===========================================================================

  describe("Edge cases", () => {
    it("should require at least one template when creating a version", async () => {
      await expect(
        createVersion({
          shopId: "shop-1",
          promptName: "extractor",
          createdBy: "test@example.com",
          // No templates provided
        })
      ).rejects.toThrow("At least one template");
    });

    it("should throw error when activating version from different prompt", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";
      const definition = createMockDefinition(shopId, promptName);
      const wrongVersion = {
        ...createMockVersion("other-def", 1, "DRAFT", "ver-wrong"),
        promptDefinitionId: "other-def",
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockTx.promptDefinition.findUnique.mockResolvedValue(definition);
        mockTx.promptVersion.findUnique.mockResolvedValue(wrongVersion);
        return callback(mockTx);
      });

      await expect(
        activateVersion({
          shopId,
          promptName,
          versionId: "ver-wrong",
          activatedBy: "test@example.com",
        })
      ).rejects.toThrow("does not belong to prompt");
    });

    it("should not archive an active version directly", async () => {
      const shopId = "shop-1";
      const activeVersion = createMockVersion("def-1", 1, "ACTIVE", "ver-1");

      mockPrisma.promptVersion.findUnique.mockResolvedValue({
        ...activeVersion,
        promptDefinition: { shopId },
      });

      await expect(
        archiveVersion({
          shopId,
          versionId: "ver-1",
          archivedBy: "test@example.com",
        })
      ).rejects.toThrow("Cannot archive active version");
    });
  });
});

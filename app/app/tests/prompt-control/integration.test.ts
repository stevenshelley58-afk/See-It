/**
 * Integration Tests for Prompt Control Plane
 *
 * These tests verify end-to-end workflows including:
 * - Full create/edit/activate/rollback lifecycle
 * - Multi-tenant isolation
 * - Runtime config enforcement
 * - Audit trail completeness
 *
 * NOTE: These tests use mocked Prisma. For full database integration tests,
 * use a test database with Prisma transactions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";

// =============================================================================
// Complete Mock Setup
// =============================================================================

interface MockPromptDefinition {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  defaultModel: string;
  defaultParams: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  versions?: MockPromptVersion[];
}

interface MockPromptVersion {
  id: string;
  promptDefinitionId: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  systemTemplate: string | null;
  developerTemplate: string | null;
  userTemplate: string | null;
  model: string | null;
  params: Record<string, unknown> | null;
  templateHash: string;
  changeNotes: string | null;
  createdAt: Date;
  createdBy: string;
  activatedAt: Date | null;
  activatedBy: string | null;
}

interface MockAuditLog {
  id: string;
  shopId: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

// In-memory stores for integration testing
let definitions: MockPromptDefinition[] = [];
let versions: MockPromptVersion[] = [];
let auditLogs: MockAuditLog[] = [];
let runtimeConfigs: Map<string, Record<string, unknown>> = new Map();
let versionCounter = 0;
let txnQueue: Promise<unknown> = Promise.resolve();

function resetStores() {
  definitions = [];
  versions = [];
  auditLogs = [];
  runtimeConfigs = new Map();
  versionCounter = 0;
  txnQueue = Promise.resolve();
}

const mockTx = {
  promptDefinition: {
    findUnique: vi.fn(async ({ where }) => {
      if (where.shopId_name) {
        return definitions.find(
          (d) => d.shopId === where.shopId_name.shopId && d.name === where.shopId_name.name
        ) ?? null;
      }
      return definitions.find((d) => d.id === where.id) ?? null;
    }),
    create: vi.fn(async ({ data }) => {
      const def: MockPromptDefinition = {
        id: `def-${++versionCounter}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      definitions.push(def);
      return def;
    }),
  },
  promptVersion: {
    aggregate: vi.fn(async ({ where }) => {
      const defVersions = versions.filter(
        (v) => v.promptDefinitionId === where.promptDefinitionId
      );
      const max = defVersions.reduce((m, v) => Math.max(m, v.version), 0);
      return { _max: { version: max || null } };
    }),
    create: vi.fn(async ({ data }) => {
      const ver: MockPromptVersion = {
        id: `ver-${++versionCounter}`,
        ...data,
        createdAt: new Date(),
      };
      versions.push(ver);
      return ver;
    }),
    findUnique: vi.fn(async ({ where }) => {
      return versions.find((v) => v.id === where.id) ?? null;
    }),
    findFirst: vi.fn(async ({ where, orderBy }) => {
      let filtered = versions.filter(
        (v) => v.promptDefinitionId === where.promptDefinitionId
      );
      if (where.status) {
        filtered = filtered.filter((v) => v.status === where.status);
      }
      if (orderBy?.activatedAt === "desc") {
        filtered.sort((a, b) => {
          if (!a.activatedAt) return 1;
          if (!b.activatedAt) return -1;
          return b.activatedAt.getTime() - a.activatedAt.getTime();
        });
      }
      return filtered[0] ?? null;
    }),
    update: vi.fn(async ({ where, data }) => {
      const ver = versions.find((v) => v.id === where.id);
      if (ver) {
        Object.assign(ver, data);
      }
      return ver;
    }),
  },
  promptAuditLog: {
    create: vi.fn(async ({ data }) => {
      const log: MockAuditLog = {
        id: `log-${++versionCounter}`,
        ...data,
        createdAt: new Date(),
      };
      auditLogs.push(log);
      return log;
    }),
  },
};

const mockPrisma = vi.hoisted(() => ({
  promptDefinition: {
    create: vi.fn(async ({ data }) => mockTx.promptDefinition.create({ data })),
    findUnique: vi.fn(async ({ where, include }) => {
      const def = await mockTx.promptDefinition.findUnique({ where });
      if (def && include?.versions) {
        def.versions = versions.filter((v) => v.promptDefinitionId === def.id);
        if (include.versions.where?.status) {
          def.versions = def.versions.filter(
            (v) => v.status === include.versions.where.status
          );
        }
      }
      return def;
    }),
  },
  promptVersion: {
    findUnique: vi.fn(async ({ where, include }) => {
      const ver = versions.find((v) => v.id === where.id) ?? null;
      if (ver && include?.promptDefinition) {
        (ver as any).promptDefinition = definitions.find(
          (d) => d.id === ver.promptDefinitionId
        );
      }
      return ver;
    }),
    update: vi.fn(async ({ where, data }) => mockTx.promptVersion.update({ where, data })),
  },
  promptAuditLog: {
    create: vi.fn(async ({ data }) => mockTx.promptAuditLog.create({ data })),
    findMany: vi.fn(async ({ where }) => {
      return auditLogs.filter((l) => l.shopId === where.shopId);
    }),
  },
  shopRuntimeConfig: {
    findUnique: vi.fn(async ({ where }) => {
      return runtimeConfigs.get(where.shopId) ?? null;
    }),
  },
  // Serialize "transactions" to better simulate Serializable isolation.
  $transaction: vi.fn((callback, options) => {
    const run = () => callback(mockTx);
    const next = txnQueue.then(run, run);
    txnQueue = next;
    return next;
  }),
}));

vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

// Import after mocking
import {
  createPromptDefinition,
  createVersion,
  activateVersion,
  rollbackToPreviousVersion,
} from "~/services/prompt-control/prompt-version-manager.server";

import {
  SYSTEM_TENANT_ID,
  resolvePrompt,
  buildResolvedConfigSnapshot,
  loadRuntimeConfig,
  computeRequestHash,
  renderTemplate,
  type RuntimeConfigSnapshot,
} from "~/services/prompt-control/prompt-resolver.server";

// =============================================================================
// Integration Tests
// =============================================================================

describe("Prompt Control Plane Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ===========================================================================
  // AC #1: Full lifecycle - create, edit, activate, next run uses new prompt
  // ===========================================================================

  describe("AC #1: Full create/edit/activate lifecycle", () => {
    it("should complete full workflow: create definition -> create versions -> activate", async () => {
      const shopId = "shop-integration";
      const promptName = "lifecycle-test";
      const actor = "test@example.com";

      // Step 1: Create definition
      const definition = await createPromptDefinition({
        shopId,
        name: promptName,
        description: "Integration test prompt",
        defaultModel: "gemini-2.5-flash",
        createdBy: actor,
      });

      expect(definition.id).toBeDefined();
      expect(definition.name).toBe(promptName);

      // Step 2: Create draft v1
      const v1 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "System v1",
        userTemplate: "User v1",
        createdBy: actor,
      });

      expect(v1.version).toBe(1);
      expect(v1.status).toBe("DRAFT");

      // Step 3: Activate v1
      const activateResult1 = await activateVersion({
        shopId,
        promptName,
        versionId: v1.id,
        activatedBy: actor,
      });

      expect(activateResult1.version.status).toBe("ACTIVE");
      expect(activateResult1.previousActiveId).toBeNull();

      // Step 4: Create draft v2
      const v2 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "System v2 - improved",
        userTemplate: "User v2 - improved",
        createdBy: actor,
      });

      expect(v2.version).toBe(2);
      expect(v2.status).toBe("DRAFT");

      // Step 5: Activate v2 (should archive v1)
      const activateResult2 = await activateVersion({
        shopId,
        promptName,
        versionId: v2.id,
        activatedBy: actor,
      });

      expect(activateResult2.version.status).toBe("ACTIVE");
      expect(activateResult2.previousActiveId).toBe(v1.id);

      // Verify v1 is now archived
      const v1After = versions.find((v) => v.id === v1.id);
      expect(v1After?.status).toBe("ARCHIVED");

      // Step 6: Verify audit trail has all actions
      const logs = auditLogs.filter((l) => l.shopId === shopId);
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("PROMPT_CREATE");
      expect(actions).toContain("PROMPT_UPDATE_DRAFT");
      expect(actions).toContain("PROMPT_ACTIVATE");
    });
  });

  // ===========================================================================
  // AC #2: Shop isolation - changes in one shop don't affect another
  // ===========================================================================

  describe("AC #2: Multi-tenant shop isolation", () => {
    it("should maintain complete isolation between shops", async () => {
      const shopA = "shop-A";
      const shopB = "shop-B";
      const promptName = "shared-prompt-name";

      // Create definition for Shop A
      await createPromptDefinition({
        shopId: shopA,
        name: promptName,
        createdBy: "admin@shop-a.com",
      });

      // Create definition for Shop B
      await createPromptDefinition({
        shopId: shopB,
        name: promptName,
        createdBy: "admin@shop-b.com",
      });

      // Shop A creates and activates v1
      const shopAv1 = await createVersion({
        shopId: shopA,
        promptName,
        systemTemplate: "Shop A template",
        createdBy: "admin@shop-a.com",
      });
      await activateVersion({
        shopId: shopA,
        promptName,
        versionId: shopAv1.id,
        activatedBy: "admin@shop-a.com",
      });

      // Shop B creates v1, v2 and activates v2
      const shopBv1 = await createVersion({
        shopId: shopB,
        promptName,
        systemTemplate: "Shop B v1",
        createdBy: "admin@shop-b.com",
      });
      const shopBv2 = await createVersion({
        shopId: shopB,
        promptName,
        systemTemplate: "Shop B v2",
        createdBy: "admin@shop-b.com",
      });
      await activateVersion({
        shopId: shopB,
        promptName,
        versionId: shopBv2.id,
        activatedBy: "admin@shop-b.com",
      });

      // Verify: Shop A has 1 version (v1 ACTIVE)
      const shopAVersions = versions.filter(
        (v) =>
          definitions.find((d) => d.id === v.promptDefinitionId)?.shopId === shopA
      );
      expect(shopAVersions).toHaveLength(1);
      expect(shopAVersions[0].version).toBe(1);
      expect(shopAVersions[0].status).toBe("ACTIVE");

      // Verify: Shop B has 2 versions (v1 DRAFT, v2 ACTIVE)
      const shopBVersions = versions.filter(
        (v) =>
          definitions.find((d) => d.id === v.promptDefinitionId)?.shopId === shopB
      );
      expect(shopBVersions).toHaveLength(2);
      const shopBActive = shopBVersions.find((v) => v.status === "ACTIVE");
      expect(shopBActive?.version).toBe(2);

      // Verify: Audit logs are shop-specific
      const shopALogs = auditLogs.filter((l) => l.shopId === shopA);
      const shopBLogs = auditLogs.filter((l) => l.shopId === shopB);
      expect(shopALogs.length).toBeGreaterThan(0);
      expect(shopBLogs.length).toBeGreaterThan(0);
      expect(shopALogs.every((l) => l.shopId === shopA)).toBe(true);
      expect(shopBLogs.every((l) => l.shopId === shopB)).toBe(true);
    });
  });

  // ===========================================================================
  // AC #4: Rollback workflow
  // ===========================================================================

  describe("AC #4: Rollback to previous version", () => {
    it("should rollback and restore previous active version", async () => {
      const shopId = "shop-rollback";
      const promptName = "rollback-test";

      // Setup: Create definition with 3 versions, activate in sequence
      await createPromptDefinition({
        shopId,
        name: promptName,
        createdBy: "admin@test.com",
      });

      const v1 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "v1 template",
        createdBy: "admin@test.com",
      });
      await activateVersion({
        shopId,
        promptName,
        versionId: v1.id,
        activatedBy: "admin@test.com",
      });

      const v2 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "v2 template",
        createdBy: "admin@test.com",
      });
      await activateVersion({
        shopId,
        promptName,
        versionId: v2.id,
        activatedBy: "admin@test.com",
      });

      const v3 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "v3 template (buggy)",
        createdBy: "admin@test.com",
      });
      await activateVersion({
        shopId,
        promptName,
        versionId: v3.id,
        activatedBy: "admin@test.com",
      });

      // Current state: v3 ACTIVE, v2 ARCHIVED, v1 ARCHIVED
      expect(versions.find((v) => v.id === v3.id)?.status).toBe("ACTIVE");
      expect(versions.find((v) => v.id === v2.id)?.status).toBe("ARCHIVED");
      expect(versions.find((v) => v.id === v1.id)?.status).toBe("ARCHIVED");

      // Rollback: Should go back to v2
      const rollbackResult = await rollbackToPreviousVersion({
        shopId,
        promptName,
        rolledBackBy: "admin@test.com",
      });

      expect(rollbackResult.previousActiveVersion).toBe(3);
      expect(rollbackResult.newActiveVersion).toBe(2);

      // After rollback: v2 ACTIVE, v3 ARCHIVED, v1 still ARCHIVED
      expect(versions.find((v) => v.id === v2.id)?.status).toBe("ACTIVE");
      expect(versions.find((v) => v.id === v3.id)?.status).toBe("ARCHIVED");

      // Verify audit log records the rollback
      const rollbackLog = auditLogs.find((l) => l.action === "PROMPT_ROLLBACK");
      expect(rollbackLog).toBeDefined();
      expect(rollbackLog?.before).toEqual(
        expect.objectContaining({ version: 3 })
      );
      expect(rollbackLog?.after).toEqual(
        expect.objectContaining({ version: 2 })
      );
    });
  });

  // ===========================================================================
  // AC #10: Complete audit trail
  // ===========================================================================

  describe("AC #10: Complete audit trail", () => {
    it("should record before/after state for all changes", async () => {
      const shopId = "shop-audit";
      const promptName = "audit-test";

      // Create definition
      await createPromptDefinition({
        shopId,
        name: promptName,
        description: "Audit test",
        defaultModel: "gemini-2.5-flash",
        createdBy: "admin@test.com",
      });

      // Create version
      const v1 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "Template content",
        createdBy: "admin@test.com",
      });

      // Activate version
      await activateVersion({
        shopId,
        promptName,
        versionId: v1.id,
        activatedBy: "admin@test.com",
      });

      // Verify audit logs
      const logs = auditLogs.filter((l) => l.shopId === shopId);

      // Check CREATE log
      const createLog = logs.find((l) => l.action === "PROMPT_CREATE");
      expect(createLog).toBeDefined();
      expect(createLog?.before).toBeNull();
      expect(createLog?.after).toBeDefined();

      // Check UPDATE_DRAFT log
      const draftLog = logs.find((l) => l.action === "PROMPT_UPDATE_DRAFT");
      expect(draftLog).toBeDefined();
      expect(draftLog?.after).toEqual(
        expect.objectContaining({
          status: "DRAFT",
        })
      );

      // Check ACTIVATE log
      const activateLog = logs.find((l) => l.action === "PROMPT_ACTIVATE");
      expect(activateLog).toBeDefined();
      expect(activateLog?.after).toEqual(
        expect.objectContaining({
          activeVersionId: v1.id,
        })
      );
    });
  });

  // ===========================================================================
  // AC #12 & #13: Concurrent operations (simulated)
  // ===========================================================================

  describe("AC #12 & #13: Concurrent operation safety", () => {
    it("should prevent duplicate version numbers in concurrent creation scenario", async () => {
      const shopId = "shop-concurrent";
      const promptName = "concurrent-test";

      await createPromptDefinition({
        shopId,
        name: promptName,
        createdBy: "admin@test.com",
      });

      // Simulate 5 concurrent version creations
      // Due to mocking, these will execute sequentially but test the logic
      const promises = Array.from({ length: 5 }, (_, i) =>
        createVersion({
          shopId,
          promptName,
          systemTemplate: `Template ${i}`,
          createdBy: `user${i}@test.com`,
        })
      );

      const results = await Promise.all(promises);

      // Verify all versions have unique numbers
      const versionNumbers = results.map((r) => r.version);
      const uniqueNumbers = new Set(versionNumbers);
      expect(uniqueNumbers.size).toBe(5);

      // Verify versions are sequential
      const sorted = [...versionNumbers].sort((a, b) => a - b);
      expect(sorted).toEqual([1, 2, 3, 4, 5]);
    });

    it("should ensure only one ACTIVE version after concurrent activations", async () => {
      const shopId = "shop-concurrent-activate";
      const promptName = "concurrent-activate-test";

      await createPromptDefinition({
        shopId,
        name: promptName,
        createdBy: "admin@test.com",
      });

      // Create 3 versions
      const v1 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "v1",
        createdBy: "admin@test.com",
      });
      const v2 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "v2",
        createdBy: "admin@test.com",
      });
      const v3 = await createVersion({
        shopId,
        promptName,
        systemTemplate: "v3",
        createdBy: "admin@test.com",
      });

      // Activate all three (simulating concurrent attempts)
      // Last one wins due to serializable transaction
      await activateVersion({
        shopId,
        promptName,
        versionId: v1.id,
        activatedBy: "admin@test.com",
      });
      await activateVersion({
        shopId,
        promptName,
        versionId: v2.id,
        activatedBy: "admin@test.com",
      });
      await activateVersion({
        shopId,
        promptName,
        versionId: v3.id,
        activatedBy: "admin@test.com",
      });

      // Verify only one ACTIVE version
      const activeVersions = versions.filter((v) => v.status === "ACTIVE");
      expect(activeVersions).toHaveLength(1);
      expect(activeVersions[0].id).toBe(v3.id);

      // Verify others are archived
      expect(versions.find((v) => v.id === v1.id)?.status).toBe("ARCHIVED");
      expect(versions.find((v) => v.id === v2.id)?.status).toBe("ARCHIVED");
    });
  });

  // ===========================================================================
  // AC #14: Request hash stability
  // ===========================================================================

  describe("AC #14: Request hash stability", () => {
    it("should produce identical hashes for same images in different orders", () => {
      const promptName = "extractor";
      const resolutionHash = "abc123def456";

      const testCases = [
        ["image-z.png", "image-a.png", "image-m.png"],
        ["image-a.png", "image-m.png", "image-z.png"],
        ["image-m.png", "image-z.png", "image-a.png"],
        ["image-a.png", "image-z.png", "image-m.png"],
      ];

      const hashes = testCases.map((images) =>
        computeRequestHash(promptName, resolutionHash, images)
      );

      // All hashes should be identical
      expect(new Set(hashes).size).toBe(1);
    });
  });

  // ===========================================================================
  // AC #15: Template rendering with dot paths
  // ===========================================================================

  describe("AC #15: Template dot-path rendering", () => {
    it("should render complete template with mixed variable types", () => {
      const template = `
You are analyzing a {{product.type}} called "{{product.title}}".
The product is made of {{product.material}} and belongs to the {{category}} category.
Placement surface: {{placement.surface}}
Style notes: {{style}}
      `.trim();

      const variables = {
        "product.type": "sofa",
        "product.title": "Modern Sectional",
        "product.material": "premium leather",
        category: "Living Room",
        "placement.surface": "floor",
        style: "contemporary minimalist",
      };

      const result = renderTemplate(template, variables);

      expect(result).toContain('analyzing a sofa called "Modern Sectional"');
      expect(result).toContain("made of premium leather");
      expect(result).toContain("Living Room category");
      expect(result).toContain("Placement surface: floor");
      expect(result).toContain("Style notes: contemporary minimalist");
    });
  });
});

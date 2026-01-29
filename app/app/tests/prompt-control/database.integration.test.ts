/**
 * Database Integration Tests for Prompt Control Plane
 *
 * These tests run against a REAL database to verify:
 * - Unique constraint on [shopId, name]
 * - Cascade delete for versions when definition deleted
 * - Concurrent version creation with Serializable isolation
 * - Transaction rollback on constraint violations
 *
 * IMPORTANT: These tests require a running PostgreSQL database.
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";

const HAS_DATABASE = !!process.env.DATABASE_URL;
const describeDb = HAS_DATABASE ? describe : describe.skip;

// Create a dedicated Prisma client for testing
const prisma = HAS_DATABASE
  ? new PrismaClient({
      log: process.env.DEBUG_PRISMA ? ["query", "error", "warn"] : ["error"],
    })
  : (null as unknown as PrismaClient);

// Test data constants
const TEST_PREFIX = "test_integration_";
const TEST_SHOP_DOMAIN = `${TEST_PREFIX}shop_${Date.now()}.myshopify.com`;

// Test shop ID - created in beforeAll
let testShopId: string;

// =============================================================================
// Setup & Cleanup
// =============================================================================

async function cleanupTestData() {
  // Delete all test data created by these tests
  // Order matters due to FK constraints - delete children first

  // Delete prompt versions via their definitions
  await prisma.promptVersion.deleteMany({
    where: {
      promptDefinition: {
        name: { startsWith: TEST_PREFIX },
      },
    },
  });

  // Delete prompt definitions
  await prisma.promptDefinition.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  });

  // Delete runtime configs for test shops
  await prisma.shopRuntimeConfig.deleteMany({
    where: {
      shop: { shopDomain: { startsWith: TEST_PREFIX } },
    },
  });

  // Delete test shops (cascades to related data)
  await prisma.shop.deleteMany({
    where: { shopDomain: { startsWith: TEST_PREFIX } },
  });
}

if (HAS_DATABASE) {
  beforeAll(async () => {
    // Clean up any leftover test data from previous runs
    await cleanupTestData();

    // Create a test shop for FK references
    const shop = await prisma.shop.create({
      data: {
        shopDomain: TEST_SHOP_DOMAIN,
        shopifyShopId: `${Date.now()}`,
        accessToken: "test-token",
        plan: "test",
        monthlyQuota: 1000,
        dailyQuota: 100,
      },
    });
    testShopId = shop.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });
}

// =============================================================================
// Helper Functions
// =============================================================================

function createDefinitionName(suffix: string): string {
  return `${TEST_PREFIX}${suffix}_${Date.now()}`;
}

function computeTemplateHash(content: string): string {
  // Simple hash for test purposes
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

// =============================================================================
// Test: Unique Constraint on [shopId, name]
// =============================================================================

describeDb("Database Constraints", () => {
  describe("Unique constraint on [shopId, name]", () => {
    it("should allow same name for different shops", async () => {
      const promptName = createDefinitionName("unique_test");

      // Create a second test shop
      const shop2 = await prisma.shop.create({
        data: {
          shopDomain: `${TEST_PREFIX}shop2_${Date.now()}.myshopify.com`,
          shopifyShopId: `${Date.now()}_2`,
          accessToken: "test-token-2",
          plan: "test",
          monthlyQuota: 1000,
          dailyQuota: 100,
        },
      });

      try {
        // Create definition for shop 1
        const def1 = await prisma.promptDefinition.create({
          data: {
            shopId: testShopId,
            name: promptName,
            description: "Test definition for shop 1",
          },
        });

        // Create definition with same name for shop 2 - should succeed
        const def2 = await prisma.promptDefinition.create({
          data: {
            shopId: shop2.id,
            name: promptName,
            description: "Test definition for shop 2",
          },
        });

        expect(def1.name).toBe(promptName);
        expect(def2.name).toBe(promptName);
        expect(def1.shopId).not.toBe(def2.shopId);

        // Cleanup
        await prisma.promptDefinition.delete({ where: { id: def2.id } });
        await prisma.promptDefinition.delete({ where: { id: def1.id } });
      } finally {
        // Always clean up the second shop
        await prisma.shop.delete({ where: { id: shop2.id } });
      }
    });

    it("should reject duplicate name for same shop", async () => {
      const promptName = createDefinitionName("duplicate_test");

      // Create first definition
      const def1 = await prisma.promptDefinition.create({
        data: {
          shopId: testShopId,
          name: promptName,
          description: "First definition",
        },
      });

      try {
        // Attempt to create duplicate - should fail
        await expect(
          prisma.promptDefinition.create({
            data: {
              shopId: testShopId,
              name: promptName,
              description: "Duplicate definition",
            },
          })
        ).rejects.toThrow();
      } finally {
        // Cleanup
        await prisma.promptDefinition.delete({ where: { id: def1.id } });
      }
    });

    it("should return proper Prisma error code for unique violation", async () => {
      const promptName = createDefinitionName("error_code_test");

      const def1 = await prisma.promptDefinition.create({
        data: {
          shopId: testShopId,
          name: promptName,
        },
      });

      try {
        await prisma.promptDefinition.create({
          data: {
            shopId: testShopId,
            name: promptName,
          },
        });
        // Should not reach here
        expect.fail("Expected unique constraint violation");
      } catch (error) {
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        // P2002 is Prisma's error code for unique constraint violation
        expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      } finally {
        await prisma.promptDefinition.delete({ where: { id: def1.id } });
      }
    });
  });

  // ===========================================================================
  // Test: Cascade Delete
  // ===========================================================================

  describe("Cascade delete for versions when definition deleted", () => {
    it("should delete all versions when definition is deleted", async () => {
      const promptName = createDefinitionName("cascade_test");

      // Create definition
      const def = await prisma.promptDefinition.create({
        data: {
          shopId: testShopId,
          name: promptName,
        },
      });

      // Create multiple versions
      const version1 = await prisma.promptVersion.create({
        data: {
          promptDefinitionId: def.id,
          version: 1,
          status: "ACTIVE",
          systemTemplate: "System template v1",
          templateHash: computeTemplateHash("v1"),
          createdBy: "test@example.com",
        },
      });

      const version2 = await prisma.promptVersion.create({
        data: {
          promptDefinitionId: def.id,
          version: 2,
          status: "DRAFT",
          systemTemplate: "System template v2",
          templateHash: computeTemplateHash("v2"),
          createdBy: "test@example.com",
        },
      });

      // Verify versions exist
      const versionsBeforeDelete = await prisma.promptVersion.findMany({
        where: { promptDefinitionId: def.id },
      });
      expect(versionsBeforeDelete).toHaveLength(2);

      // Delete the definition
      await prisma.promptDefinition.delete({ where: { id: def.id } });

      // Verify versions are also deleted (cascade)
      const versionsAfterDelete = await prisma.promptVersion.findMany({
        where: { id: { in: [version1.id, version2.id] } },
      });
      expect(versionsAfterDelete).toHaveLength(0);

      // Verify definition is deleted
      const defAfterDelete = await prisma.promptDefinition.findUnique({
        where: { id: def.id },
      });
      expect(defAfterDelete).toBeNull();
    });

    it("should not affect versions of other definitions", async () => {
      const promptName1 = createDefinitionName("cascade_isolated_1");
      const promptName2 = createDefinitionName("cascade_isolated_2");

      // Create two definitions
      const def1 = await prisma.promptDefinition.create({
        data: { shopId: testShopId, name: promptName1 },
      });

      const def2 = await prisma.promptDefinition.create({
        data: { shopId: testShopId, name: promptName2 },
      });

      // Create versions for both
      await prisma.promptVersion.create({
        data: {
          promptDefinitionId: def1.id,
          version: 1,
          status: "ACTIVE",
          systemTemplate: "Template for def1",
          templateHash: computeTemplateHash("def1"),
          createdBy: "test@example.com",
        },
      });

      const def2Version = await prisma.promptVersion.create({
        data: {
          promptDefinitionId: def2.id,
          version: 1,
          status: "ACTIVE",
          systemTemplate: "Template for def2",
          templateHash: computeTemplateHash("def2"),
          createdBy: "test@example.com",
        },
      });

      // Delete def1
      await prisma.promptDefinition.delete({ where: { id: def1.id } });

      // Verify def2's version still exists
      const def2VersionAfter = await prisma.promptVersion.findUnique({
        where: { id: def2Version.id },
      });
      expect(def2VersionAfter).not.toBeNull();
      expect(def2VersionAfter?.promptDefinitionId).toBe(def2.id);

      // Cleanup
      await prisma.promptDefinition.delete({ where: { id: def2.id } });
    });
  });

  // ===========================================================================
  // Test: Unique Version Number per Definition
  // ===========================================================================

  describe("Unique constraint on [promptDefinitionId, version]", () => {
    it("should reject duplicate version numbers for same definition", async () => {
      const promptName = createDefinitionName("version_unique");

      const def = await prisma.promptDefinition.create({
        data: { shopId: testShopId, name: promptName },
      });

      try {
        // Create version 1
        await prisma.promptVersion.create({
          data: {
            promptDefinitionId: def.id,
            version: 1,
            status: "ACTIVE",
            systemTemplate: "First v1",
            templateHash: computeTemplateHash("first-v1"),
            createdBy: "test@example.com",
          },
        });

        // Attempt to create another version 1 - should fail
        await expect(
          prisma.promptVersion.create({
            data: {
              promptDefinitionId: def.id,
              version: 1, // Duplicate!
              status: "DRAFT",
              systemTemplate: "Second v1",
              templateHash: computeTemplateHash("second-v1"),
              createdBy: "test@example.com",
            },
          })
        ).rejects.toThrow();
      } finally {
        await prisma.promptDefinition.delete({ where: { id: def.id } });
      }
    });

    it("should allow same version number for different definitions", async () => {
      const promptName1 = createDefinitionName("version_diff_def_1");
      const promptName2 = createDefinitionName("version_diff_def_2");

      const def1 = await prisma.promptDefinition.create({
        data: { shopId: testShopId, name: promptName1 },
      });

      const def2 = await prisma.promptDefinition.create({
        data: { shopId: testShopId, name: promptName2 },
      });

      try {
        // Create version 1 for both definitions - should succeed
        const v1_def1 = await prisma.promptVersion.create({
          data: {
            promptDefinitionId: def1.id,
            version: 1,
            status: "ACTIVE",
            systemTemplate: "Def1 v1",
            templateHash: computeTemplateHash("def1-v1"),
            createdBy: "test@example.com",
          },
        });

        const v1_def2 = await prisma.promptVersion.create({
          data: {
            promptDefinitionId: def2.id,
            version: 1,
            status: "ACTIVE",
            systemTemplate: "Def2 v1",
            templateHash: computeTemplateHash("def2-v1"),
            createdBy: "test@example.com",
          },
        });

        expect(v1_def1.version).toBe(1);
        expect(v1_def2.version).toBe(1);
        expect(v1_def1.promptDefinitionId).not.toBe(v1_def2.promptDefinitionId);
      } finally {
        await prisma.promptDefinition.delete({ where: { id: def1.id } });
        await prisma.promptDefinition.delete({ where: { id: def2.id } });
      }
    });
  });

  // ===========================================================================
  // Test: Transaction Rollback on Constraint Violations
  // ===========================================================================

  describe("Transaction rollback on constraint violations", () => {
    it("should rollback entire transaction when any operation fails", async () => {
      const promptName1 = createDefinitionName("txn_rollback_1");
      const promptName2 = createDefinitionName("txn_rollback_2");

      // First, create a definition that will cause a conflict
      const existingDef = await prisma.promptDefinition.create({
        data: { shopId: testShopId, name: promptName2 },
      });

      try {
        // Attempt a transaction that will fail on the second operation
        await expect(
          prisma.$transaction(async (tx) => {
            // First operation succeeds
            await tx.promptDefinition.create({
              data: { shopId: testShopId, name: promptName1 },
            });

            // Second operation fails (duplicate name)
            await tx.promptDefinition.create({
              data: { shopId: testShopId, name: promptName2 }, // Conflicts with existingDef
            });
          })
        ).rejects.toThrow();

        // Verify the first definition was NOT created (rollback occurred)
        const def1 = await prisma.promptDefinition.findFirst({
          where: { shopId: testShopId, name: promptName1 },
        });
        expect(def1).toBeNull();
      } finally {
        await prisma.promptDefinition.delete({ where: { id: existingDef.id } });
      }
    });

    it("should rollback version creation when definition update fails", async () => {
      const promptName = createDefinitionName("txn_version_rollback");

      const def = await prisma.promptDefinition.create({
        data: { shopId: testShopId, name: promptName },
      });

      // Create version 1
      await prisma.promptVersion.create({
        data: {
          promptDefinitionId: def.id,
          version: 1,
          status: "ACTIVE",
          systemTemplate: "Original",
          templateHash: computeTemplateHash("original"),
          createdBy: "test@example.com",
        },
      });

      try {
        // Attempt a transaction that creates a version then fails
        await expect(
          prisma.$transaction(async (tx) => {
            // Create version 2
            await tx.promptVersion.create({
              data: {
                promptDefinitionId: def.id,
                version: 2,
                status: "DRAFT",
                systemTemplate: "New version",
                templateHash: computeTemplateHash("new"),
                createdBy: "test@example.com",
              },
            });

            // Force failure by creating duplicate version 1
            await tx.promptVersion.create({
              data: {
                promptDefinitionId: def.id,
                version: 1, // Duplicate - will fail
                status: "DRAFT",
                systemTemplate: "Conflict",
                templateHash: computeTemplateHash("conflict"),
                createdBy: "test@example.com",
              },
            });
          })
        ).rejects.toThrow();

        // Verify version 2 was NOT created (rollback occurred)
        const versions = await prisma.promptVersion.findMany({
          where: { promptDefinitionId: def.id },
        });
        expect(versions).toHaveLength(1);
        expect(versions[0].version).toBe(1);
      } finally {
        await prisma.promptDefinition.delete({ where: { id: def.id } });
      }
    });
  });

  // ===========================================================================
  // Test: Shop Runtime Config
  // ===========================================================================

  describe("ShopRuntimeConfig constraints", () => {
    it("should enforce unique shopId constraint", async () => {
      // Create runtime config
      const config = await prisma.shopRuntimeConfig.create({
        data: {
          shopId: testShopId,
          maxConcurrency: 5,
          dailyCostCap: 50,
          updatedBy: "test@example.com",
        },
      });

      try {
        // Attempt to create duplicate - should fail
        await expect(
          prisma.shopRuntimeConfig.create({
            data: {
              shopId: testShopId, // Same shop
              maxConcurrency: 10,
              dailyCostCap: 100,
              updatedBy: "test@example.com",
            },
          })
        ).rejects.toThrow();
      } finally {
        await prisma.shopRuntimeConfig.delete({ where: { id: config.id } });
      }
    });

    it("should support decimal dailyCostCap with precision", async () => {
      const config = await prisma.shopRuntimeConfig.create({
        data: {
          shopId: testShopId,
          maxConcurrency: 5,
          dailyCostCap: 99.99,
          updatedBy: "test@example.com",
        },
      });

      try {
        const loaded = await prisma.shopRuntimeConfig.findUnique({
          where: { shopId: testShopId },
        });

        expect(loaded).not.toBeNull();
        // Prisma returns Decimal as Decimal.js object, convert to number for comparison
        expect(Number(loaded!.dailyCostCap)).toBe(99.99);
      } finally {
        await prisma.shopRuntimeConfig.delete({ where: { id: config.id } });
      }
    });

    it("should cascade delete when shop is deleted", async () => {
      // Create a temporary shop
      const tempShop = await prisma.shop.create({
        data: {
          shopDomain: `${TEST_PREFIX}temp_cascade_${Date.now()}.myshopify.com`,
          shopifyShopId: `temp_${Date.now()}`,
          accessToken: "temp-token",
          plan: "test",
          monthlyQuota: 100,
          dailyQuota: 10,
        },
      });

      // Create runtime config for temp shop
      const config = await prisma.shopRuntimeConfig.create({
        data: {
          shopId: tempShop.id,
          maxConcurrency: 5,
          dailyCostCap: 50,
          updatedBy: "test@example.com",
        },
      });

      // Delete the shop
      await prisma.shop.delete({ where: { id: tempShop.id } });

      // Verify config is also deleted
      const configAfter = await prisma.shopRuntimeConfig.findUnique({
        where: { id: config.id },
      });
      expect(configAfter).toBeNull();
    });
  });

  // ===========================================================================
  // Test: Foreign Key Constraints
  // ===========================================================================

  describe("Foreign key constraints", () => {
    it("should reject version creation for non-existent definition", async () => {
      await expect(
        prisma.promptVersion.create({
          data: {
            promptDefinitionId: "non-existent-definition-id",
            version: 1,
            status: "DRAFT",
            systemTemplate: "Test",
            templateHash: computeTemplateHash("test"),
            createdBy: "test@example.com",
          },
        })
      ).rejects.toThrow();
    });

    it("should reject definition creation for non-existent shop", async () => {
      await expect(
        prisma.promptDefinition.create({
          data: {
            shopId: "non-existent-shop-id",
            name: createDefinitionName("orphan"),
          },
        })
      ).rejects.toThrow();
    });
  });
});

// =============================================================================
// Test: Concurrent Operations (Serializable Isolation)
// =============================================================================

describeDb("Concurrent Operations", () => {
  it("should handle concurrent version creation with proper isolation", async () => {
    const promptName = createDefinitionName("concurrent_test");

    const def = await prisma.promptDefinition.create({
      data: { shopId: testShopId, name: promptName },
    });

    try {
      // Simulate concurrent version creation
      // Both attempt to create "the next version" at the same time
      const createVersion = async (delay: number): Promise<number | null> => {
        await new Promise((r) => setTimeout(r, delay));

        try {
          // Use serializable transaction to safely get next version
          const result = await prisma.$transaction(
            async (tx) => {
              // Get current max version
              const maxVersion = await tx.promptVersion.aggregate({
                where: { promptDefinitionId: def.id },
                _max: { version: true },
              });

              const nextVersion = (maxVersion._max.version ?? 0) + 1;

              // Create the version
              const version = await tx.promptVersion.create({
                data: {
                  promptDefinitionId: def.id,
                  version: nextVersion,
                  status: "DRAFT",
                  systemTemplate: `Version ${nextVersion}`,
                  templateHash: computeTemplateHash(`v${nextVersion}-${delay}`),
                  createdBy: "test@example.com",
                },
              });

              return version.version;
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
          );

          return result;
        } catch (error) {
          // One of the concurrent transactions may fail and retry
          // This is expected behavior with serializable isolation
          return null;
        }
      };

      // Launch concurrent operations
      const results = await Promise.all([
        createVersion(0),
        createVersion(0),
        createVersion(0),
      ]);

      // At least one should succeed
      const successfulVersions = results.filter((v) => v !== null);
      expect(successfulVersions.length).toBeGreaterThanOrEqual(1);

      // Verify no duplicate versions were created
      const allVersions = await prisma.promptVersion.findMany({
        where: { promptDefinitionId: def.id },
        orderBy: { version: "asc" },
      });

      const versionNumbers = allVersions.map((v) => v.version);
      const uniqueVersions = [...new Set(versionNumbers)];
      expect(versionNumbers).toEqual(uniqueVersions);
    } finally {
      await prisma.promptDefinition.delete({ where: { id: def.id } });
    }
  });
});

// =============================================================================
// Test: Data Types and Validation
// =============================================================================

describeDb("Data Types and Validation", () => {
  it("should store and retrieve JSON params correctly", async () => {
    const promptName = createDefinitionName("json_params");

    const complexParams = {
      temperature: 0.7,
      maxTokens: 4096,
      nested: {
        array: [1, 2, 3],
        object: { key: "value" },
      },
      special: "string with 'quotes' and \"double quotes\"",
    };

    const def = await prisma.promptDefinition.create({
      data: {
        shopId: testShopId,
        name: promptName,
        defaultParams: complexParams,
      },
    });

    try {
      const loaded = await prisma.promptDefinition.findUnique({
        where: { id: def.id },
      });

      expect(loaded?.defaultParams).toEqual(complexParams);
    } finally {
      await prisma.promptDefinition.delete({ where: { id: def.id } });
    }
  });

  it("should handle large text templates", async () => {
    const promptName = createDefinitionName("large_template");
    const largeTemplate = "A".repeat(50000); // 50KB of text

    const def = await prisma.promptDefinition.create({
      data: { shopId: testShopId, name: promptName },
    });

    try {
      const version = await prisma.promptVersion.create({
        data: {
          promptDefinitionId: def.id,
          version: 1,
          status: "DRAFT",
          systemTemplate: largeTemplate,
          templateHash: computeTemplateHash(largeTemplate),
          createdBy: "test@example.com",
        },
      });

      const loaded = await prisma.promptVersion.findUnique({
        where: { id: version.id },
      });

      expect(loaded?.systemTemplate).toBe(largeTemplate);
      expect(loaded?.systemTemplate?.length).toBe(50000);
    } finally {
      await prisma.promptDefinition.delete({ where: { id: def.id } });
    }
  });

  it("should handle string array fields (modelAllowList)", async () => {
    const allowList = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"];

    const config = await prisma.shopRuntimeConfig.create({
      data: {
        shopId: testShopId,
        maxConcurrency: 5,
        modelAllowList: allowList,
        dailyCostCap: 50,
        updatedBy: "test@example.com",
      },
    });

    try {
      const loaded = await prisma.shopRuntimeConfig.findUnique({
        where: { shopId: testShopId },
      });

      expect(loaded?.modelAllowList).toEqual(allowList);
    } finally {
      await prisma.shopRuntimeConfig.delete({ where: { id: config.id } });
    }
  });
});

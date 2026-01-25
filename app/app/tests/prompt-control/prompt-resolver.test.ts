/**
 * Acceptance Tests for Prompt Control Plane - Prompt Resolver
 *
 * Tests:
 * - #3: No system tenant fallback (missing prompt hard-blocks)
 * - #5: View run's resolved config snapshot
 * - #7: Disable prompt via runtime config -> calls blocked
 * - #9: Model not in allow list -> call blocked
 * - #14: Same images, different order -> same requestHash (sorted)
 * - #15: Template with dot path -> {{product.title}} renders correctly
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =============================================================================
// Mock Prisma
// =============================================================================

const mockPrisma = vi.hoisted(() => ({
  promptDefinition: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  shopRuntimeConfig: {
    findUnique: vi.fn(),
  },
}));

vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

// Import after mocking
import {
  resolvePrompt,
  buildResolvedConfigSnapshot,
  loadRuntimeConfig,
  computeRequestHash,
  renderTemplate,
  resolveDotPath,
  type RuntimeConfigSnapshot,
} from "~/services/prompt-control/prompt-resolver.server";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockDefinition(shopId: string, name: string, id: string = "def-1") {
  return {
    id,
    shopId,
    name,
    description: null,
    defaultModel: "gemini-2.5-flash",
    defaultParams: { temperature: 0.7 },
    createdAt: new Date(),
    updatedAt: new Date(),
    versions: [],
  };
}

function createMockVersion(
  definitionId: string,
  version: number,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED"
) {
  return {
    id: `ver-${version}`,
    promptDefinitionId: definitionId,
    version,
    status,
    systemTemplate: `You are a helpful assistant (v${version})`,
    developerTemplate: null,
    userTemplate: `Process this: {{input}}`,
    model: "gemini-2.5-flash",
    params: { max_tokens: 4096 },
    templateHash: `hash-${version}`,
    changeNotes: null,
    createdAt: new Date(),
    createdBy: "test@example.com",
    activatedAt: status === "ACTIVE" ? new Date() : null,
    activatedBy: status === "ACTIVE" ? "test@example.com" : null,
  };
}

function createDefaultRuntimeConfig(): RuntimeConfigSnapshot {
  return {
    maxConcurrency: 5,
    modelAllowList: [],
    caps: {
      maxTokensOutput: 8192,
      maxImageBytes: 20000000,
    },
    dailyCostCap: 50,
    disabledPrompts: [],
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Prompt Resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Test #3: No system tenant fallback (fail-hard)
  // ===========================================================================

  describe("AC #3: No system tenant fallback", () => {
    it("should block when shop has no prompt definition", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(null);

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        runtimeConfig: createDefaultRuntimeConfig(),
      });

      expect(result.blocked).toBe(true);
      expect(result.resolved).toBeNull();
      expect(result.blockReason).toContain("not found for shop");
    });

    it("should use shop prompt when available", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const shopDef = {
        ...createMockDefinition(shopId, promptName, "shop-def"),
        versions: [createMockVersion("shop-def", 1, "ACTIVE")],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(shopDef);

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        runtimeConfig: createDefaultRuntimeConfig(),
      });

      expect(result.blocked).toBe(false);
      expect(result.resolved?.source).toBe("active");
      expect(result.resolved?.promptDefinitionId).toBe("shop-def");
    });
  });

  // ===========================================================================
  // Test #5: View run's resolved config snapshot
  // ===========================================================================

  describe("AC #5: Resolved config snapshot", () => {
    it("should build complete config snapshot with all resolved prompts", async () => {
      const shopId = "shop-1";

      const extractorDef = {
        ...createMockDefinition(shopId, "extractor", "def-ext"),
        versions: [createMockVersion("def-ext", 1, "ACTIVE")],
      };
      const builderDef = {
        ...createMockDefinition(shopId, "prompt_builder", "def-build"),
        versions: [createMockVersion("def-build", 2, "ACTIVE")],
      };

      mockPrisma.shopRuntimeConfig.findUnique.mockResolvedValue(null);
      mockPrisma.promptDefinition.findMany.mockResolvedValueOnce([
        extractorDef,
        builderDef,
      ]);

      const snapshot = await buildResolvedConfigSnapshot({
        shopId,
        promptNames: ["extractor", "prompt_builder"],
        variables: { input: "test" },
      });

      expect(snapshot.resolvedAt).toBeDefined();
      expect(snapshot.runtime).toBeDefined();
      expect(snapshot.prompts).toHaveProperty("extractor");
      expect(snapshot.prompts).toHaveProperty("prompt_builder");
      expect(snapshot.prompts.extractor.promptVersionId).toBe("ver-1");
      expect(snapshot.prompts.prompt_builder.promptVersionId).toBe("ver-2");
    });

    it("should include blocked prompts with reasons in snapshot", async () => {
      const shopId = "shop-1";

      const runtimeConfig: RuntimeConfigSnapshot = {
        ...createDefaultRuntimeConfig(),
        disabledPrompts: ["disabled_prompt"],
      };

      mockPrisma.shopRuntimeConfig.findUnique.mockResolvedValue({
        shopId,
        disabledPromptNames: ["disabled_prompt"],
        maxConcurrency: 5,
        modelAllowList: [],
        maxTokensOutputCap: 8192,
        maxImageBytesCap: 20000000,
        dailyCostCap: 50,
      });

      const extractorDef = {
        ...createMockDefinition(shopId, "extractor", "def-ext"),
        versions: [createMockVersion("def-ext", 1, "ACTIVE")],
      };

      mockPrisma.promptDefinition.findMany.mockResolvedValueOnce([extractorDef]);

      const snapshot = await buildResolvedConfigSnapshot({
        shopId,
        promptNames: ["extractor", "disabled_prompt"],
        variables: {},
      });

      expect(snapshot.prompts).toHaveProperty("extractor");
      expect(snapshot.blockedPrompts).toHaveProperty("disabled_prompt");
      expect(snapshot.blockedPrompts.disabled_prompt).toContain("disabled");
    });

    it("should capture exact messages that would be sent to provider", async () => {
      const shopId = "shop-1";

      const def = {
        ...createMockDefinition(shopId, "extractor", "def-1"),
        versions: [
          {
            ...createMockVersion("def-1", 1, "ACTIVE"),
            systemTemplate: "You are assistant for {{product.type}}",
            userTemplate: "Analyze: {{product.title}}",
          },
        ],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(def);

      const result = await resolvePrompt({
        shopId,
        promptName: "extractor",
        variables: {
          "product.type": "furniture",
          "product.title": "Oak Chair",
        },
        runtimeConfig: createDefaultRuntimeConfig(),
      });

      expect(result.resolved?.messages).toHaveLength(2);
      expect(result.resolved?.messages[0].role).toBe("system");
      expect(result.resolved?.messages[0].content).toBe("You are assistant for furniture");
      expect(result.resolved?.messages[1].role).toBe("user");
      expect(result.resolved?.messages[1].content).toBe("Analyze: Oak Chair");
    });
  });

  // ===========================================================================
  // Test #7: Disable prompt via runtime config -> calls blocked
  // ===========================================================================

  describe("AC #7: Disabled prompts are blocked", () => {
    it("should block prompt when in disabledPrompts list", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const runtimeConfig: RuntimeConfigSnapshot = {
        ...createDefaultRuntimeConfig(),
        disabledPrompts: ["extractor"],
      };

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: {},
        runtimeConfig,
      });

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain("disabled");
      expect(result.resolved).toBeNull();
    });

    it("should allow prompt when not in disabledPrompts list", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const def = {
        ...createMockDefinition(shopId, promptName, "def-1"),
        versions: [createMockVersion("def-1", 1, "ACTIVE")],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(def);

      const runtimeConfig: RuntimeConfigSnapshot = {
        ...createDefaultRuntimeConfig(),
        disabledPrompts: ["other_prompt"], // extractor is not disabled
      };

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        runtimeConfig,
      });

      expect(result.blocked).toBe(false);
      expect(result.resolved).not.toBeNull();
    });
  });

  // ===========================================================================
  // Test #9: Model not in allow list -> call blocked
  // ===========================================================================

  describe("AC #9: Model allow list", () => {
    it("should block when model is not in allow list", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const def = {
        ...createMockDefinition(shopId, promptName, "def-1"),
        versions: [
          {
            ...createMockVersion("def-1", 1, "ACTIVE"),
            model: "gemini-2.5-pro",
          },
        ],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(def);

      const runtimeConfig: RuntimeConfigSnapshot = {
        ...createDefaultRuntimeConfig(),
        modelAllowList: ["gemini-2.5-flash", "gemini-1.5-flash"], // pro not allowed
      };

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        runtimeConfig,
      });

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain("not in allow list");
    });

    it("should allow when model is in allow list", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const def = {
        ...createMockDefinition(shopId, promptName, "def-1"),
        versions: [
          {
            ...createMockVersion("def-1", 1, "ACTIVE"),
            model: "gemini-2.5-flash",
          },
        ],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(def);

      const runtimeConfig: RuntimeConfigSnapshot = {
        ...createDefaultRuntimeConfig(),
        modelAllowList: ["gemini-2.5-flash", "gemini-2.5-pro"],
      };

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        runtimeConfig,
      });

      expect(result.blocked).toBe(false);
      expect(result.resolved?.model).toBe("gemini-2.5-flash");
    });

    it("should allow any model when allow list is empty", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const def = {
        ...createMockDefinition(shopId, promptName, "def-1"),
        versions: [
          {
            ...createMockVersion("def-1", 1, "ACTIVE"),
            model: "any-model",
          },
        ],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(def);

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        runtimeConfig: createDefaultRuntimeConfig(),
      });

      expect(result.blocked).toBe(false);
      expect(result.resolved?.model).toBe("any-model");
    });
  });

  // ===========================================================================
  // Test #14: Same images, different order -> same requestHash (sorted)
  // ===========================================================================

  describe("AC #14: Request hash with sorted image refs", () => {
    it("should produce same hash regardless of image order", () => {
      const promptName = "extractor";
      const resolutionHash = "abc123";
      const images1 = ["img-c.png", "img-a.png", "img-b.png"];
      const images2 = ["img-a.png", "img-b.png", "img-c.png"];
      const images3 = ["img-b.png", "img-c.png", "img-a.png"];

      const hash1 = computeRequestHash(promptName, resolutionHash, images1);
      const hash2 = computeRequestHash(promptName, resolutionHash, images2);
      const hash3 = computeRequestHash(promptName, resolutionHash, images3);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("should produce different hash for different images", () => {
      const promptName = "extractor";
      const resolutionHash = "abc123";
      const images1 = ["img-a.png", "img-b.png"];
      const images2 = ["img-a.png", "img-c.png"];

      const hash1 = computeRequestHash(promptName, resolutionHash, images1);
      const hash2 = computeRequestHash(promptName, resolutionHash, images2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hash for different prompt names", () => {
      const resolutionHash = "abc123";
      const images = ["img-a.png"];

      const hash1 = computeRequestHash("extractor", resolutionHash, images);
      const hash2 = computeRequestHash("renderer", resolutionHash, images);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty image array", () => {
      const hash = computeRequestHash("extractor", "abc123", []);
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Test #15: Template with dot path -> {{product.title}} renders correctly
  // ===========================================================================

  describe("AC #15: Template rendering with dot paths", () => {
    it("should render {{product.title}} from flat key", () => {
      const template = "Product: {{product.title}}";
      const variables = {
        "product.title": "Teak Coffee Table",
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Product: Teak Coffee Table");
    });

    it("should render multiple dot-path variables", () => {
      const template =
        "The {{product.type}} named {{product.title}} is made of {{product.material}}";
      const variables = {
        "product.type": "chair",
        "product.title": "Ergonomic Office Chair",
        "product.material": "mesh and steel",
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe(
        "The chair named Ergonomic Office Chair is made of mesh and steel"
      );
    });

    it("should preserve unmatched variables", () => {
      const template = "Product: {{product.title}}, Unknown: {{unknown.field}}";
      const variables = {
        "product.title": "Chair",
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Product: Chair, Unknown: {{unknown.field}}");
    });

    it("should handle simple variables alongside dot-path", () => {
      const template = "{{action}} the {{product.title}} in {{room}}";
      const variables = {
        action: "Place",
        "product.title": "Sofa",
        room: "living room",
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Place the Sofa in living room");
    });

    it("should return null for null template", () => {
      const result = renderTemplate(null, { key: "value" });
      expect(result).toBeNull();
    });

    it("should handle nested object resolution as fallback", () => {
      const path = "product.details.color";
      const obj = {
        product: {
          details: {
            color: "blue",
          },
        },
      };

      const result = resolveDotPath(obj, path);
      expect(result).toBe("blue");
    });

    it("should prefer flat key over nested path", () => {
      const path = "product.title";
      const obj = {
        "product.title": "Flat Value",
        product: {
          title: "Nested Value",
        },
      };

      const result = resolveDotPath(obj, path);
      expect(result).toBe("Flat Value");
    });

    it("should return undefined for missing paths", () => {
      const result = resolveDotPath({ foo: "bar" }, "missing.path");
      expect(result).toBeUndefined();
    });

    it("should handle deeply nested paths", () => {
      const template = "Color: {{a.b.c.d.e}}";
      const variables = {
        a: {
          b: {
            c: {
              d: {
                e: "red",
              },
            },
          },
        },
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Color: red");
    });
  });

  // ===========================================================================
  // Additional resolver tests
  // ===========================================================================

  describe("Resolution precedence", () => {
    it("should apply params caps from runtime config", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const def = {
        ...createMockDefinition(shopId, promptName, "def-1"),
        versions: [
          {
            ...createMockVersion("def-1", 1, "ACTIVE"),
            params: { max_tokens: 10000 }, // Exceeds cap
          },
        ],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(def);

      const runtimeConfig: RuntimeConfigSnapshot = {
        ...createDefaultRuntimeConfig(),
        caps: {
          maxTokensOutput: 4096, // Lower cap
          maxImageBytes: 20000000,
        },
      };

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        runtimeConfig,
      });

      expect(result.resolved?.params.max_tokens).toBe(4096);
    });

    it("should track overrides applied", async () => {
      const shopId = "shop-1";
      const promptName = "extractor";

      const def = {
        ...createMockDefinition(shopId, promptName, "def-1"),
        versions: [createMockVersion("def-1", 1, "ACTIVE")],
      };

      mockPrisma.promptDefinition.findUnique.mockResolvedValueOnce(def);

      const result = await resolvePrompt({
        shopId,
        promptName,
        variables: { input: "test" },
        override: {
          systemTemplate: "Custom system template",
          model: "custom-model",
        },
        runtimeConfig: createDefaultRuntimeConfig(),
      });

      expect(result.resolved?.source).toBe("override");
      expect(result.resolved?.overridesApplied).toContain("systemTemplate");
      expect(result.resolved?.overridesApplied).toContain("model");
      expect(result.resolved?.overridesApplied).not.toContain("userTemplate");
    });
  });

  describe("Runtime config loading", () => {
    it("should return defaults when no config exists", async () => {
      mockPrisma.shopRuntimeConfig.findUnique.mockResolvedValue(null);

      const config = await loadRuntimeConfig("shop-1");

      expect(config.maxConcurrency).toBe(5);
      expect(config.modelAllowList).toEqual([]);
      expect(config.caps.maxTokensOutput).toBe(8192);
      expect(config.dailyCostCap).toBe(50);
      expect(config.disabledPrompts).toEqual([]);
    });

    it("should load custom config when exists", async () => {
      mockPrisma.shopRuntimeConfig.findUnique.mockResolvedValue({
        shopId: "shop-1",
        maxConcurrency: 10,
        modelAllowList: ["gemini-1.5-flash"],
        maxTokensOutputCap: 2048,
        maxImageBytesCap: 10000000,
        dailyCostCap: 100,
        disabledPromptNames: ["disabled_prompt"],
      });

      const config = await loadRuntimeConfig("shop-1");

      expect(config.maxConcurrency).toBe(10);
      expect(config.modelAllowList).toEqual(["gemini-1.5-flash"]);
      expect(config.caps.maxTokensOutput).toBe(2048);
      expect(config.dailyCostCap).toBe(100);
      expect(config.disabledPrompts).toEqual(["disabled_prompt"]);
    });
  });
});

/**
 * Acceptance Tests for Prompt Control Plane - LLM Call Tracker
 *
 * Tests:
 * - #6: View run's LLM calls
 * - #11: Test panel runs prompt without affecting production
 * - Tracked call wrapper functionality
 * - Request hash computation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// =============================================================================
// Mock Prisma
// =============================================================================

const mockPrisma = {
  lLMCall: {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  },
};

vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

// Import after mocking
import {
  startLLMCall,
  completeLLMCall,
  trackedLLMCall,
  getCallsForRun,
  getCallsForTestRun,
  getPromptCallStats,
  getDailyCostForShop,
} from "~/services/prompt-control/llm-call-tracker.server";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockLLMCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    shopId: "shop-1",
    renderRunId: "run-1",
    variantResultId: null,
    testRunId: null,
    promptName: "extractor",
    promptVersionId: "ver-1",
    model: "gemini-2.5-flash",
    resolutionHash: "res-hash",
    requestHash: "req-hash",
    status: "STARTED",
    startedAt: new Date("2024-01-01T10:00:00Z"),
    finishedAt: null,
    latencyMs: null,
    tokensIn: null,
    tokensOut: null,
    costEstimate: null,
    errorType: null,
    errorMessage: null,
    retryCount: 0,
    providerRequestId: null,
    providerModel: null,
    inputRef: null,
    outputRef: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("LLM Call Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Test #6: View run's LLM calls
  // ===========================================================================

  describe("AC #6: View run's LLM calls", () => {
    it("should retrieve all LLM calls for a render run", async () => {
      const renderRunId = "run-1";
      const mockCalls = [
        createMockLLMCall({ id: "call-1", promptName: "extractor", status: "SUCCEEDED" }),
        createMockLLMCall({
          id: "call-2",
          promptName: "prompt_builder",
          status: "SUCCEEDED",
        }),
        createMockLLMCall({
          id: "call-3",
          promptName: "global_render",
          status: "SUCCEEDED",
        }),
      ];

      mockPrisma.lLMCall.findMany.mockResolvedValue(mockCalls);

      const calls = await getCallsForRun(renderRunId);

      expect(calls).toHaveLength(3);
      expect(mockPrisma.lLMCall.findMany).toHaveBeenCalledWith({
        where: { renderRunId },
        orderBy: { startedAt: "asc" },
      });
    });

    it("should include timing and status for each call", async () => {
      const renderRunId = "run-1";
      const mockCalls = [
        createMockLLMCall({
          id: "call-1",
          status: "SUCCEEDED",
          latencyMs: 1500,
          tokensIn: 1000,
          tokensOut: 500,
          costEstimate: 0.0015,
        }),
        createMockLLMCall({
          id: "call-2",
          status: "FAILED",
          latencyMs: 500,
          errorType: "RateLimitError",
          errorMessage: "Too many requests",
        }),
      ];

      mockPrisma.lLMCall.findMany.mockResolvedValue(mockCalls);

      const calls = await getCallsForRun(renderRunId);

      expect(calls[0].status).toBe("SUCCEEDED");
      expect(calls[0].latencyMs).toBe(1500);
      expect(calls[0].tokensIn).toBe(1000);
      expect(calls[1].status).toBe("FAILED");
      expect(calls[1].errorType).toBe("RateLimitError");
    });

    it("should return calls sorted by startedAt ascending", async () => {
      mockPrisma.lLMCall.findMany.mockResolvedValue([]);

      await getCallsForRun("run-1");

      expect(mockPrisma.lLMCall.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { startedAt: "asc" },
        })
      );
    });
  });

  // ===========================================================================
  // Test #11: Test panel runs prompt without affecting production
  // ===========================================================================

  describe("AC #11: Test panel isolation", () => {
    it("should track test run calls with testRunId instead of renderRunId", async () => {
      mockPrisma.lLMCall.create.mockResolvedValue(
        createMockLLMCall({ testRunId: "test-1", renderRunId: null })
      );

      const callId = await startLLMCall({
        shopId: "shop-1",
        testRunId: "test-1", // Test run, not production
        promptName: "extractor",
        promptVersionId: "ver-1",
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Test prompt" }],
        params: {},
        imageRefs: [],
        resolutionHash: "res-hash",
      });

      expect(mockPrisma.lLMCall.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          testRunId: "test-1",
          renderRunId: null,
        }),
      });
    });

    it("should retrieve calls for test run separately", async () => {
      const testRunId = "test-1";
      const mockCalls = [
        createMockLLMCall({ testRunId: "test-1", renderRunId: null }),
      ];

      mockPrisma.lLMCall.findMany.mockResolvedValue(mockCalls);

      const calls = await getCallsForTestRun(testRunId);

      expect(mockPrisma.lLMCall.findMany).toHaveBeenCalledWith({
        where: { testRunId },
        orderBy: { startedAt: "asc" },
      });
    });

    it("should not mix test calls with production calls", async () => {
      // Production calls
      const productionCalls = [
        createMockLLMCall({ id: "prod-1", renderRunId: "run-1", testRunId: null }),
        createMockLLMCall({ id: "prod-2", renderRunId: "run-1", testRunId: null }),
      ];

      // Test calls
      const testCalls = [
        createMockLLMCall({ id: "test-1", renderRunId: null, testRunId: "test-1" }),
      ];

      // When querying production run, should only get production calls
      mockPrisma.lLMCall.findMany.mockResolvedValue(productionCalls);
      const runCalls = await getCallsForRun("run-1");
      expect(runCalls).toHaveLength(2);
      expect(runCalls.every((c) => c.testRunId === null)).toBe(true);

      // When querying test run, should only get test calls
      mockPrisma.lLMCall.findMany.mockResolvedValue(testCalls);
      const testRunCalls = await getCallsForTestRun("test-1");
      expect(testRunCalls).toHaveLength(1);
      expect(testRunCalls.every((c) => c.renderRunId === null)).toBe(true);
    });
  });

  // ===========================================================================
  // Tracked call wrapper tests
  // ===========================================================================

  describe("trackedLLMCall wrapper", () => {
    it("should start call, execute, and complete on success", async () => {
      const mockCall = createMockLLMCall();
      mockPrisma.lLMCall.create.mockResolvedValue(mockCall);
      mockPrisma.lLMCall.findUnique.mockResolvedValue({ startedAt: new Date() });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      const result = await trackedLLMCall(
        {
          shopId: "shop-1",
          renderRunId: "run-1",
          promptName: "extractor",
          promptVersionId: "ver-1",
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "test" }],
          params: {},
          imageRefs: [],
          resolutionHash: "res-hash",
        },
        async () => ({
          result: { extracted: "data" },
          usage: { tokensIn: 100, tokensOut: 50, cost: 0.001 },
          providerRequestId: "prov-123",
          providerModel: "gemini-2.5-flash-001",
          outputPreview: "{ extracted: data }",
        })
      );

      expect(result).toEqual({ extracted: "data" });
      expect(mockPrisma.lLMCall.create).toHaveBeenCalled();
      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "SUCCEEDED",
            tokensIn: 100,
            tokensOut: 50,
          }),
        })
      );
    });

    it("should mark as FAILED when executor throws error", async () => {
      const mockCall = createMockLLMCall();
      mockPrisma.lLMCall.create.mockResolvedValue(mockCall);
      mockPrisma.lLMCall.findUnique.mockResolvedValue({ startedAt: new Date() });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      await expect(
        trackedLLMCall(
          {
            shopId: "shop-1",
            renderRunId: "run-1",
            promptName: "extractor",
            promptVersionId: "ver-1",
            model: "gemini-2.5-flash",
            messages: [],
            params: {},
            imageRefs: [],
            resolutionHash: "res-hash",
          },
          async () => {
            throw new Error("API error");
          }
        )
      ).rejects.toThrow("API error");

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
            errorType: "Error",
            errorMessage: "API error",
          }),
        })
      );
    });

    it("should mark as TIMEOUT when error indicates timeout", async () => {
      const mockCall = createMockLLMCall();
      mockPrisma.lLMCall.create.mockResolvedValue(mockCall);
      mockPrisma.lLMCall.findUnique.mockResolvedValue({ startedAt: new Date() });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      await expect(
        trackedLLMCall(
          {
            shopId: "shop-1",
            renderRunId: "run-1",
            promptName: "extractor",
            promptVersionId: "ver-1",
            model: "gemini-2.5-flash",
            messages: [],
            params: {},
            imageRefs: [],
            resolutionHash: "res-hash",
          },
          async () => {
            throw new Error("Request timeout exceeded");
          }
        )
      ).rejects.toThrow("timeout");

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "TIMEOUT",
          }),
        })
      );
    });

    it("should mark as TIMEOUT for AbortError", async () => {
      const mockCall = createMockLLMCall();
      mockPrisma.lLMCall.create.mockResolvedValue(mockCall);
      mockPrisma.lLMCall.findUnique.mockResolvedValue({ startedAt: new Date() });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      const abortError = new Error("Aborted");
      abortError.name = "AbortError";

      await expect(
        trackedLLMCall(
          {
            shopId: "shop-1",
            renderRunId: "run-1",
            promptName: "extractor",
            promptVersionId: "ver-1",
            model: "gemini-2.5-flash",
            messages: [],
            params: {},
            imageRefs: [],
            resolutionHash: "res-hash",
          },
          async () => {
            throw abortError;
          }
        )
      ).rejects.toThrow();

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "TIMEOUT",
          }),
        })
      );
    });
  });

  // ===========================================================================
  // Start and complete call tests
  // ===========================================================================

  describe("startLLMCall", () => {
    it("should create call with correct input ref structure", async () => {
      const mockCall = createMockLLMCall();
      mockPrisma.lLMCall.create.mockResolvedValue(mockCall);

      await startLLMCall({
        shopId: "shop-1",
        renderRunId: "run-1",
        promptName: "extractor",
        promptVersionId: "ver-1",
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Analyze this" },
        ],
        params: { temperature: 0.7 },
        imageRefs: ["img1.png", "img2.png"],
        resolutionHash: "res-hash",
      });

      expect(mockPrisma.lLMCall.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inputRef: expect.objectContaining({
            messageCount: 2,
            imageCount: 2,
            resolutionHash: "res-hash",
          }),
          status: "STARTED",
        }),
      });
    });

    it("should truncate preview to 500 chars", async () => {
      const mockCall = createMockLLMCall();
      mockPrisma.lLMCall.create.mockResolvedValue(mockCall);

      const longContent = "x".repeat(1000);
      await startLLMCall({
        shopId: "shop-1",
        promptName: "extractor",
        promptVersionId: "ver-1",
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: longContent }],
        params: {},
        imageRefs: [],
        resolutionHash: "res-hash",
      });

      const createCall = mockPrisma.lLMCall.create.mock.calls[0][0];
      expect(createCall.data.inputRef.preview.length).toBe(500);
    });
  });

  describe("completeLLMCall", () => {
    it("should calculate latency from start time", async () => {
      const startTime = new Date("2024-01-01T10:00:00Z");
      mockPrisma.lLMCall.findUnique.mockResolvedValue({ startedAt: startTime });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      vi.setSystemTime(new Date("2024-01-01T10:00:02Z")); // 2 seconds later

      await completeLLMCall({
        callId: "call-1",
        status: "SUCCEEDED",
        tokensIn: 100,
        tokensOut: 50,
      });

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            latencyMs: 2000, // 2 seconds
          }),
        })
      );
    });

    it("should truncate error message to 1000 chars", async () => {
      mockPrisma.lLMCall.findUnique.mockResolvedValue({ startedAt: new Date() });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      const longError = "e".repeat(2000);
      await completeLLMCall({
        callId: "call-1",
        status: "FAILED",
        errorMessage: longError,
      });

      const updateCall = mockPrisma.lLMCall.update.mock.calls[0][0];
      expect(updateCall.data.errorMessage.length).toBe(1000);
    });

    it("should build output ref with preview and length", async () => {
      mockPrisma.lLMCall.findUnique.mockResolvedValue({ startedAt: new Date() });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      const outputText = "Generated output text here";
      await completeLLMCall({
        callId: "call-1",
        status: "SUCCEEDED",
        outputPreview: outputText,
      });

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            outputRef: {
              preview: outputText,
              length: outputText.length,
            },
          }),
        })
      );
    });
  });

  // ===========================================================================
  // Stats and aggregation tests
  // ===========================================================================

  describe("getPromptCallStats", () => {
    it("should calculate success rate correctly", async () => {
      mockPrisma.lLMCall.groupBy.mockResolvedValue([
        { status: "SUCCEEDED", _count: { id: 80 } },
        { status: "FAILED", _count: { id: 15 } },
        { status: "TIMEOUT", _count: { id: 5 } },
      ]);
      mockPrisma.lLMCall.findMany.mockResolvedValue([]);
      mockPrisma.lLMCall.aggregate.mockResolvedValue({ _avg: { costEstimate: null } });

      const stats = await getPromptCallStats(
        "shop-1",
        "extractor",
        new Date("2024-01-01")
      );

      expect(stats.totalCalls).toBe(100);
      expect(stats.successRate).toBe(80);
    });

    it("should calculate latency percentiles", async () => {
      mockPrisma.lLMCall.groupBy.mockResolvedValue([
        { status: "SUCCEEDED", _count: { id: 100 } },
      ]);

      // Create sorted latency data
      const latencies = Array.from({ length: 100 }, (_, i) => ({
        latencyMs: (i + 1) * 10, // 10, 20, 30, ... 1000
      }));
      mockPrisma.lLMCall.findMany.mockResolvedValue(latencies);
      mockPrisma.lLMCall.aggregate.mockResolvedValue({ _avg: { costEstimate: 0.001 } });

      const stats = await getPromptCallStats(
        "shop-1",
        "extractor",
        new Date("2024-01-01")
      );

      expect(stats.latencyP50).toBe(510); // 51st element (index 50)
      expect(stats.latencyP95).toBe(950); // 95th element (index 95)
    });

    it("should handle no calls gracefully", async () => {
      mockPrisma.lLMCall.groupBy.mockResolvedValue([]);
      mockPrisma.lLMCall.findMany.mockResolvedValue([]);
      mockPrisma.lLMCall.aggregate.mockResolvedValue({ _avg: { costEstimate: null } });

      const stats = await getPromptCallStats(
        "shop-1",
        "extractor",
        new Date("2024-01-01")
      );

      expect(stats.totalCalls).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.latencyP50).toBeNull();
      expect(stats.latencyP95).toBeNull();
      expect(stats.avgCost).toBeNull();
    });
  });

  describe("getDailyCostForShop", () => {
    it("should sum costs for today's successful calls", async () => {
      mockPrisma.lLMCall.aggregate.mockResolvedValue({
        _sum: { costEstimate: 5.5 },
      });

      const cost = await getDailyCostForShop("shop-1");

      expect(cost).toBe(5.5);
      expect(mockPrisma.lLMCall.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shopId: "shop-1",
            status: "SUCCEEDED",
          }),
        })
      );
    });

    it("should return 0 when no costs", async () => {
      mockPrisma.lLMCall.aggregate.mockResolvedValue({
        _sum: { costEstimate: null },
      });

      const cost = await getDailyCostForShop("shop-1");

      expect(cost).toBe(0);
    });
  });
});

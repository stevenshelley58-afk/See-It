/**
 * Prompt Control Plane - LLM Call Tracker (Canonical)
 *
 * This test suite validates the canonical `llm_calls` writer helpers.
 * It is intentionally aligned with the current schema (ownerType/ownerId, promptKey, etc).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Mock Prisma
// =============================================================================

const mockPrisma = vi.hoisted(() => ({
  lLMCall: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    aggregate: vi.fn(),
  },
}));

vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

// Import after mocking
import {
  startCall,
  completeCallSuccess,
  completeCallFailure,
  trackedCall,
  getCallsForRun,
  getCallsForTestRun,
  findCachedByDedupeHash,
  getDailyCostForShop,
  type StartCallInput,
} from "~/services/prompt-control/llm-call-tracker.server";

function makeStartInput(
  overrides: Partial<StartCallInput> = {}
): StartCallInput {
  return {
    shopId: "shop-1",
    ownerType: "COMPOSITE_RUN",
    ownerId: "run-1",
    variantId: "V01",
    promptName: "product_fact_extractor",
    promptVersionId: "ver-1",
    callIdentityHash: "identity-hash-1",
    dedupeHash: "dedupe-hash-1",
    callSummary: {
      promptName: "product_fact_extractor",
      model: "gemini-2.5-flash-image",
      imageCount: 1,
      promptPreview: "preview",
    },
    debugPayload: {
      promptText: "prompt text",
      model: "gemini-2.5-flash-image",
      params: { responseModalities: ["TEXT"] },
      images: [],
      aspectRatioSource: "UNKNOWN",
    },
    ...overrides,
  };
}

describe("LLM Call Tracker (canonical)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("startCall()", () => {
    it("creates an LLMCall row and returns call id", async () => {
      mockPrisma.lLMCall.create.mockResolvedValue({ id: "call-1" });

      const callId = await startCall(makeStartInput());

      expect(callId).toBe("call-1");
      expect(mockPrisma.lLMCall.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: "shop-1",
          ownerType: "COMPOSITE_RUN",
          ownerId: "run-1",
          variantId: "V01",
          promptKey: "product_fact_extractor",
          promptVersionId: "ver-1",
          callIdentityHash: "identity-hash-1",
          dedupeHash: "dedupe-hash-1",
          status: "STARTED",
        }),
      });
    });

    it("throws if ownerId is missing", async () => {
      await expect(
        startCall(makeStartInput({ ownerId: "" }))
      ).rejects.toThrow("ownerId is required");
    });

    it("throws if callIdentityHash is missing", async () => {
      await expect(
        startCall(makeStartInput({ callIdentityHash: "" }))
      ).rejects.toThrow("callIdentityHash is required");
    });
  });

  describe("completeCallSuccess() / completeCallFailure()", () => {
    it("marks call as SUCCEEDED with output summary", async () => {
      mockPrisma.lLMCall.update.mockResolvedValue({});

      await completeCallSuccess({
        callId: "call-1",
        tokensIn: 100,
        tokensOut: 50,
        costEstimate: 0.001,
        latencyMs: 1234,
        providerModel: "gemini-2.5-flash-image",
        providerRequestId: "prov-1",
        outputSummary: { finishReason: "STOP", providerRequestId: "prov-1" },
      });

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith({
        where: { id: "call-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          latencyMs: 1234,
          tokensIn: 100,
          tokensOut: 50,
          providerRequestId: "prov-1",
        }),
      });
    });

    it("marks call as FAILED and truncates long error messages", async () => {
      mockPrisma.lLMCall.update.mockResolvedValue({});

      const longMessage = "e".repeat(2000);
      await completeCallFailure({
        callId: "call-1",
        latencyMs: 50,
        errorType: "Error",
        errorMessage: longMessage,
        status: "FAILED",
      });

      const updateArg = mockPrisma.lLMCall.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: "call-1" });
      expect(updateArg.data.status).toBe("FAILED");
      expect(updateArg.data.errorMessage.length).toBeLessThanOrEqual(1000);
    });
  });

  describe("trackedCall()", () => {
    it("starts and completes call on success", async () => {
      mockPrisma.lLMCall.create.mockResolvedValue({ id: "call-1" });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      const { result, callId } = await trackedCall(makeStartInput(), async () => {
        vi.setSystemTime(new Date("2024-01-01T10:00:02Z"));
        return {
          result: { ok: true },
          tokensIn: 100,
          tokensOut: 50,
          costEstimate: 0.001,
          providerModel: "gemini-2.5-flash-image",
          providerRequestId: "prov-1",
          outputSummary: { finishReason: "STOP", providerRequestId: "prov-1" },
        };
      });

      expect(callId).toBe("call-1");
      expect(result).toEqual({ ok: true });

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith({
        where: { id: "call-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          latencyMs: 2000,
          tokensIn: 100,
          tokensOut: 50,
        }),
      });
    });

    it("marks TIMEOUT when executor error indicates timeout", async () => {
      mockPrisma.lLMCall.create.mockResolvedValue({ id: "call-1" });
      mockPrisma.lLMCall.update.mockResolvedValue({});

      await expect(
        trackedCall(makeStartInput(), async () => {
          vi.setSystemTime(new Date("2024-01-01T10:00:01Z"));
          throw new Error("Request timeout exceeded");
        })
      ).rejects.toThrow(/timeout/i);

      expect(mockPrisma.lLMCall.update).toHaveBeenCalledWith({
        where: { id: "call-1" },
        data: expect.objectContaining({
          status: "TIMEOUT",
        }),
      });
    });
  });

  describe("query helpers", () => {
    it("getCallsForRun() queries by ownerType/ownerId", async () => {
      mockPrisma.lLMCall.findMany.mockResolvedValue([]);

      await getCallsForRun("run-1");

      expect(mockPrisma.lLMCall.findMany).toHaveBeenCalledWith({
        where: { ownerType: "COMPOSITE_RUN", ownerId: "run-1" },
        orderBy: { startedAt: "asc" },
      });
    });

    it("getCallsForTestRun() queries by ownerType/ownerId", async () => {
      mockPrisma.lLMCall.findMany.mockResolvedValue([]);

      await getCallsForTestRun("test-1");

      expect(mockPrisma.lLMCall.findMany).toHaveBeenCalledWith({
        where: { ownerType: "TEST_RUN", ownerId: "test-1" },
        orderBy: { startedAt: "asc" },
      });
    });

    it("findCachedByDedupeHash() returns null when no cached output", async () => {
      mockPrisma.lLMCall.findFirst.mockResolvedValue(null);
      const cached = await findCachedByDedupeHash("shop-1", "dedupe-hash");
      expect(cached).toBeNull();
    });

    it("findCachedByDedupeHash() returns call id + output summary", async () => {
      mockPrisma.lLMCall.findFirst.mockResolvedValue({
        id: "call-99",
        outputSummary: { finishReason: "STOP" },
      });

      const cached = await findCachedByDedupeHash("shop-1", "dedupe-hash");

      expect(cached).toEqual({
        callId: "call-99",
        outputSummary: { finishReason: "STOP" },
      });
    });

    it("getDailyCostForShop() aggregates successful cost", async () => {
      mockPrisma.lLMCall.aggregate.mockResolvedValue({
        _sum: { costEstimate: 5.5 },
      });

      const cost = await getDailyCostForShop("shop-1");

      expect(cost).toBe(5.5);
    });
  });
});


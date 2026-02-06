import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  monitorEvent: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const storeArtifactMock = vi.hoisted(() => vi.fn());

vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

vi.mock("~/services/telemetry/artifacts.server", () => ({
  storeArtifact: storeArtifactMock,
}));

import { emitAsync } from "~/services/telemetry/emitter.server";
import { RetentionClass, Severity } from "~/services/telemetry/constants";

describe("Telemetry Emitter - overflow artifacts", () => {
  beforeEach(() => {
    mockPrisma.monitorEvent.create.mockReset();
    mockPrisma.monitorEvent.update.mockReset();
    storeArtifactMock.mockReset();
  });

  it("does not create overflow artifact for small payloads", async () => {
    mockPrisma.monitorEvent.create.mockResolvedValue({
      id: "evt_1",
      ts: new Date("2026-02-01T00:00:00Z"),
      shopId: "shop_1",
      requestId: "req_1",
      runId: null,
      variantId: null,
      traceId: null,
      spanId: null,
      parentSpanId: null,
      source: "admin_app",
      type: "test.event",
      severity: Severity.INFO,
      schemaVersion: 1,
    });

    const ok = await emitAsync({
      shopId: "shop_1",
      requestId: "req_1",
      source: "admin_app",
      type: "test.event",
      payload: { token: "secret", ok: true },
    });

    expect(ok).toBe(true);
    expect(storeArtifactMock).not.toHaveBeenCalled();
    expect(mockPrisma.monitorEvent.update).not.toHaveBeenCalled();

    expect(mockPrisma.monitorEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            token: "[REDACTED]",
            ok: true,
          }),
        }),
      })
    );
  });

  it("stores full scrubbed payload as artifact and links overflowArtifactId when too large", async () => {
    mockPrisma.monitorEvent.create.mockResolvedValue({
      id: "evt_big",
      ts: new Date("2026-02-01T00:00:00Z"),
      shopId: "shop_1",
      requestId: "req_big",
      runId: "run_1",
      variantId: "v1",
      traceId: "trace_1",
      spanId: "span_1",
      parentSpanId: null,
      source: "provider",
      type: "provider.response",
      severity: Severity.INFO,
      schemaVersion: 1,
    });

    storeArtifactMock.mockResolvedValue("art_1");

    const huge = "x".repeat(20000);
    const ok = await emitAsync({
      shopId: "shop_1",
      requestId: "req_big",
      runId: "run_1",
      variantId: "v1",
      traceId: "trace_1",
      spanId: "span_1",
      source: "provider",
      type: "provider.response",
      payload: {
        authorization: "Bearer SECRET",
        huge,
      },
    });

    expect(ok).toBe(true);

    // Event stored with a small preview payload
    expect(mockPrisma.monitorEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            __truncated: true,
            __preview: expect.any(Object),
          }),
        }),
      })
    );

    // Artifact stored with full scrubbed payload
    expect(storeArtifactMock).toHaveBeenCalledTimes(1);
    const artifactInput = storeArtifactMock.mock.calls[0]?.[0];
    expect(artifactInput).toEqual(
      expect.objectContaining({
        shopId: "shop_1",
        requestId: "req_big",
        runId: "run_1",
        variantId: "v1",
        type: "monitor_event_payload_overflow",
        contentType: "application/json",
        retentionClass: RetentionClass.SENSITIVE,
        meta: expect.objectContaining({
          eventId: "evt_big",
        }),
      })
    );

    const artifactBody = JSON.parse(artifactInput.buffer.toString("utf8"));
    expect(artifactBody.event.id).toBe("evt_big");
    expect(artifactBody.payload.authorization).toBe("[REDACTED]");
    expect(artifactBody.payload.huge.length).toBe(20000);

    // Event linked to artifact
    expect(mockPrisma.monitorEvent.update).toHaveBeenCalledWith({
      where: { id: "evt_big" },
      data: { overflowArtifactId: "art_1" },
    });
  });
});


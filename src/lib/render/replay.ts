import { repository } from "@/lib/db/repository";
import { createRenderRequest } from "@/lib/render/orchestrator";
import { traceRender } from "@/lib/render/trace";

export function createReplay(sourceRenderRequestId: string, overrides: { modelKey?: string; promptVersionId?: string } = {}) {
  const source = repository.mustGet(repository.renderRequests, sourceRenderRequestId, "render_request");
  if (source.roomSessionId) {
    const replay = createRenderRequest({
      roomSessionId: source.roomSessionId,
      tap: { x: source.tapX ?? 0.5, y: source.tapY ?? 0.5 },
      kind: "replay",
      sourceRenderRequestId: source.id,
      hintText: JSON.stringify(overrides)
    });
    traceRender(source.traceId, "replay_created", { replayRenderRequestId: replay.id, overrides }, source.id);
    return replay;
  }
  throw new Error("Replay requires retained source assets");
}

export function buildReplayPayload(sourceRenderRequestId: string) {
  const bundle = repository.renderBundleForRequest(sourceRenderRequestId);
  return {
    sourceRenderRequestId,
    traceId: bundle.request.traceId,
    assets: bundle.assets.map((asset) => ({ role: asset.role, storageKey: asset.storageKey, available: Boolean(asset.retentionExpiresAt ? new Date(asset.retentionExpiresAt).getTime() > Date.now() : true) })),
    promptSnapshots: bundle.invocations.map((invocation) => ({ promptVersionId: invocation.promptVersionId, resolvedUserPrompt: invocation.resolvedUserPrompt })),
    modelSnapshots: bundle.invocations.map((invocation) => ({ providerId: invocation.providerId, aiModelId: invocation.aiModelId }))
  };
}

import { createRenderRequest, runRenderPipeline } from "@/lib/render/orchestrator";
import { buildReplayPayload, createReplay } from "@/lib/render/replay";
import { createSmokeRoom } from "./smoke-utils";

const { room } = await createSmokeRoom("replay-smoke.myshopify.com");
const source = createRenderRequest({ roomSessionId: room.id, tap: { x: 0.36, y: 0.71 }, kind: "shopper" });
await runRenderPipeline(source.id);
const replay = createReplay(source.id, { modelKey: "gpt-image-2" });
const replayBundle = await runRenderPipeline(replay.id);
const payload = buildReplayPayload(source.id);
if (replayBundle.request.status !== "done") {
  throw new Error("Replay smoke failed: " + replayBundle.request.finalErrorCode);
}
console.log(JSON.stringify({
  sourceRenderRequestId: source.id,
  replayRenderRequestId: replay.id,
  status: replayBundle.request.status,
  retainedAssets: payload.assets.length,
  promptSnapshots: payload.promptSnapshots.length
}, null, 2));

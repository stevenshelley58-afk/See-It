import { createRenderRequest, runRenderPipeline } from "@/lib/render/orchestrator";
import { createSmokeRoom } from "./smoke-utils";

const { room } = await createSmokeRoom("render-smoke.myshopify.com");
const render = createRenderRequest({ roomSessionId: room.id, tap: { x: 0.42, y: 0.68 }, kind: "shopper" });
const bundle = await runRenderPipeline(render.id);
if (bundle.request.status !== "done") {
  throw new Error("Render smoke failed: " + bundle.request.finalErrorCode);
}
console.log(JSON.stringify({
  renderId: bundle.request.id,
  status: bundle.request.status,
  attempts: bundle.attempts.length,
  assets: bundle.assets.length,
  traceEvents: bundle.trace.length
}, null, 2));

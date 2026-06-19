import { enqueueJob } from "@/lib/jobs/queue";
import { runLeasedJob } from "@/lib/jobs/worker";
import { createSmokeRoom } from "./smoke-utils";

const { shop } = await createSmokeRoom("demo-batch.myshopify.com");
const job = enqueueJob("demo_generate", { shopId: shop.id, period: "smoke" }, "demo_generate:smoke:" + shop.id, 90, 3);
const result = await runLeasedJob(job.id);
if (!["succeeded", "queued"].includes(result.status)) {
  throw new Error("Demo batch smoke failed: " + result.status);
}
console.log(JSON.stringify({ jobId: result.id, status: result.status, type: result.type }, null, 2));

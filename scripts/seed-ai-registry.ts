import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { recordDemoGenerated } from "@/lib/growth/demo";

ensureAiRegistrySeeded();
console.log("seed-ai-registry ready", recordDemoGenerated("demo.myshopify.com").slug);

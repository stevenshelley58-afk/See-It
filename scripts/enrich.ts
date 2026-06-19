import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { recordDemoGenerated } from "@/lib/growth/demo";

ensureAiRegistrySeeded();
console.log("enrich ready", recordDemoGenerated("demo.myshopify.com").slug);

import { existsSync, readFileSync, statSync } from "node:fs";
import { globSync } from "node:fs";

const required = [
  "BUILD-SPEC.md",
  "AGENTS.md",
  "supabase/migrations/20260619120000_initial.sql",
  "supabase/migrations/20260620023500_complete_runtime_schema.sql",
  "src/lib/ai/router.ts",
  "extension/assets/widget.js",
  "scripts/db-verify.ts",
  "scripts/script-env.ts"
];
for (const file of required) {
  if (!existsSync(file)) {
    throw new Error("Missing required file: " + file);
  }
}

function read(file: string) {
  return readFileSync(file, "utf8");
}

function assertContains(file: string, needle: string, message: string) {
  if (!read(file).includes(needle)) {
    throw new Error(message + ": " + file);
  }
}

const srcFiles = globSync("src/**/*.{ts,tsx}");
for (const file of srcFiles) {
  if (file.replace(/\\/g, "/") !== "src/lib/env.ts") {
    const text = read(file);
    if (text.includes("process.env")) {
      throw new Error("process.env outside src/lib/env.ts: " + file);
    }
  }
}

const widgetBytes = statSync("extension/assets/widget.js").size;
if (widgetBytes > 30 * 1024) {
  throw new Error("Widget initial JS over 30KB: " + widgetBytes);
}

for (const file of globSync("src/app/app-proxy/**/route.ts")) {
  assertContains(file, "authenticateDurableAppProxyRequest", "App proxy route missing durable Shopify HMAC auth");
  assertContains(file, "enforceAppProxyRateLimit", "App proxy route missing shop/IP/session rate limit");
}

for (const file of [...globSync("src/app/api/cron/**/route.ts"), "src/app/api/jobs/sweep/route.ts"]) {
  assertContains(file, "authenticateServiceRequest", "Cron/job route missing service auth");
}

for (const file of globSync("src/app/api/webhooks/**/route.ts")) {
  assertContains(file, "verifyShopifyWebhookRequest", "Shopify webhook route missing HMAC verification");
}
assertContains("src/app/api/webhooks/route.ts", "verifyShopifyWebhookRequest", "Root Shopify webhook route missing HMAC verification");

for (const file of globSync("src/app/api/merchant/**/route.ts")) {
  assertContains(file, "authenticateMerchantRequest", "Merchant API route missing embedded session auth");
}

for (const file of globSync("src/app/api/auth/**/route.ts")) {
  const text = read(file);
  if (text.includes("local-shopify-secret") || text.includes("local-api-key") || text.includes("local-encryption-key")) {
    throw new Error("Shopify auth route contains hard-coded local secret: " + file);
  }
}

assertContains("src/proxy.ts", "export async function proxy", "Founder proxy convention missing");
assertContains("src/proxy.ts", "matcher: [\"/founder/:path*\", \"/api/founder/:path*\"]", "Founder proxy matcher missing");
assertContains("src/proxy.ts", "isFounderSessionTokenValid", "Founder proxy missing session auth");

const founderAiRoute = read("src/app/api/founder/ai/[...segments]/route.ts");
if (founderAiRoute.includes("return NextResponse.json({ ok: true")) {
  throw new Error("Founder AI route still contains placeholder ok response");
}

for (const file of globSync("src/app/api/founder/**/route.ts")) {
  const text = read(file);
  if (/action:\s*["'][^"']+["'],\s*ok:\s*true/.test(text) || /status:\s*["']completed["']\s*}\)/.test(text)) {
    throw new Error("Founder route contains placeholder success response: " + file);
  }
}

for (const file of globSync("scripts/*.ts")) {
  const text = read(file);
  if (/console\.log\(["'][^"']+ ready/.test(text) || text.includes("recordDemoGenerated(\"demo.myshopify.com\")")) {
    throw new Error("Release script still contains readiness stub: " + file);
  }
}

const storage = read("src/lib/storage/signed-upload.ts");
for (const requiredSnippet of ["createSupabaseServiceClient", "createSignedUploadUrl", "createSignedUrl"]) {
  if (!storage.includes(requiredSnippet)) {
    throw new Error("Storage helper missing Supabase signed URL support: " + requiredSnippet);
  }
}
const generatedStorage = read("src/lib/storage/generated-assets.ts");
for (const requiredSnippet of ["uploadGeneratedBase64Asset", ".storage.from(bucket).upload"]) {
  if (!generatedStorage.includes(requiredSnippet)) {
    throw new Error("Generated asset storage helper missing Supabase upload support: " + requiredSnippet);
  }
}
assertContains("src/lib/env.ts", "readSupabaseEnv", "Supabase runtime env alias helper missing");
assertContains("src/lib/db/supabase-persistence.ts", "readSupabaseEnv", "Persistence layer missing minimal Supabase env fallback");
const dbVerify = read("scripts/db-verify.ts");
for (const requiredSnippet of ["SUPABASE_SERVICE_ROLE_KEY", "createClient", "Supabase runtime schema verified", "--require-seed", "prompt_deployment", "readdirSync", ".select(\"*\").limit(1)"]) {
  if (!dbVerify.includes(requiredSnippet)) {
    throw new Error("Runtime database verifier missing required behavior: " + requiredSnippet);
  }
}
assertContains("scripts/seed-ai-registry.ts", "loadScriptEnv", "AI seed script must load local env files before persistence");
assertContains("package.json", "db:verify:seeded", "Seeded runtime DB verification script missing");
const persistence = read("src/lib/db/supabase-persistence.ts");
for (const requiredSnippet of ["persistRenderBundle", "persistRecord", "createSupabaseServiceClient", "loadShopByDomain", "loadQueueableJobs", "hydrateRenderPipelineInputs"]) {
  if (!persistence.includes(requiredSnippet)) {
    throw new Error("Supabase persistence adapter missing required behavior: " + requiredSnippet);
  }
}
for (const requiredSnippet of ["persistManualReview", "persistEvalDataset", "persistEvalCase", "persistEvalRun", "persistEvalResult", "persistExperiment", "persistExperimentArm", "persistExperimentAssignment"]) {
  if (!persistence.includes(requiredSnippet)) {
    throw new Error("Founder record persistence helper missing: " + requiredSnippet);
  }
}
for (const requiredSnippet of ["loadAiControlPlane", "persistAiControlPlane", "persistAiModel", "loadFounderRenderRequests", "loadRenderBundle", "loadEvalOverview", "loadExperimentOverview", "loadManualReviews", "loadAuditLogs", "persistAiInvocation", "params_json"]) {
  if (!persistence.includes(requiredSnippet)) {
    throw new Error("Founder durable loader/control-plane helper missing: " + requiredSnippet);
  }
}
const migration = globSync("supabase/migrations/*.sql").map(read).join("\n");
for (const requiredSnippet of ["verified boolean default false", "width integer", "height integer", "remaining_refinements integer default 3"]) {
  if (!migration.includes(requiredSnippet)) {
    throw new Error("Initial migration missing runtime persistence column: " + requiredSnippet);
  }
}
for (const [file, requiredSnippet] of [["src/lib/render/orchestrator.ts", "persistRenderBundle"], ["src/lib/jobs/queue.ts", "enqueueDurableJob"], ["src/lib/jobs/worker.ts", "persistJob"]] as const) {
  if (!read(file).includes(requiredSnippet)) {
    throw new Error("Critical path missing persistence hook: " + file + " " + requiredSnippet);
  }
}
for (const [file, requiredSnippet] of [
  ["src/app/api/merchant/lifestyle/route.ts", "consumeLifestyleStarted"],
  ["src/app/api/merchant/lifestyle/route.ts", "enqueueDurableJob"],
  ["src/app/api/merchant/lifestyle/route.ts", "persistShop"],
  ["src/app/app-proxy/renders/route.ts", "createDurableRenderRequest"],
  ["src/app/app-proxy/renders/[renderId]/refine/route.ts", "createDurableRenderRequest"],
  ["src/app/api/founder/renders/[id]/replay/route.ts", "createDurableReplay"],
  ["src/lib/render/orchestrator.ts", "persistShop"],
  ["src/lib/render/orchestrator.ts", "hydrateRenderPipelineInputs"],
  ["src/lib/jobs/worker.ts", "loadQueueableJobs"],
  ["src/lib/shopify/session.ts", "loadShopByDomain"],
  ["src/lib/shopify/app-proxy.ts", "loadShopByDomain"],
  ["src/lib/shopify/webhooks.ts", "handleDurableUninstall"],
  ["src/lib/shopify/webhooks.ts", "handleDurablePrivacyWebhook"],
  ["src/app/api/founder/renders/[id]/manual-review/route.ts", "persistManualReview"],
  ["src/app/api/founder/renders/[id]/manual-review/route.ts", "loadRenderRequestById"],
  ["src/app/api/founder/renders/[id]/promote-to-fixture/route.ts", "persistEvalCase"],
  ["src/app/api/founder/renders/[id]/promote-to-fixture/route.ts", "loadRenderBundle"],
  ["src/app/api/founder/evals/run/route.ts", "persistEvalResult"],
  ["src/app/api/founder/evals/route.ts", "loadEvalOverview"],
  ["src/app/api/founder/evals/[id]/route.ts", "loadEvalRunBundle"],
  ["src/app/api/founder/renders/route.ts", "loadFounderRenderRequests"],
  ["src/app/api/founder/renders/[id]/route.ts", "loadRenderBundle"],
  ["src/app/api/founder/experiments/route.ts", "persistExperimentArm"],
  ["src/app/api/founder/experiments/route.ts", "loadExperimentOverview"],
  ["src/app/api/founder/experiments/[id]/route.ts", "persistExperiment"],
  ["src/app/api/founder/experiments/[id]/route.ts", "loadExperimentById"],
  ["src/app/api/founder/experiments/[id]/pause/route.ts", "persistExperiment"],
  ["src/app/api/founder/experiments/[id]/pause/route.ts", "loadExperimentById"],
  ["src/app/api/founder/experiments/[id]/promote-winner/route.ts", "persistExperimentArm"],
  ["src/app/api/founder/experiments/[id]/promote-winner/route.ts", "loadExperimentById"]
] as const) {
  if (!read(file).includes(requiredSnippet)) {
    throw new Error("Launch-critical durable/quota hook missing: " + file + " " + requiredSnippet);
  }
}

for (const [file, requiredSnippet] of [
  ["src/app/api/founder/ai/[...segments]/route.ts", "loadAiControlPlane"],
  ["src/app/api/founder/ai/[...segments]/route.ts", "persistAiControlPlane"],
  ["src/app/api/founder/ai/[...segments]/route.ts", "persistAuditLogs"],
  ["src/lib/ai/router.ts", "persistAiInvocation"],
  ["src/lib/render/replay.ts", "loadRenderRequestById"],
  ["src/app/founder/renders/page.tsx", "loadFounderRenderRequests"],
  ["src/app/founder/renders/[renderId]/page.tsx", "loadRenderBundle"],
  ["src/app/founder/ai/prompts/page.tsx", "loadAiControlPlane"],
  ["src/app/founder/ai/costs/page.tsx", "loadAiInvocations"],
  ["src/app/founder/quality/page.tsx", "loadManualReviews"],
  ["src/app/founder/evals/page.tsx", "loadEvalOverview"],
  ["src/app/founder/experiments/page.tsx", "loadExperimentOverview"],
  ["scripts/seed-ai-registry.ts", "persistAiControlPlane"]
] as const) {
  if (!read(file).includes(requiredSnippet)) {
    throw new Error("Founder durable UI/API hook missing: " + file + " " + requiredSnippet);
  }
}

for (const file of globSync("src/app/founder/**/page.tsx")) {
  const text = read(file);
  if (text.includes("This screen is wired to the shared AI control plane") || text.includes("Inspectable records, route decisions")) {
    throw new Error("Founder page still contains scaffold copy: " + file);
  }
}

for (const file of [
  "src/app/founder/page.tsx",
  "src/app/founder/renders/page.tsx",
  "src/app/founder/renders/[renderId]/page.tsx",
  "src/app/founder/evals/page.tsx",
  "src/app/founder/experiments/page.tsx",
  "src/app/founder/quality/page.tsx",
  "src/app/founder/customers/page.tsx",
  "src/app/founder/money/page.tsx",
  "src/app/founder/outreach/page.tsx",
  "src/app/founder/ai/page.tsx",
  "src/app/founder/ai/providers/page.tsx",
  "src/app/founder/ai/models/page.tsx",
  "src/app/founder/ai/prompts/page.tsx",
  "src/app/founder/ai/prompts/[promptId]/page.tsx",
  "src/app/founder/ai/deployments/page.tsx",
  "src/app/founder/ai/bundles/page.tsx",
  "src/app/founder/ai/recipes/page.tsx",
  "src/app/founder/ai/costs/page.tsx",
  "src/app/founder/ai/audit/page.tsx",
  "src/app/founder/ai/replay/page.tsx",
  "src/app/founder/ai/test-lab/page.tsx",
  "src/app/founder/ai/experiments/page.tsx"
] as const) {
  assertContains(file, "force-dynamic", "DB-backed founder page must not prerender against operational Supabase tables");
}

for (const [file, secretName] of [["src/lib/ai/providers/openai.ts", "OPENAI_API_KEY"], ["src/lib/ai/providers/gemini.ts", "GEMINI_API_KEY"], ["src/lib/ai/providers/custom-http.ts", "CUSTOM_IMAGE_API_KEY"]] as const) {
  const text = read(file);
  for (const requiredSnippet of ["fetch(", secretName, "uploadGeneratedBase64Asset"]) {
    if (!text.includes(requiredSnippet)) {
      throw new Error("Provider adapter missing real HTTP/storage path: " + file + " " + requiredSnippet);
    }
  }
}

const orchestrator = read("src/lib/render/orchestrator.ts");
for (const requiredSnippet of ["render_retry_scheduled", "render_escalated", "consumeRenderStarted"]) {
  if (!orchestrator.includes(requiredSnippet)) {
    throw new Error("Render orchestrator missing launch-critical behavior: " + requiredSnippet);
  }
}

for (const file of globSync("src/app/**/*.{ts,tsx}")) {
  const text = read(file);
  if (/providers\/(gemini|openai|flux|ideogram|reve|custom-http|local)/.test(text)) {
    throw new Error("Product route imports provider adapter directly: " + file);
  }
}

console.log("static verify passed");

import { existsSync, readFileSync, statSync } from "node:fs";
import { globSync } from "node:fs";

const required = [
  "BUILD-SPEC.md",
  "AGENTS.md",
  "supabase/migrations/20260619120000_initial.sql",
  "src/app/privacy/page.tsx",
  "docs/adr/0001-shopify-app-pricing.md",
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
assertContains("docs/adr/0001-shopify-app-pricing.md", "Status: accepted", "Shopify billing ADR must be accepted");
assertContains("docs/adr/0001-shopify-app-pricing.md", "Shopify App Pricing", "Shopify billing ADR must choose Shopify App Pricing");

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
assertContains("package.json", "app-proxy:smoke", "Production app-proxy smoke script missing");
for (const requiredSnippet of ["signedAppProxyUrl", "POST /app-proxy/rooms", "POST /app-proxy/renders", "POST /app-proxy/renders/:renderId/feedback", "loadRenderBundle", "Feedback smoke did not persist render_feedback row"]) {
  assertContains("scripts/app-proxy-smoke.ts", requiredSnippet, "App-proxy smoke script missing required flow");
}
assertContains("package.json", "webhooks:smoke", "Production webhook smoke script missing");
assertContains("src/lib/shopify/webhooks.ts", "loadActiveJobsByShop", "Durable uninstall must load active persisted shop jobs before cancellation");
assertContains("src/lib/shopify/webhooks.ts", "offlineAccessTokenEncrypted: null", "Durable uninstall must persistently clear offline token");
for (const requiredSnippet of ["x-shopify-hmac-sha256", "customers/data_request", "app/uninstalled", "offline_access_token_encrypted", "cancelled"]) {
  assertContains("scripts/webhooks-smoke.ts", requiredSnippet, "Webhook smoke script missing required flow");
}
assertContains("src/app/privacy/page.tsx", "Temporary room-photo processing", "Public privacy page must disclose temporary room-photo processing");
assertContains("src/app/privacy/page.tsx", "24 hour operational retention", "Public privacy page must disclose room-photo retention");
assertContains("src/app/privacy/page.tsx", "customers/data_request", "Public privacy page must disclose Shopify privacy webhooks");
const persistence = read("src/lib/db/supabase-persistence.ts");
for (const requiredSnippet of ["persistRenderBundle", "persistRecord", "createSupabaseServiceClient", "loadShopByDomain", "loadQueueableJobs", "hydrateRenderPipelineInputs"]) {
  if (!persistence.includes(requiredSnippet)) {
    throw new Error("Supabase persistence adapter missing required behavior: " + requiredSnippet);
  }
}
for (const requiredSnippet of ["persistUsageMonthly", "usage_monthly", "shop_id,month"]) {
  if (!persistence.includes(requiredSnippet)) {
    throw new Error("Monthly usage persistence missing: " + requiredSnippet);
  }
}
assertContains("src/lib/billing/quota.ts", "incrementUsageMonthly", "Quota consumption must write monthly usage counters");
assertContains("src/lib/render/orchestrator.ts", "usage_rollup_updated", "Render pipeline must write accepted/failed monthly usage rollups");
assertContains("src/lib/ai/bootstrap.ts", "primary: [{ providerKey: \"gemini\", modelKey: \"gemini-3.1-flash-image\" }]", "Seeded active shopper policy must not route production traffic to local deterministic model");
assertContains("src/lib/render/cutout.ts", "resolveRoutePolicy(\"admin\", \"product_cutout\")", "Product cutout must use model route policy");
assertContains("src/lib/ai/prompt-control.ts", "resolveRoutePolicy(\"founder\", \"prompt_eval\")", "Founder prompt tests must use model route policy");
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
const migrationFiles = globSync("supabase/migrations/*.sql");
if (migrationFiles.length !== 1 || migrationFiles[0].replace(/\\/g, "/") !== "supabase/migrations/20260619120000_initial.sql") {
  throw new Error("Supabase migrations must stay collapsed to one clean initial migration");
}
for (const file of migrationFiles) {
  if (/legacy|compat|complete_runtime/i.test(file)) {
    throw new Error("Compatibility migration must not be reintroduced: " + file);
  }
}
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

for (const file of globSync("docs/**/*.md")) {
  const text = read(file);
  if (text.includes("This document follows BUILD-SPEC.md. Operational status is valid only when")) {
    throw new Error("Documentation still contains placeholder scaffold text: " + file);
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
for (const [file, requiredSnippet] of [
  ["src/app/founder/renders/[renderId]/page.tsx", "Prompt snapshots, inputs, outputs, provider responses, gate notes, costs, latency, storage keys, feedback, and replay controls."],
  ["src/app/founder/renders/page.tsx", "Every render request, attempt, prompt snapshot, provider payload, gate decision, cost, latency, asset, replay, and feedback record."],
  ["src/app/founder/renders/[renderId]/replay/page.tsx", "alternate prompt bundle, model, recipe, gate policy, fallback policy, and parameters"],
  ["src/app/founder/ai/replay/page.tsx", "Replay candidates"],
  ["src/app/founder/ai/deployments/page.tsx", "rollback-ready"],
  ["src/app/founder/ai/costs/page.tsx", "Cost per accepted"],
  ["src/app/founder/evals/page.tsx", "benchmark runs"],
  ["src/app/founder/experiments/page.tsx", "Prompt, model, recipe, gate, fallback, and parameter tests"]
] as const) {
  assertContains(file, requiredSnippet, "Founder release gate UI missing required evidence");
}
for (const [file, requiredSnippet] of [
  ["src/app/api/founder/ai/[...segments]/route.ts", "createDurableReplay"],
  ["src/app/api/founder/ai/[...segments]/route.ts", "repository.rollbackDeployment"],
  ["src/app/api/founder/ai/[...segments]/route.ts", "runBenchmarkSuite"],
  ["tests/unit/spec-contract.test.ts", "modelKey: \"gpt-image-2\""],
  ["tests/unit/spec-contract.test.ts", "unit benchmark"],
  ["tests/unit/spec-contract.test.ts", "rollbackDeployment"]
] as const) {
  assertContains(file, requiredSnippet, "Founder release gate API/test missing required evidence");
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
assertContains("src/lib/render/orchestrator.ts", "We couldn't get this one right. Try another photo or retry.", "Render failures must use a friendly retry message");
assertContains("src/app/app-proxy/renders/[renderId]/route.ts", "message: render.finalMessage", "App-proxy render status must expose the friendly failed-render message");
assertContains("extension/assets/widget.js", "result.status === \"failed\"", "Widget must handle failed render status");
assertContains("extension/assets/widget.js", "Try another photo or retry", "Widget must show a friendly retry state for failed renders");

for (const file of globSync("src/app/**/*.{ts,tsx}")) {
  const text = read(file);
  if (/providers\/(gemini|openai|flux|ideogram|reve|custom-http|local)/.test(text)) {
    throw new Error("Product route imports provider adapter directly: " + file);
  }
}

console.log("static verify passed");

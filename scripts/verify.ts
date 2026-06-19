import { existsSync, readFileSync, statSync } from "node:fs";
import { globSync } from "node:fs";

const required = ["BUILD-SPEC.md", "AGENTS.md", "supabase/migrations/0001_initial.sql", "src/lib/ai/router.ts", "extension/assets/widget.js"];
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
  assertContains(file, "authenticateAppProxyRequest", "App proxy route missing Shopify HMAC auth");
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

const storage = read("src/lib/storage/signed-upload.ts");
for (const requiredSnippet of ["createSupabaseServiceClient", "createSignedUploadUrl", "createSignedUrl"]) {
  if (!storage.includes(requiredSnippet)) {
    throw new Error("Storage helper missing Supabase signed URL support: " + requiredSnippet);
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

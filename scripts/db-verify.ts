import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadScriptEnv } from "./script-env";

loadScriptEnv();

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing SUPABASE_URL and service-role key for runtime schema verification");
}

const migration = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync("supabase/migrations/" + file, "utf8"))
  .join("\n");
const expectedTables = [...migration.matchAll(/create table\s+(?:if not exists\s+)?([a-z_]+)/gi)]
  .map((match) => match[1])
  .filter((table, index, all) => all.indexOf(table) === index)
  .sort();

const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const missing: string[] = [];
const inaccessible: Array<{ table: string; message: string }> = [];
const missingColumns: Array<{ table: string; columns: string[]; message: string }> = [];
const requireSeed = process.argv.includes("--require-seed");
const writeSmoke = process.argv.includes("--write-smoke");
const requiredColumns: Record<string, string[]> = {
  shop: [
    "id",
    "shop_domain",
    "shop_name",
    "contact_email",
    "shopify_shop_id",
    "offline_access_token_encrypted",
    "access_scopes",
    "plan",
    "trial_ends_at",
    "renders_quota",
    "lifestyle_images_quota",
    "billing_subscription_id",
    "billing_status",
    "room_preview_enabled",
    "debug_asset_retention_enabled",
    "installed_at",
    "uninstalled_at",
    "created_at",
    "updated_at"
  ],
  product_setup: [
    "id",
    "shop_id",
    "shopify_product_gid",
    "shopify_product_handle",
    "title",
    "width_mm",
    "height_mm",
    "depth_mm",
    "category",
    "material",
    "colour",
    "merchant_notes",
    "primary_image_key",
    "cutout_key",
    "prep_status",
    "enabled",
    "created_at",
    "updated_at"
  ],
  room_session: [
    "id",
    "shop_id",
    "product_setup_id",
    "source",
    "room_key",
    "normalized_room_key",
    "verified",
    "width",
    "height",
    "expires_at",
    "created_at",
    "last_activity_at"
  ],
  render_feedback: ["id", "render_request_id", "verdict", "issue_tag", "comment", "created_at"],
  event_log: [
    "id",
    "ts",
    "surface",
    "name",
    "shop_id",
    "prospect_id",
    "render_request_id",
    "product_setup_id",
    "ai_invocation_id",
    "props_json"
  ]
};

for (const table of expectedTables) {
  const { error } = await client.from(table).select("*").limit(1);
  if (!error) {
    continue;
  }
  if (/Could not find the table|does not exist|schema cache/i.test(error.message)) {
    missing.push(table);
  } else {
    inaccessible.push({ table, message: error.message });
  }
}

for (const [table, columns] of Object.entries(requiredColumns)) {
  const { error } = await client.from(table).select(columns.join(",")).limit(1);
  if (error) {
    missingColumns.push({ table, columns, message: error.message });
  }
}

if (missing.length > 0 || inaccessible.length > 0 || missingColumns.length > 0) {
  const details = [
    missing.length ? "missing tables: " + missing.join(", ") : "",
    ...inaccessible.map((item) => item.table + ": " + item.message),
    ...missingColumns.map((item) => item.table + " columns " + item.columns.join(",") + ": " + item.message)
  ].filter(Boolean).join("; ");
  throw new Error("Supabase runtime schema verification failed: " + details);
}

if (requireSeed) {
  const requiredSeedCounts: Record<string, number> = {
    ai_provider: 4,
    ai_model: 4,
    model_route_policy: 1,
    prompt_template: 2,
    prompt_version: 2,
    prompt_bundle: 1,
    prompt_bundle_version: 1,
    render_recipe: 1,
    render_recipe_version: 1,
    prompt_deployment: 1
  };
  const underseeded: string[] = [];
  for (const [table, minimum] of Object.entries(requiredSeedCounts)) {
    const { count, error } = await client.from(table).select("*", { head: true, count: "exact" });
    if (error) {
      throw new Error("Supabase seed verification failed for " + table + ": " + error.message);
    }
    if ((count ?? 0) < minimum) {
      underseeded.push(table + " expected >= " + minimum + " got " + (count ?? 0));
    }
  }
  if (underseeded.length > 0) {
    throw new Error("Supabase AI control plane seed incomplete: " + underseeded.join("; "));
  }
}

async function upsertSmoke(table: string, record: Record<string, unknown>) {
  const { error } = await client.from(table).upsert(record, { onConflict: "id" });
  if (error) {
    throw new Error("Supabase write smoke failed for " + table + ": " + error.message);
  }
}

async function deleteSmoke(table: string, id: string) {
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) {
    throw new Error("Supabase write smoke cleanup failed for " + table + ": " + error.message);
  }
}

if (writeSmoke) {
  const now = new Date().toISOString();
  const shopId = randomUUID();
  const productId = randomUUID();
  const roomId = randomUUID();
  const renderId = randomUUID();
  const feedbackId = randomUUID();
  const eventId = randomUUID();
  const shopDomain = "db-verify-" + shopId + ".myshopify.com";
  try {
    await upsertSmoke("shop", {
      id: shopId,
      shop_domain: shopDomain,
      shop_name: "DB Verify",
      contact_email: "db-verify@example.com",
      shopify_shop_id: "db-verify",
      offline_access_token_encrypted: "redacted",
      access_scopes: ["read_products"],
      plan: "trial",
      trial_ends_at: now,
      renders_quota: 50,
      lifestyle_images_quota: 10,
      billing_subscription_id: "db-verify",
      billing_status: "trial",
      room_preview_enabled: true,
      debug_asset_retention_enabled: false,
      installed_at: now,
      created_at: now,
      updated_at: now
    });
    await upsertSmoke("product_setup", {
      id: productId,
      shop_id: shopId,
      shopify_product_gid: "gid://shopify/Product/db-verify",
      shopify_product_handle: "db-verify",
      title: "DB verify product",
      width_mm: 700,
      height_mm: 820,
      depth_mm: 760,
      category: "chair",
      material: "fabric",
      colour: "blue",
      merchant_notes: "write smoke",
      primary_image_key: "products/db-verify/source.png",
      cutout_key: "products/db-verify/cutout.png",
      prep_status: "ready",
      enabled: true,
      created_at: now,
      updated_at: now
    });
    await upsertSmoke("room_session", {
      id: roomId,
      shop_id: shopId,
      product_setup_id: productId,
      source: "widget",
      room_key: "rooms/" + roomId + "/original.jpg",
      normalized_room_key: "rooms/" + roomId + "/normalized.jpg",
      verified: true,
      width: 1600,
      height: 1200,
      expires_at: now,
      created_at: now,
      last_activity_at: now
    });
    await upsertSmoke("render_request", {
      id: renderId,
      trace_id: "trace_db_verify_" + renderId,
      shop_id: shopId,
      room_session_id: roomId,
      product_setup_id: productId,
      kind: "shopper",
      surface: "widget",
      status: "queued",
      tap_x: 0.5,
      tap_y: 0.7,
      attempt_count: 0,
      remaining_refinements: 3,
      created_at: now,
      updated_at: now
    });
    await upsertSmoke("render_feedback", {
      id: feedbackId,
      render_request_id: renderId,
      verdict: "up",
      issue_tag: "db_verify",
      comment: "write smoke",
      created_at: now
    });
    await upsertSmoke("event_log", {
      id: eventId,
      ts: now,
      surface: "system",
      name: "db_verify_write_smoke",
      shop_id: shopId,
      render_request_id: renderId,
      product_setup_id: productId,
      props_json: { smoke: true }
    });
  } finally {
    await deleteSmoke("event_log", eventId);
    await deleteSmoke("render_feedback", feedbackId);
    await deleteSmoke("render_request", renderId);
    await deleteSmoke("room_session", roomId);
    await deleteSmoke("product_setup", productId);
    await deleteSmoke("shop", shopId);
  }
}

console.log("Supabase runtime schema verified " + expectedTables.length + " clean schema tables" + (requireSeed ? " with AI seed rows" : "") + (writeSmoke ? " plus write smoke" : ""));

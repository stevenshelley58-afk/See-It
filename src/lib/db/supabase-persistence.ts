import { readEnv, type AppEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { repository } from "@/lib/db/repository";
import type {
  AiInvocationRecord,
  AuditLogRecord,
  EventLogRecord,
  JobRecord,
  ProductSetupRecord,
  RenderAssetRecord,
  RenderAttemptRecord,
  RenderFeedbackRecord,
  RenderRequestRecord,
  RenderTraceEventRecord,
  RoomSessionRecord,
  ShopRecord
} from "@/lib/db/schema";

type DbRow = Record<string, unknown>;

type Persistable =
  | ShopRecord
  | ProductSetupRecord
  | RoomSessionRecord
  | RenderRequestRecord
  | RenderAttemptRecord
  | AiInvocationRecord
  | RenderAssetRecord
  | RenderTraceEventRecord
  | RenderFeedbackRecord
  | JobRecord
  | EventLogRecord
  | AuditLogRecord;

const columnAliases: Record<string, string> = {
  attemptCount: "attempt_count",
  normalizedResult: "normalized_result_json",
  imageInputs: "image_inputs_json",
  gateDetail: "gate_detail_json",
  payload: "payload_json",
  props: "props_json",
  before: "before_json",
  after: "after_json"
};

function envForPersistence(env?: AppEnv) {
  if (env) {
    return env;
  }
  try {
    return readEnv();
  } catch {
    return undefined;
  }
}

function shouldPersist(env?: AppEnv) {
  const resolved = envForPersistence(env);
  if (!resolved || resolved.APP_ENV === "test" || resolved.SUPABASE_URL.includes("supabase.local")) {
    return undefined;
  }
  return resolved;
}

function snakeCase(key: string) {
  return columnAliases[key] ?? key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
}

function toDbRecord(record: Persistable) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [snakeCase(key), value])
  );
}

function stringValue(row: DbRow, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function optionalString(row: DbRow, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(row: DbRow, key: string, fallback = 0) {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    return Number(value);
  }
  return fallback;
}

function optionalNumber(row: DbRow, key: string) {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    return Number(value);
  }
  return undefined;
}

function booleanValue(row: DbRow, key: string, fallback = false) {
  const value = row[key];
  return typeof value === "boolean" ? value : fallback;
}

function objectValue(row: DbRow, key: string) {
  const value = row[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function loadSingle(table: string, column: string, value: string, env?: AppEnv) {
  const resolved = shouldPersist(env);
  if (!resolved) {
    return undefined;
  }
  const client = createSupabaseServiceClient(resolved);
  const { data, error } = await client.from(table).select("*").eq(column, value).maybeSingle();
  if (error) {
    throw new Error("supabase_load_failed:" + table + ":" + error.message);
  }
  return data as DbRow | null;
}

async function loadMany(table: string, column: string, value: string, env?: AppEnv) {
  const resolved = shouldPersist(env);
  if (!resolved) {
    return [];
  }
  const client = createSupabaseServiceClient(resolved);
  const { data, error } = await client.from(table).select("*").eq(column, value);
  if (error) {
    throw new Error("supabase_load_failed:" + table + ":" + error.message);
  }
  return (data ?? []) as DbRow[];
}

function hydrateShop(row: DbRow) {
  const record: ShopRecord = {
    id: stringValue(row, "id"),
    shopDomain: stringValue(row, "shop_domain"),
    shopName: optionalString(row, "shop_name"),
    contactEmail: optionalString(row, "contact_email"),
    offlineAccessTokenEncrypted: optionalString(row, "offline_access_token_encrypted"),
    plan: stringValue(row, "plan", "trial") as ShopRecord["plan"],
    rendersQuota: numberValue(row, "renders_quota", 0),
    lifestyleImagesQuota: numberValue(row, "lifestyle_images_quota", 0),
    billingStatus: stringValue(row, "billing_status", "trial"),
    roomPreviewEnabled: booleanValue(row, "room_preview_enabled", true),
    installedAt: stringValue(row, "installed_at", new Date().toISOString()),
    uninstalledAt: optionalString(row, "uninstalled_at")
  };
  repository.shops.set(record.id, record);
  return record;
}

function hydrateProductSetup(row: DbRow) {
  const record: ProductSetupRecord = {
    id: stringValue(row, "id"),
    shopId: stringValue(row, "shop_id"),
    shopifyProductGid: stringValue(row, "shopify_product_gid"),
    shopifyProductHandle: optionalString(row, "shopify_product_handle"),
    title: stringValue(row, "title"),
    widthMm: numberValue(row, "width_mm", 0),
    heightMm: numberValue(row, "height_mm", 0),
    depthMm: numberValue(row, "depth_mm", 0),
    category: stringValue(row, "category", "unknown"),
    material: optionalString(row, "material"),
    colour: optionalString(row, "colour"),
    primaryImageKey: optionalString(row, "primary_image_key"),
    cutoutKey: optionalString(row, "cutout_key"),
    prepStatus: stringValue(row, "prep_status", "none") as ProductSetupRecord["prepStatus"],
    enabled: booleanValue(row, "enabled", false)
  };
  repository.products.set(record.id, record);
  return record;
}

function hydrateRoomSession(row: DbRow) {
  const record: RoomSessionRecord = {
    id: stringValue(row, "id"),
    shopId: optionalString(row, "shop_id"),
    productSetupId: optionalString(row, "product_setup_id"),
    source: stringValue(row, "source", "widget") as RoomSessionRecord["source"],
    roomKey: stringValue(row, "room_key"),
    normalizedRoomKey: optionalString(row, "normalized_room_key"),
    expiresAt: stringValue(row, "expires_at", new Date(Date.now() + 86400000).toISOString()),
    verified: booleanValue(row, "verified", false),
    width: optionalNumber(row, "width"),
    height: optionalNumber(row, "height")
  };
  repository.roomSessions.set(record.id, record);
  return record;
}

function hydrateRenderRequest(row: DbRow) {
  const record: RenderRequestRecord = {
    id: stringValue(row, "id"),
    traceId: stringValue(row, "trace_id"),
    shopId: optionalString(row, "shop_id"),
    roomSessionId: optionalString(row, "room_session_id"),
    productSetupId: optionalString(row, "product_setup_id"),
    sourceRenderRequestId: optionalString(row, "source_render_request_id"),
    kind: stringValue(row, "kind", "shopper") as RenderRequestRecord["kind"],
    surface: stringValue(row, "surface", "widget") as RenderRequestRecord["surface"],
    status: stringValue(row, "status", "queued") as RenderRequestRecord["status"],
    tapX: optionalNumber(row, "tap_x"),
    tapY: optionalNumber(row, "tap_y"),
    hintText: optionalString(row, "hint_text"),
    attemptCount: numberValue(row, "attempt_count", 0),
    remainingRefinements: numberValue(row, "remaining_refinements", 3),
    selectedResultAssetId: optionalString(row, "selected_result_asset_id"),
    finalGateScore: optionalNumber(row, "final_gate_score"),
    finalErrorCode: optionalString(row, "final_error_code"),
    finalMessage: optionalString(row, "final_message"),
    createdAt: stringValue(row, "created_at", new Date().toISOString()),
    completedAt: optionalString(row, "completed_at")
  };
  repository.renderRequests.set(record.id, record);
  return record;
}

function hydrateRenderAsset(row: DbRow) {
  const record: RenderAssetRecord = {
    id: stringValue(row, "id"),
    renderRequestId: stringValue(row, "render_request_id"),
    renderAttemptId: optionalString(row, "render_attempt_id"),
    aiInvocationId: optionalString(row, "ai_invocation_id"),
    role: stringValue(row, "role"),
    storageBucket: stringValue(row, "storage_bucket"),
    storageKey: stringValue(row, "storage_key"),
    mimeType: stringValue(row, "mime_type", "image/png"),
    width: optionalNumber(row, "width"),
    height: optionalNumber(row, "height"),
    sha256: optionalString(row, "sha256"),
    bytes: optionalNumber(row, "bytes"),
    retentionExpiresAt: optionalString(row, "retention_expires_at")
  };
  repository.renderAssets.set(record.id, record);
  return record;
}

function hydrateJob(row: DbRow) {
  const record: JobRecord = {
    id: stringValue(row, "id"),
    type: stringValue(row, "type"),
    status: stringValue(row, "status", "queued") as JobRecord["status"],
    priority: numberValue(row, "priority", 100),
    payload: objectValue(row, "payload_json"),
    idempotencyKey: stringValue(row, "idempotency_key"),
    leaseOwner: optionalString(row, "lease_owner"),
    leasedUntil: optionalString(row, "leased_until"),
    attemptCount: numberValue(row, "attempt_count", 0),
    maxAttempts: numberValue(row, "max_attempts", 3),
    lastErrorCode: optionalString(row, "last_error_code"),
    lastErrorMessage: optionalString(row, "last_error_message"),
    runAfter: stringValue(row, "run_after", new Date().toISOString()),
    createdAt: stringValue(row, "created_at", new Date().toISOString()),
    completedAt: optionalString(row, "completed_at")
  };
  repository.jobs.set(record.id, record);
  return record;
}

export async function persistRecord(table: string, record: Persistable, env?: AppEnv) {
  const resolved = shouldPersist(env);
  if (!resolved) {
    return { persisted: false, table, id: record.id };
  }
  const client = createSupabaseServiceClient(resolved);
  const { error } = await client.from(table).upsert(toDbRecord(record), { onConflict: "id" });
  if (error) {
    throw new Error("supabase_persist_failed:" + table + ":" + error.message);
  }
  return { persisted: true, table, id: record.id };
}

export async function persistRenderBundle(renderRequestId: string, env?: AppEnv) {
  const bundle = repository.renderBundleForRequest(renderRequestId);
  await persistRecord("render_request", bundle.request, env);
  for (const attempt of bundle.attempts) {
    await persistRecord("render_attempt", attempt, env);
  }
  for (const invocation of bundle.invocations) {
    await persistRecord("ai_invocation", invocation, env);
  }
  for (const asset of bundle.assets) {
    await persistRecord("render_asset", asset, env);
  }
  for (const event of bundle.trace) {
    await persistRecord("render_trace_event", event, env);
  }
  for (const feedback of bundle.feedback) {
    await persistRecord("render_feedback", feedback, env);
  }
  return bundle;
}

export async function persistShop(shop: ShopRecord, env?: AppEnv) {
  return persistRecord("shop", shop, env);
}

export async function persistProductSetup(product: ProductSetupRecord, env?: AppEnv) {
  return persistRecord("product_setup", product, env);
}

export async function persistRoomSession(room: RoomSessionRecord, env?: AppEnv) {
  return persistRecord("room_session", room, env);
}

export async function persistJob(job: JobRecord, env?: AppEnv) {
  return persistRecord("job", job, env);
}

export async function persistEvent(event: EventLogRecord, env?: AppEnv) {
  return persistRecord("event_log", event, env);
}

export async function persistAudit(audit: AuditLogRecord, env?: AppEnv) {
  return persistRecord("audit_log", audit, env);
}

export async function loadShopByDomain(shopDomain: string, env?: AppEnv) {
  const cached = [...repository.shops.values()].find((shop) => shop.shopDomain === shopDomain);
  if (cached) {
    return cached;
  }
  const row = await loadSingle("shop", "shop_domain", shopDomain, env);
  return row ? hydrateShop(row) : undefined;
}

export async function loadShopById(shopId: string, env?: AppEnv) {
  const cached = repository.shops.get(shopId);
  if (cached) {
    return cached;
  }
  const row = await loadSingle("shop", "id", shopId, env);
  return row ? hydrateShop(row) : undefined;
}

export async function loadProductSetupById(productSetupId: string, env?: AppEnv) {
  const cached = repository.products.get(productSetupId);
  if (cached) {
    return cached;
  }
  const row = await loadSingle("product_setup", "id", productSetupId, env);
  return row ? hydrateProductSetup(row) : undefined;
}

export async function loadProductSetupByShopAndGid(shopId: string, shopifyProductGid: string, env?: AppEnv) {
  const cached = [...repository.products.values()].find((product) => product.shopId === shopId && product.shopifyProductGid === shopifyProductGid);
  if (cached) {
    return cached;
  }
  const resolved = shouldPersist(env);
  if (!resolved) {
    return undefined;
  }
  const client = createSupabaseServiceClient(resolved);
  const { data, error } = await client.from("product_setup").select("*").eq("shop_id", shopId).eq("shopify_product_gid", shopifyProductGid).maybeSingle();
  if (error) {
    throw new Error("supabase_load_failed:product_setup:" + error.message);
  }
  return data ? hydrateProductSetup(data as DbRow) : undefined;
}

export async function loadProductSetupsByShop(shopId: string, env?: AppEnv) {
  const rows = await loadMany("product_setup", "shop_id", shopId, env);
  return rows.map(hydrateProductSetup);
}

export async function loadRoomSessionById(roomSessionId: string, env?: AppEnv) {
  const cached = repository.roomSessions.get(roomSessionId);
  if (cached) {
    return cached;
  }
  const row = await loadSingle("room_session", "id", roomSessionId, env);
  return row ? hydrateRoomSession(row) : undefined;
}

export async function loadRenderRequestById(renderRequestId: string, env?: AppEnv) {
  const cached = repository.renderRequests.get(renderRequestId);
  if (cached) {
    return cached;
  }
  const row = await loadSingle("render_request", "id", renderRequestId, env);
  return row ? hydrateRenderRequest(row) : undefined;
}

export async function loadRenderAssetsForRequest(renderRequestId: string, env?: AppEnv) {
  const rows = await loadMany("render_asset", "render_request_id", renderRequestId, env);
  return rows.map(hydrateRenderAsset);
}

export async function loadQueueableJobs(limit = 10, env?: AppEnv) {
  const resolved = shouldPersist(env);
  if (!resolved) {
    return [];
  }
  const client = createSupabaseServiceClient(resolved);
  const { data, error } = await client
    .from("job")
    .select("*")
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .order("priority", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error("supabase_load_failed:job:" + error.message);
  }
  return ((data ?? []) as DbRow[]).map(hydrateJob);
}

export async function hydrateRenderPipelineInputs(renderRequestId: string, env?: AppEnv) {
  const request = await loadRenderRequestById(renderRequestId, env);
  if (!request) {
    return undefined;
  }
  if (request.shopId) {
    await loadShopById(request.shopId, env);
  }
  if (request.roomSessionId) {
    const room = await loadRoomSessionById(request.roomSessionId, env);
    if (room?.productSetupId) {
      await loadProductSetupById(room.productSetupId, env);
    }
  }
  return request;
}

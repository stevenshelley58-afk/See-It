import { readEnv, type AppEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { repository } from "@/lib/db/repository";
import type {
  AiInvocationRecord,
  AuditLogRecord,
  AiModelRecord,
  AiProviderRecord,
  AiExperimentArmRecord,
  AiExperimentAssignmentRecord,
  AiExperimentRecord,
  EvalCaseRecord,
  EvalDatasetRecord,
  EvalResultRecord,
  EvalRunRecord,
  EventLogRecord,
  JobRecord,
  ManualReviewRecord,
  ModelRoutePolicyRecord,
  ProductSetupRecord,
  PromptBundleRecord,
  PromptBundleVersionRecord,
  PromptDeploymentRecord,
  PromptTemplateRecord,
  PromptVersionRecord,
  RenderAssetRecord,
  RenderAttemptRecord,
  RenderFeedbackRecord,
  RenderRecipeRecord,
  RenderRecipeVersionRecord,
  RenderRequestRecord,
  RenderTraceEventRecord,
  RoomSessionRecord,
  ShopRecord
} from "@/lib/db/schema";

type DbRow = Record<string, unknown>;

type Persistable =
  | AiProviderRecord
  | ModelRoutePolicyRecord
  | PromptTemplateRecord
  | PromptVersionRecord
  | PromptBundleRecord
  | PromptBundleVersionRecord
  | RenderRecipeRecord
  | RenderRecipeVersionRecord
  | PromptDeploymentRecord
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
  | AuditLogRecord
  | ManualReviewRecord
  | EvalDatasetRecord
  | EvalCaseRecord
  | EvalRunRecord
  | EvalResultRecord
  | AiExperimentRecord
  | AiExperimentArmRecord
  | AiExperimentAssignmentRecord;

const columnAliases: Record<string, string> = {
  attemptCount: "attempt_count",
  normalizedResult: "normalized_result_json",
  imageInputs: "image_inputs_json",
  params: "params_json",
  requestJsonRedacted: "request_json_redacted",
  responseJsonRedacted: "response_json_redacted",
  gateDetail: "gate_detail_json",
  payload: "payload_json",
  props: "props_json",
  before: "before_json",
  after: "after_json",
  capabilities: "capabilities_json",
  defaultParams: "default_params_json",
  limits: "limits_json",
  pricing: "pricing_json",
  policy: "policy_json",
  variablesSchema: "variables_schema_json",
  outputSchema: "output_schema_json",
  allowedAssetRoles: "allowed_asset_roles_json",
  requiredAssetOrder: "required_asset_order_json",
  promptVersionMap: "prompt_version_map_json",
  gatePolicy: "gate_policy_json",
  retryPolicy: "retry_policy_json",
  storagePolicy: "storage_policy_json",
  outputPolicy: "output_policy_json"
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

function stringArrayValue(row: DbRow, key: string) {
  const value = row[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

async function loadAll(table: string, env?: AppEnv, options: { limit?: number; orderBy?: string; ascending?: boolean } = {}) {
  const resolved = shouldPersist(env);
  if (!resolved) {
    return [];
  }
  const client = createSupabaseServiceClient(resolved);
  let query = client.from(table).select("*");
  if (options.orderBy) {
    query = query.order(options.orderBy, { ascending: options.ascending ?? false });
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error("supabase_load_failed:" + table + ":" + error.message);
  }
  return (data ?? []) as DbRow[];
}

async function loadModelTasks(modelIds: string[], env?: AppEnv) {
  const resolved = shouldPersist(env);
  if (!resolved || modelIds.length === 0) {
    return [];
  }
  const client = createSupabaseServiceClient(resolved);
  const { data, error } = await client.from("ai_model_task").select("*").in("ai_model_id", modelIds);
  if (error) {
    throw new Error("supabase_load_failed:ai_model_task:" + error.message);
  }
  return (data ?? []) as DbRow[];
}

function memoryFallback<T>(values: Iterable<T>, persistedRows: DbRow[], env?: AppEnv) {
  if (persistedRows.length > 0 || shouldPersist(env)) {
    return undefined;
  }
  return [...values];
}

function hydrateAiProvider(row: DbRow) {
  const record: AiProviderRecord = {
    id: stringValue(row, "id"),
    providerKey: stringValue(row, "provider_key"),
    displayName: stringValue(row, "display_name"),
    adapterKey: stringValue(row, "adapter_key"),
    adapterVersion: stringValue(row, "adapter_version"),
    status: stringValue(row, "status", "disabled") as AiProviderRecord["status"],
    secretRef: optionalString(row, "secret_ref"),
    baseUrl: optionalString(row, "base_url"),
    docsUrl: optionalString(row, "docs_url"),
    notes: optionalString(row, "notes")
  };
  repository.providers.set(record.id, record);
  return record;
}

function hydrateAiModel(row: DbRow, allowedTasks: string[]) {
  const provider = repository.providers.get(stringValue(row, "provider_id"));
  const record: AiModelRecord = {
    id: stringValue(row, "id"),
    providerId: stringValue(row, "provider_id"),
    providerKey: provider?.providerKey ?? stringValue(row, "provider_key"),
    modelKey: stringValue(row, "model_key"),
    displayName: stringValue(row, "display_name", stringValue(row, "model_key")),
    modelVersion: optionalString(row, "model_version"),
    status: stringValue(row, "status", "disabled") as AiModelRecord["status"],
    capabilities: stringArrayValue(row, "capabilities_json"),
    allowedTasks: allowedTasks as AiModelRecord["allowedTasks"],
    defaultParams: objectValue(row, "default_params_json"),
    limits: objectValue(row, "limits_json"),
    pricing: objectValue(row, "pricing_json"),
    docsUrl: optionalString(row, "docs_url")
  };
  repository.models.set(record.id, record);
  return record;
}

function hydrateRoutePolicy(row: DbRow) {
  const record: ModelRoutePolicyRecord = {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    surface: stringValue(row, "surface", "widget") as ModelRoutePolicyRecord["surface"],
    taskType: stringValue(row, "task_type", "render_composite") as ModelRoutePolicyRecord["taskType"],
    status: stringValue(row, "status", "draft") as ModelRoutePolicyRecord["status"],
    policy: objectValue(row, "policy_json") as ModelRoutePolicyRecord["policy"]
  };
  repository.routePolicies.set(record.id, record);
  return record;
}

function hydratePromptTemplate(row: DbRow) {
  const record: PromptTemplateRecord = {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    taskType: stringValue(row, "task_type", "render_composite") as PromptTemplateRecord["taskType"],
    surface: stringValue(row, "surface", "widget") as PromptTemplateRecord["surface"],
    description: optionalString(row, "description")
  };
  repository.promptTemplates.set(record.id, record);
  return record;
}

function hydratePromptVersion(row: DbRow) {
  const record: PromptVersionRecord = {
    id: stringValue(row, "id"),
    promptTemplateId: stringValue(row, "prompt_template_id"),
    version: numberValue(row, "version", 1),
    status: stringValue(row, "status", "draft") as PromptVersionRecord["status"],
    systemInstruction: optionalString(row, "system_instruction"),
    developerInstruction: optionalString(row, "developer_instruction"),
    userPromptTemplate: stringValue(row, "user_prompt_template"),
    negativePromptTemplate: optionalString(row, "negative_prompt_template"),
    variablesSchema: objectValue(row, "variables_schema_json"),
    outputSchema: objectValue(row, "output_schema_json"),
    allowedAssetRoles: stringArrayValue(row, "allowed_asset_roles_json"),
    requiredAssetOrder: stringArrayValue(row, "required_asset_order_json"),
    defaultParams: objectValue(row, "default_params_json"),
    promptHash: stringValue(row, "prompt_hash"),
    notes: optionalString(row, "notes"),
    createdBy: stringValue(row, "created_by", "system"),
    approvedBy: optionalString(row, "approved_by"),
    approvedAt: optionalString(row, "approved_at")
  };
  repository.promptVersions.set(record.id, record);
  return record;
}

function hydratePromptBundle(row: DbRow) {
  const record: PromptBundleRecord = {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    surface: stringValue(row, "surface", "widget") as PromptBundleRecord["surface"],
    description: optionalString(row, "description")
  };
  repository.bundles.set(record.id, record);
  return record;
}

function hydratePromptBundleVersion(row: DbRow) {
  const record: PromptBundleVersionRecord = {
    id: stringValue(row, "id"),
    promptBundleId: stringValue(row, "prompt_bundle_id"),
    version: numberValue(row, "version", 1),
    status: stringValue(row, "status", "draft") as PromptBundleVersionRecord["status"],
    promptVersionMap: objectValue(row, "prompt_version_map_json") as Record<string, string>,
    bundleHash: stringValue(row, "bundle_hash")
  };
  repository.bundleVersions.set(record.id, record);
  return record;
}

function hydrateRenderRecipe(row: DbRow) {
  const record: RenderRecipeRecord = {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    surface: stringValue(row, "surface", "widget") as RenderRecipeRecord["surface"],
    kind: stringValue(row, "kind", "shopper") as RenderRecipeRecord["kind"],
    description: optionalString(row, "description")
  };
  repository.recipes.set(record.id, record);
  return record;
}

function hydrateRenderRecipeVersion(row: DbRow) {
  const record: RenderRecipeVersionRecord = {
    id: stringValue(row, "id"),
    renderRecipeId: stringValue(row, "render_recipe_id"),
    version: numberValue(row, "version", 1),
    status: stringValue(row, "status", "draft") as RenderRecipeVersionRecord["status"],
    promptBundleVersionId: stringValue(row, "prompt_bundle_version_id"),
    modelRoutePolicyId: stringValue(row, "model_route_policy_id"),
    gatePolicy: objectValue(row, "gate_policy_json"),
    retryPolicy: objectValue(row, "retry_policy_json"),
    storagePolicy: objectValue(row, "storage_policy_json"),
    outputPolicy: objectValue(row, "output_policy_json"),
    recipeHash: stringValue(row, "recipe_hash")
  };
  repository.recipeVersions.set(record.id, record);
  return record;
}

function hydratePromptDeployment(row: DbRow) {
  const record: PromptDeploymentRecord = {
    id: stringValue(row, "id"),
    surface: stringValue(row, "surface", "widget") as PromptDeploymentRecord["surface"],
    taskType: optionalString(row, "task_type") as PromptDeploymentRecord["taskType"],
    renderRecipeVersionId: stringValue(row, "render_recipe_version_id"),
    status: stringValue(row, "status", "paused") as PromptDeploymentRecord["status"],
    trafficPercent: numberValue(row, "traffic_percent", 0),
    startedAt: stringValue(row, "started_at", new Date().toISOString()),
    endedAt: optionalString(row, "ended_at"),
    createdBy: stringValue(row, "created_by", "system"),
    reason: optionalString(row, "reason")
  };
  repository.deployments.set(record.id, record);
  return record;
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

function hydrateRenderAttempt(row: DbRow) {
  const record: RenderAttemptRecord = {
    id: stringValue(row, "id"),
    renderRequestId: stringValue(row, "render_request_id"),
    attemptNumber: numberValue(row, "attempt_number", 1),
    parentAttemptId: optionalString(row, "parent_attempt_id"),
    aiInvocationId: optionalString(row, "ai_invocation_id"),
    providerId: optionalString(row, "provider_id"),
    aiModelId: optionalString(row, "ai_model_id"),
    renderRecipeVersionId: optionalString(row, "render_recipe_version_id"),
    promptBundleVersionId: optionalString(row, "prompt_bundle_version_id"),
    status: stringValue(row, "status", "queued") as RenderAttemptRecord["status"],
    reason: optionalString(row, "reason"),
    resultAssetId: optionalString(row, "result_asset_id"),
    gateScore: optionalNumber(row, "gate_score"),
    gateDetail: objectValue(row, "gate_detail_json"),
    latencyMs: optionalNumber(row, "latency_ms"),
    costEstimateUsd: optionalNumber(row, "cost_estimate_usd"),
    errorCode: optionalString(row, "error_code"),
    errorMessage: optionalString(row, "error_message")
  };
  repository.renderAttempts.set(record.id, record);
  return record;
}

function hydrateAiInvocation(row: DbRow) {
  const record: AiInvocationRecord = {
    id: stringValue(row, "id"),
    traceId: stringValue(row, "trace_id"),
    surface: stringValue(row, "surface", "system") as AiInvocationRecord["surface"],
    taskType: stringValue(row, "task_type", "render_composite") as AiInvocationRecord["taskType"],
    providerId: stringValue(row, "provider_id"),
    aiModelId: stringValue(row, "ai_model_id"),
    adapterKey: stringValue(row, "adapter_key"),
    adapterVersion: stringValue(row, "adapter_version"),
    promptTemplateId: optionalString(row, "prompt_template_id"),
    promptVersionId: optionalString(row, "prompt_version_id"),
    promptBundleVersionId: optionalString(row, "prompt_bundle_version_id"),
    renderRecipeVersionId: optionalString(row, "render_recipe_version_id"),
    resolvedSystemInstruction: optionalString(row, "resolved_system_instruction"),
    resolvedDeveloperInstruction: optionalString(row, "resolved_developer_instruction"),
    resolvedUserPrompt: optionalString(row, "resolved_user_prompt"),
    resolvedNegativePrompt: optionalString(row, "resolved_negative_prompt"),
    variablesJson: objectValue(row, "variables_json"),
    imageInputs: Array.isArray(row.image_inputs_json) ? row.image_inputs_json as AiInvocationRecord["imageInputs"] : [],
    params: objectValue(row, "params_json"),
    requestJsonRedacted: row.request_json_redacted ?? {},
    responseJsonRedacted: row.response_json_redacted ?? {},
    normalizedResult: objectValue(row, "normalized_result_json") as AiInvocationRecord["normalizedResult"],
    providerResponseId: optionalString(row, "provider_response_id"),
    finishReason: optionalString(row, "finish_reason"),
    safetyJson: row.safety_json ?? {},
    usageJson: row.usage_json ?? {},
    costEstimateUsd: optionalNumber(row, "cost_estimate_usd"),
    latencyMs: optionalNumber(row, "latency_ms"),
    status: stringValue(row, "status", "created") as AiInvocationRecord["status"],
    errorCode: optionalString(row, "error_code"),
    errorMessage: optionalString(row, "error_message"),
    retryable: booleanValue(row, "retryable", false),
    idempotencyKey: stringValue(row, "idempotency_key"),
    createdAt: stringValue(row, "created_at", new Date().toISOString()),
    completedAt: optionalString(row, "completed_at")
  };
  repository.aiInvocations.set(record.id, record);
  return record;
}

function hydrateTraceEvent(row: DbRow) {
  const record: RenderTraceEventRecord = {
    id: stringValue(row, "id"),
    traceId: stringValue(row, "trace_id"),
    renderRequestId: optionalString(row, "render_request_id"),
    renderAttemptId: optionalString(row, "render_attempt_id"),
    aiInvocationId: optionalString(row, "ai_invocation_id"),
    eventName: stringValue(row, "event_name"),
    eventLevel: stringValue(row, "event_level", "info") as RenderTraceEventRecord["eventLevel"],
    message: optionalString(row, "message"),
    props: objectValue(row, "props_json"),
    durationMs: optionalNumber(row, "duration_ms"),
    createdAt: stringValue(row, "created_at", new Date().toISOString())
  };
  repository.traceEvents.set(record.id, record);
  return record;
}

function hydrateRenderFeedback(row: DbRow) {
  const record: RenderFeedbackRecord = {
    id: stringValue(row, "id"),
    renderRequestId: stringValue(row, "render_request_id"),
    verdict: stringValue(row, "verdict", "down") as RenderFeedbackRecord["verdict"],
    issueTag: optionalString(row, "issue_tag"),
    comment: optionalString(row, "comment")
  };
  repository.feedback.set(record.id, record);
  return record;
}

function hydrateManualReview(row: DbRow) {
  const record: ManualReviewRecord = {
    id: stringValue(row, "id"),
    renderRequestId: stringValue(row, "render_request_id"),
    reviewer: stringValue(row, "reviewer", "founder"),
    score: optionalNumber(row, "score"),
    status: stringValue(row, "status", "needs_prompt_work") as ManualReviewRecord["status"],
    issueTags: stringArrayValue(row, "issue_tags"),
    notes: optionalString(row, "notes"),
    createdAt: stringValue(row, "created_at", new Date().toISOString())
  };
  repository.manualReviews.set(record.id, record);
  return record;
}

function hydrateEvalDataset(row: DbRow) {
  const record: EvalDatasetRecord = {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    description: optionalString(row, "description"),
    status: stringValue(row, "status", "active") as EvalDatasetRecord["status"],
    createdAt: stringValue(row, "created_at", new Date().toISOString()),
    updatedAt: stringValue(row, "updated_at", new Date().toISOString())
  };
  repository.evalDatasets.set(record.id, record);
  return record;
}

function hydrateEvalCase(row: DbRow) {
  const record: EvalCaseRecord = {
    id: stringValue(row, "id"),
    evalDatasetId: stringValue(row, "eval_dataset_id"),
    caseSlug: stringValue(row, "case_slug"),
    productAssetKey: optionalString(row, "product_asset_key"),
    cutoutAssetKey: optionalString(row, "cutout_asset_key"),
    roomAssetKey: optionalString(row, "room_asset_key"),
    maskAssetKey: optionalString(row, "mask_asset_key"),
    expectedJson: objectValue(row, "expected_json"),
    notes: optionalString(row, "notes"),
    createdAt: stringValue(row, "created_at", new Date().toISOString())
  };
  repository.evalCases.set(record.id, record);
  return record;
}

function hydrateEvalRun(row: DbRow) {
  const record: EvalRunRecord = {
    id: stringValue(row, "id"),
    evalDatasetId: stringValue(row, "eval_dataset_id"),
    name: optionalString(row, "name"),
    renderRecipeVersionId: optionalString(row, "render_recipe_version_id"),
    modelRoutePolicyId: optionalString(row, "model_route_policy_id"),
    status: stringValue(row, "status", "queued") as EvalRunRecord["status"],
    summaryJson: objectValue(row, "summary_json"),
    createdBy: stringValue(row, "created_by", "system"),
    createdAt: stringValue(row, "created_at", new Date().toISOString()),
    completedAt: optionalString(row, "completed_at")
  };
  repository.evalRuns.set(record.id, record);
  return record;
}

function hydrateEvalResult(row: DbRow) {
  const record: EvalResultRecord = {
    id: stringValue(row, "id"),
    evalRunId: stringValue(row, "eval_run_id"),
    evalCaseId: optionalString(row, "eval_case_id"),
    renderRequestId: optionalString(row, "render_request_id"),
    automatedScoreJson: objectValue(row, "automated_score_json"),
    manualScoreJson: objectValue(row, "manual_score_json"),
    status: stringValue(row, "status", "review") as EvalResultRecord["status"],
    createdAt: stringValue(row, "created_at", new Date().toISOString())
  };
  repository.evalResults.set(record.id, record);
  return record;
}

function hydrateExperiment(row: DbRow) {
  const record: AiExperimentRecord = {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    type: stringValue(row, "type", "model_test") as AiExperimentRecord["type"],
    surface: stringValue(row, "surface", "widget") as AiExperimentRecord["surface"],
    status: stringValue(row, "status", "draft") as AiExperimentRecord["status"],
    startAt: optionalString(row, "start_at"),
    endAt: optionalString(row, "end_at"),
    trafficPercent: numberValue(row, "traffic_percent", 0),
    successMetric: optionalString(row, "success_metric"),
    guardrailJson: objectValue(row, "guardrail_json"),
    createdBy: stringValue(row, "created_by", "system"),
    createdAt: stringValue(row, "created_at", new Date().toISOString()),
    updatedAt: stringValue(row, "updated_at", new Date().toISOString())
  };
  repository.experiments.set(record.id, record);
  return record;
}

function hydrateExperimentArm(row: DbRow) {
  const record: AiExperimentArmRecord = {
    id: stringValue(row, "id"),
    experimentId: stringValue(row, "experiment_id"),
    name: stringValue(row, "name"),
    renderRecipeVersionId: optionalString(row, "render_recipe_version_id"),
    aiModelId: optionalString(row, "ai_model_id"),
    promptBundleVersionId: optionalString(row, "prompt_bundle_version_id"),
    paramsOverrideJson: objectValue(row, "params_override_json"),
    trafficWeight: numberValue(row, "traffic_weight", 0),
    status: stringValue(row, "status", "active") as AiExperimentArmRecord["status"],
    createdAt: stringValue(row, "created_at", new Date().toISOString())
  };
  repository.experimentArms.set(record.id, record);
  return record;
}

function hydrateExperimentAssignment(row: DbRow) {
  const record: AiExperimentAssignmentRecord = {
    id: stringValue(row, "id"),
    experimentId: stringValue(row, "experiment_id"),
    armId: stringValue(row, "arm_id"),
    assignmentKey: stringValue(row, "assignment_key"),
    renderRequestId: optionalString(row, "render_request_id"),
    createdAt: stringValue(row, "created_at", new Date().toISOString())
  };
  repository.experimentAssignments.set(record.id, record);
  return record;
}

function hydrateAuditLog(row: DbRow) {
  const record: AuditLogRecord = {
    id: stringValue(row, "id"),
    actor: stringValue(row, "actor", "system"),
    action: stringValue(row, "action"),
    entityType: stringValue(row, "entity_type"),
    entityId: optionalString(row, "entity_id"),
    before: row.before_json,
    after: row.after_json,
    reason: optionalString(row, "reason"),
    createdAt: stringValue(row, "created_at", new Date().toISOString())
  };
  repository.auditLogs.set(record.id, record);
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

export async function persistManualReview(review: ManualReviewRecord, env?: AppEnv) {
  return persistRecord("manual_review", review, env);
}

export async function persistEvalDataset(dataset: EvalDatasetRecord, env?: AppEnv) {
  return persistRecord("eval_dataset", dataset, env);
}

export async function persistEvalCase(evalCase: EvalCaseRecord, env?: AppEnv) {
  return persistRecord("eval_case", evalCase, env);
}

export async function persistEvalRun(run: EvalRunRecord, env?: AppEnv) {
  return persistRecord("eval_run", run, env);
}

export async function persistEvalResult(result: EvalResultRecord, env?: AppEnv) {
  return persistRecord("eval_result", result, env);
}

export async function persistExperiment(experiment: AiExperimentRecord, env?: AppEnv) {
  return persistRecord("ai_experiment", experiment, env);
}

export async function persistExperimentArm(arm: AiExperimentArmRecord, env?: AppEnv) {
  return persistRecord("ai_experiment_arm", arm, env);
}

export async function persistExperimentAssignment(assignment: AiExperimentAssignmentRecord, env?: AppEnv) {
  return persistRecord("ai_experiment_assignment", assignment, env);
}

export async function persistPromptTemplate(template: PromptTemplateRecord, env?: AppEnv) {
  return persistRecord("prompt_template", template, env);
}

export async function persistPromptVersion(version: PromptVersionRecord, env?: AppEnv) {
  return persistRecord("prompt_version", version, env);
}

export async function persistPromptDeployment(deployment: PromptDeploymentRecord, env?: AppEnv) {
  return persistRecord("prompt_deployment", deployment, env);
}

export async function persistAiInvocation(invocation: AiInvocationRecord, env?: AppEnv) {
  return persistRecord("ai_invocation", invocation, env);
}

export async function persistRenderTraceEvent(event: RenderTraceEventRecord, env?: AppEnv) {
  return persistRecord("render_trace_event", event, env);
}

export async function persistAiModel(model: AiModelRecord, env?: AppEnv) {
  const resolved = shouldPersist(env);
  if (!resolved) {
    return { persisted: false, table: "ai_model", id: model.id };
  }
  const client = createSupabaseServiceClient(resolved);
  const { error } = await client.from("ai_model").upsert({
    id: model.id,
    provider_id: model.providerId,
    model_key: model.modelKey,
    display_name: model.displayName,
    model_version: model.modelVersion,
    status: model.status,
    capabilities_json: model.capabilities,
    default_params_json: model.defaultParams,
    limits_json: model.limits,
    pricing_json: model.pricing,
    docs_url: model.docsUrl
  }, { onConflict: "id" });
  if (error) {
    throw new Error("supabase_persist_failed:ai_model:" + error.message);
  }
  if (model.allowedTasks.length > 0) {
    const taskRows = model.allowedTasks.map((taskType) => ({ ai_model_id: model.id, task_type: taskType, enabled: true }));
    const taskResult = await client.from("ai_model_task").upsert(taskRows, { onConflict: "ai_model_id,task_type" });
    if (taskResult.error) {
      throw new Error("supabase_persist_failed:ai_model_task:" + taskResult.error.message);
    }
  }
  return { persisted: true, table: "ai_model", id: model.id };
}

export async function persistAiControlPlane(env?: AppEnv) {
  for (const provider of repository.providers.values()) {
    await persistRecord("ai_provider", provider, env);
  }
  for (const model of repository.models.values()) {
    await persistAiModel(model, env);
  }
  for (const policy of repository.routePolicies.values()) {
    await persistRecord("model_route_policy", policy, env);
  }
  for (const template of repository.promptTemplates.values()) {
    await persistPromptTemplate(template, env);
  }
  for (const version of repository.promptVersions.values()) {
    await persistPromptVersion(version, env);
  }
  for (const bundle of repository.bundles.values()) {
    await persistRecord("prompt_bundle", bundle, env);
  }
  for (const bundleVersion of repository.bundleVersions.values()) {
    await persistRecord("prompt_bundle_version", bundleVersion, env);
  }
  for (const recipe of repository.recipes.values()) {
    await persistRecord("render_recipe", recipe, env);
  }
  for (const recipeVersion of repository.recipeVersions.values()) {
    await persistRecord("render_recipe_version", recipeVersion, env);
  }
  for (const deployment of repository.deployments.values()) {
    await persistPromptDeployment(deployment, env);
  }
}

export async function persistAuditLogs(env?: AppEnv) {
  for (const audit of repository.auditLogs.values()) {
    await persistAudit(audit, env);
  }
}

export async function loadAiControlPlane(env?: AppEnv) {
  const providerRows = await loadAll("ai_provider", env, { orderBy: "provider_key", ascending: true });
  if (providerRows.length === 0 && !shouldPersist(env)) {
    return {
      providers: [...repository.providers.values()],
      models: [...repository.models.values()],
      routePolicies: [...repository.routePolicies.values()],
      promptTemplates: [...repository.promptTemplates.values()],
      promptVersions: [...repository.promptVersions.values()],
      bundles: [...repository.bundles.values()],
      bundleVersions: [...repository.bundleVersions.values()],
      recipes: [...repository.recipes.values()],
      recipeVersions: [...repository.recipeVersions.values()],
      deployments: [...repository.deployments.values()]
    };
  }
  const providers = providerRows.map(hydrateAiProvider);
  const modelRows = await loadAll("ai_model", env, { orderBy: "model_key", ascending: true });
  const taskRows = await loadModelTasks(modelRows.map((row) => stringValue(row, "id")), env);
  const tasksByModel = new Map<string, string[]>();
  for (const row of taskRows) {
    const modelId = stringValue(row, "ai_model_id");
    tasksByModel.set(modelId, [...(tasksByModel.get(modelId) ?? []), stringValue(row, "task_type")]);
  }
  const models = modelRows.map((row) => hydrateAiModel(row, tasksByModel.get(stringValue(row, "id")) ?? []));
  const routePolicies = (await loadAll("model_route_policy", env, { orderBy: "created_at", ascending: true })).map(hydrateRoutePolicy);
  const promptTemplates = (await loadAll("prompt_template", env, { orderBy: "created_at", ascending: true })).map(hydratePromptTemplate);
  const promptVersions = (await loadAll("prompt_version", env, { orderBy: "created_at", ascending: true })).map(hydratePromptVersion);
  const bundles = (await loadAll("prompt_bundle", env, { orderBy: "created_at", ascending: true })).map(hydratePromptBundle);
  const bundleVersions = (await loadAll("prompt_bundle_version", env, { orderBy: "created_at", ascending: true })).map(hydratePromptBundleVersion);
  const recipes = (await loadAll("render_recipe", env, { orderBy: "created_at", ascending: true })).map(hydrateRenderRecipe);
  const recipeVersions = (await loadAll("render_recipe_version", env, { orderBy: "created_at", ascending: true })).map(hydrateRenderRecipeVersion);
  const deployments = await loadPromptDeployments(env);
  return { providers, models, routePolicies, promptTemplates, promptVersions, bundles, bundleVersions, recipes, recipeVersions, deployments };
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

export async function loadShops(env?: AppEnv) {
  const rows = await loadAll("shop", env, { orderBy: "installed_at", ascending: false });
  return memoryFallback(repository.shops.values(), rows, env) ?? rows.map(hydrateShop);
}

export async function loadAiInvocations(limit = 500, env?: AppEnv) {
  const rows = await loadAll("ai_invocation", env, { orderBy: "created_at", ascending: false, limit });
  return memoryFallback(repository.aiInvocations.values(), rows, env) ?? rows.map(hydrateAiInvocation);
}

export async function loadPromptDeployments(env?: AppEnv) {
  const rows = await loadAll("prompt_deployment", env, { orderBy: "started_at", ascending: false });
  return memoryFallback(repository.deployments.values(), rows, env) ?? rows.map(hydratePromptDeployment);
}

export async function loadFounderRenderRequests(limit = 200, env?: AppEnv) {
  const rows = await loadAll("render_request", env, { orderBy: "created_at", ascending: false, limit });
  return memoryFallback(repository.renderRequests.values(), rows, env) ?? rows.map(hydrateRenderRequest);
}

export async function loadRenderBundle(renderRequestId: string, env?: AppEnv) {
  const request = await loadRenderRequestById(renderRequestId, env);
  if (!request) {
    return undefined;
  }
  const [attemptRows, assetRows, invocationRows, traceRows, feedbackRows, reviewRows] = await Promise.all([
    loadMany("render_attempt", "render_request_id", request.id, env),
    loadMany("render_asset", "render_request_id", request.id, env),
    loadMany("ai_invocation", "trace_id", request.traceId, env),
    loadMany("render_trace_event", "trace_id", request.traceId, env),
    loadMany("render_feedback", "render_request_id", request.id, env),
    loadMany("manual_review", "render_request_id", request.id, env)
  ]);
  attemptRows.map(hydrateRenderAttempt);
  assetRows.map(hydrateRenderAsset);
  invocationRows.map(hydrateAiInvocation);
  traceRows.map(hydrateTraceEvent);
  feedbackRows.map(hydrateRenderFeedback);
  const manualReviews = reviewRows.map(hydrateManualReview);
  return { ...repository.renderBundleForRequest(request.id), manualReviews };
}

export async function loadEvalOverview(env?: AppEnv) {
  const [datasetRows, caseRows, runRows, resultRows] = await Promise.all([
    loadAll("eval_dataset", env, { orderBy: "created_at", ascending: false }),
    loadAll("eval_case", env, { orderBy: "created_at", ascending: false }),
    loadAll("eval_run", env, { orderBy: "created_at", ascending: false }),
    loadAll("eval_result", env, { orderBy: "created_at", ascending: false })
  ]);
  return {
    datasets: memoryFallback(repository.evalDatasets.values(), datasetRows, env) ?? datasetRows.map(hydrateEvalDataset),
    cases: memoryFallback(repository.evalCases.values(), caseRows, env) ?? caseRows.map(hydrateEvalCase),
    runs: memoryFallback(repository.evalRuns.values(), runRows, env) ?? runRows.map(hydrateEvalRun),
    results: memoryFallback(repository.evalResults.values(), resultRows, env) ?? resultRows.map(hydrateEvalResult)
  };
}

export async function loadManualReviews(limit = 200, env?: AppEnv) {
  const rows = await loadAll("manual_review", env, { orderBy: "created_at", ascending: false, limit });
  return memoryFallback(repository.manualReviews.values(), rows, env) ?? rows.map(hydrateManualReview);
}

export async function loadAuditLogs(limit = 200, env?: AppEnv) {
  const rows = await loadAll("audit_log", env, { orderBy: "created_at", ascending: false, limit });
  return memoryFallback(repository.auditLogs.values(), rows, env) ?? rows.map(hydrateAuditLog);
}

export async function loadUsageMonthly(limit = 200, env?: AppEnv): Promise<Record<string, unknown>[]> {
  return loadAll("usage_monthly", env, { orderBy: "updated_at", ascending: false, limit });
}

export async function loadOutreachOverview(limit = 200, env?: AppEnv): Promise<{ prospects: Record<string, unknown>[]; suppressions: Record<string, unknown>[] }> {
  const [prospects, suppressions] = await Promise.all([
    loadAll("prospect", env, { orderBy: "updated_at", ascending: false, limit }),
    loadAll("suppression", env, { orderBy: "created_at", ascending: false, limit })
  ]);
  return { prospects, suppressions };
}

export async function loadEvalRunBundle(evalRunId: string, env?: AppEnv) {
  await loadEvalOverview(env);
  const run = repository.evalRuns.get(evalRunId);
  if (!run) {
    return undefined;
  }
  return {
    run,
    dataset: repository.evalDatasets.get(run.evalDatasetId),
    results: [...repository.evalResults.values()].filter((result) => result.evalRunId === run.id)
  };
}

export async function loadExperimentOverview(env?: AppEnv) {
  const [experimentRows, armRows, assignmentRows] = await Promise.all([
    loadAll("ai_experiment", env, { orderBy: "created_at", ascending: false }),
    loadAll("ai_experiment_arm", env, { orderBy: "created_at", ascending: false }),
    loadAll("ai_experiment_assignment", env, { orderBy: "created_at", ascending: false })
  ]);
  return {
    experiments: memoryFallback(repository.experiments.values(), experimentRows, env) ?? experimentRows.map(hydrateExperiment),
    arms: memoryFallback(repository.experimentArms.values(), armRows, env) ?? armRows.map(hydrateExperimentArm),
    assignments: memoryFallback(repository.experimentAssignments.values(), assignmentRows, env) ?? assignmentRows.map(hydrateExperimentAssignment)
  };
}

export async function loadExperimentById(experimentId: string, env?: AppEnv) {
  const overview = await loadExperimentOverview(env);
  const experiment = repository.experiments.get(experimentId) ?? overview.experiments.find((item) => item.id === experimentId);
  if (!experiment) {
    return undefined;
  }
  return {
    experiment,
    arms: [...repository.experimentArms.values()].filter((arm) => arm.experimentId === experiment.id),
    assignments: [...repository.experimentAssignments.values()].filter((assignment) => assignment.experimentId === experiment.id)
  };
}

export async function loadFounderDashboardData(env?: AppEnv) {
  const [renders, invocations, deployments, experiments, shops] = await Promise.all([
    loadFounderRenderRequests(500, env),
    loadAiInvocations(500, env),
    loadPromptDeployments(env),
    loadExperimentOverview(env).then((overview) => overview.experiments),
    loadShops(env)
  ]);
  return { renders, invocations, deployments, experiments, shops };
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

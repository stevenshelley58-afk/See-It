import { randomUUID } from "node:crypto";
import type {
  AiInvocationRecord,
  AiModelRecord,
  AiProviderRecord,
  AuditLogRecord,
  EventLogRecord,
  JobRecord,
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
  ShopRecord,
  UUID
} from "@/lib/db/schema";

function now() {
  return new Date().toISOString();
}

function id() {
  return randomUUID();
}

export class InMemoryRepository {
  shops = new Map<UUID, ShopRecord>();
  products = new Map<UUID, ProductSetupRecord>();
  providers = new Map<UUID, AiProviderRecord>();
  models = new Map<UUID, AiModelRecord>();
  routePolicies = new Map<UUID, ModelRoutePolicyRecord>();
  promptTemplates = new Map<UUID, PromptTemplateRecord>();
  promptVersions = new Map<UUID, PromptVersionRecord>();
  bundles = new Map<UUID, PromptBundleRecord>();
  bundleVersions = new Map<UUID, PromptBundleVersionRecord>();
  recipes = new Map<UUID, RenderRecipeRecord>();
  recipeVersions = new Map<UUID, RenderRecipeVersionRecord>();
  deployments = new Map<UUID, PromptDeploymentRecord>();
  roomSessions = new Map<UUID, RoomSessionRecord>();
  renderRequests = new Map<UUID, RenderRequestRecord>();
  renderAttempts = new Map<UUID, RenderAttemptRecord>();
  aiInvocations = new Map<UUID, AiInvocationRecord>();
  renderAssets = new Map<UUID, RenderAssetRecord>();
  traceEvents = new Map<UUID, RenderTraceEventRecord>();
  feedback = new Map<UUID, RenderFeedbackRecord>();
  jobs = new Map<UUID, JobRecord>();
  eventLogs = new Map<UUID, EventLogRecord>();
  auditLogs = new Map<UUID, AuditLogRecord>();

  reset() {
    for (const value of Object.values(this)) {
      if (value instanceof Map) {
        value.clear();
      }
    }
  }

  upsertProvider(input: Omit<AiProviderRecord, "id"> & { id?: UUID }) {
    const existing = [...this.providers.values()].find((provider) => provider.providerKey === input.providerKey);
    const record: AiProviderRecord = { ...input, id: input.id ?? existing?.id ?? id() };
    this.providers.set(record.id, record);
    return record;
  }

  upsertModel(input: Omit<AiModelRecord, "id"> & { id?: UUID }) {
    const existing = [...this.models.values()].find((model) => model.providerKey === input.providerKey && model.modelKey === input.modelKey && model.modelVersion === input.modelVersion);
    const record: AiModelRecord = { ...input, id: input.id ?? existing?.id ?? id() };
    this.models.set(record.id, record);
    return record;
  }

  upsertRoutePolicy(input: Omit<ModelRoutePolicyRecord, "id"> & { id?: UUID }) {
    const record: ModelRoutePolicyRecord = { ...input, id: input.id ?? id() };
    this.routePolicies.set(record.id, record);
    return record;
  }

  createPromptTemplate(input: Omit<PromptTemplateRecord, "id"> & { id?: UUID }) {
    const record: PromptTemplateRecord = { ...input, id: input.id ?? id() };
    this.promptTemplates.set(record.id, record);
    return record;
  }

  createPromptVersion(input: Omit<PromptVersionRecord, "id"> & { id?: UUID }) {
    const record: PromptVersionRecord = { ...input, id: input.id ?? id() };
    this.promptVersions.set(record.id, record);
    return record;
  }

  updatePromptVersion(idValue: UUID, patch: Partial<PromptVersionRecord>) {
    const current = this.mustGet(this.promptVersions, idValue, "prompt_version");
    const next = { ...current, ...patch };
    this.promptVersions.set(idValue, next);
    return next;
  }

  createBundle(input: Omit<PromptBundleRecord, "id"> & { id?: UUID }) {
    const record: PromptBundleRecord = { ...input, id: input.id ?? id() };
    this.bundles.set(record.id, record);
    return record;
  }

  createBundleVersion(input: Omit<PromptBundleVersionRecord, "id"> & { id?: UUID }) {
    const record: PromptBundleVersionRecord = { ...input, id: input.id ?? id() };
    this.bundleVersions.set(record.id, record);
    return record;
  }

  createRecipe(input: Omit<RenderRecipeRecord, "id"> & { id?: UUID }) {
    const record: RenderRecipeRecord = { ...input, id: input.id ?? id() };
    this.recipes.set(record.id, record);
    return record;
  }

  createRecipeVersion(input: Omit<RenderRecipeVersionRecord, "id"> & { id?: UUID }) {
    const record: RenderRecipeVersionRecord = { ...input, id: input.id ?? id() };
    this.recipeVersions.set(record.id, record);
    return record;
  }

  createDeployment(input: Omit<PromptDeploymentRecord, "id" | "startedAt"> & { id?: UUID; startedAt?: string }) {
    const record: PromptDeploymentRecord = { ...input, id: input.id ?? id(), startedAt: input.startedAt ?? now() };
    this.deployments.set(record.id, record);
    return record;
  }

  rollbackDeployment(deploymentId: UUID, actor: string, reason: string) {
    const current = this.mustGet(this.deployments, deploymentId, "prompt_deployment");
    const ended = { ...current, status: "rolled_back" as const, endedAt: now() };
    this.deployments.set(current.id, ended);
    this.audit(actor, "rollback", "prompt_deployment", current.id, current, ended, reason);
    return ended;
  }

  createShop(input: Omit<ShopRecord, "id" | "installedAt"> & { id?: UUID; installedAt?: string }) {
    const record: ShopRecord = { ...input, id: input.id ?? id(), installedAt: input.installedAt ?? now() };
    this.shops.set(record.id, record);
    return record;
  }

  createProduct(input: Omit<ProductSetupRecord, "id"> & { id?: UUID }) {
    const record: ProductSetupRecord = { ...input, id: input.id ?? id() };
    this.products.set(record.id, record);
    return record;
  }

  createRoomSession(input: Omit<RoomSessionRecord, "id"> & { id?: UUID }) {
    const record: RoomSessionRecord = { ...input, id: input.id ?? id() };
    this.roomSessions.set(record.id, record);
    return record;
  }

  updateRoomSession(idValue: UUID, patch: Partial<RoomSessionRecord>) {
    const current = this.mustGet(this.roomSessions, idValue, "room_session");
    const next = { ...current, ...patch };
    this.roomSessions.set(idValue, next);
    return next;
  }

  createRenderRequest(input: Omit<RenderRequestRecord, "id" | "createdAt" | "attemptCount" | "remainingRefinements"> & { id?: UUID; createdAt?: string; attemptCount?: number; remainingRefinements?: number }) {
    const record: RenderRequestRecord = {
      ...input,
      id: input.id ?? id(),
      createdAt: input.createdAt ?? now(),
      attemptCount: input.attemptCount ?? 0,
      remainingRefinements: input.remainingRefinements ?? 3
    };
    this.renderRequests.set(record.id, record);
    return record;
  }

  updateRenderRequest(idValue: UUID, patch: Partial<RenderRequestRecord>) {
    const current = this.mustGet(this.renderRequests, idValue, "render_request");
    const next = { ...current, ...patch };
    this.renderRequests.set(idValue, next);
    return next;
  }

  createRenderAttempt(input: Omit<RenderAttemptRecord, "id"> & { id?: UUID }) {
    const record: RenderAttemptRecord = { ...input, id: input.id ?? id() };
    this.renderAttempts.set(record.id, record);
    return record;
  }

  updateRenderAttempt(idValue: UUID, patch: Partial<RenderAttemptRecord>) {
    const current = this.mustGet(this.renderAttempts, idValue, "render_attempt");
    const next = { ...current, ...patch };
    this.renderAttempts.set(idValue, next);
    return next;
  }

  createAiInvocation(input: Omit<AiInvocationRecord, "id" | "createdAt"> & { id?: UUID; createdAt?: string }) {
    const duplicate = [...this.aiInvocations.values()].find((record) => record.idempotencyKey === input.idempotencyKey);
    if (duplicate) {
      return duplicate;
    }
    const record: AiInvocationRecord = { ...input, id: input.id ?? id(), createdAt: input.createdAt ?? now() };
    this.aiInvocations.set(record.id, record);
    return record;
  }

  updateAiInvocation(idValue: UUID, patch: Partial<AiInvocationRecord>) {
    const current = this.mustGet(this.aiInvocations, idValue, "ai_invocation");
    const next = { ...current, ...patch };
    this.aiInvocations.set(idValue, next);
    return next;
  }

  createRenderAsset(input: Omit<RenderAssetRecord, "id"> & { id?: UUID }) {
    const record: RenderAssetRecord = { ...input, id: input.id ?? id() };
    this.renderAssets.set(record.id, record);
    return record;
  }

  trace(input: Omit<RenderTraceEventRecord, "id" | "createdAt"> & { id?: UUID; createdAt?: string }) {
    const record: RenderTraceEventRecord = { ...input, id: input.id ?? id(), createdAt: input.createdAt ?? now() };
    this.traceEvents.set(record.id, record);
    return record;
  }

  createFeedback(input: Omit<RenderFeedbackRecord, "id"> & { id?: UUID }) {
    const record: RenderFeedbackRecord = { ...input, id: input.id ?? id() };
    this.feedback.set(record.id, record);
    return record;
  }

  enqueueJob(input: Omit<JobRecord, "id" | "status" | "createdAt" | "attemptCount"> & { id?: UUID; status?: JobRecord["status"]; createdAt?: string; attemptCount?: number }) {
    const duplicate = [...this.jobs.values()].find((job) => job.idempotencyKey === input.idempotencyKey);
    if (duplicate) {
      return duplicate;
    }
    const record: JobRecord = { ...input, id: input.id ?? id(), status: input.status ?? "queued", attemptCount: input.attemptCount ?? 0, createdAt: input.createdAt ?? now() };
    this.jobs.set(record.id, record);
    return record;
  }

  leaseJobs(owner: string, limit = 10, leaseMs = 60000) {
    const nowMs = Date.now();
    const jobs = [...this.jobs.values()]
      .filter((job) => job.status === "queued" && new Date(job.runAfter).getTime() <= nowMs)
      .sort((a, b) => a.priority - b.priority)
      .slice(0, limit)
      .map((job) => {
        const leased = { ...job, status: "leased" as const, leaseOwner: owner, leasedUntil: new Date(nowMs + leaseMs).toISOString(), attemptCount: job.attemptCount + 1 };
        this.jobs.set(job.id, leased);
        return leased;
      });
    return jobs;
  }

  completeJob(jobId: UUID) {
    const current = this.mustGet(this.jobs, jobId, "job");
    const next = { ...current, status: "succeeded" as const, completedAt: now() };
    this.jobs.set(jobId, next);
    return next;
  }

  failJob(jobId: UUID, code: string, message: string) {
    const current = this.mustGet(this.jobs, jobId, "job");
    const terminal = current.attemptCount >= current.maxAttempts;
    const next = {
      ...current,
      status: terminal ? "dead" as const : "queued" as const,
      lastErrorCode: code,
      lastErrorMessage: message,
      runAfter: new Date(Date.now() + 1000 * current.attemptCount).toISOString()
    };
    this.jobs.set(jobId, next);
    return next;
  }

  cancelJobsForShop(shopId: UUID) {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.payload.shopId === shopId && ["queued", "leased", "running"].includes(job.status)) {
        this.jobs.set(job.id, { ...job, status: "cancelled" });
        count += 1;
      }
    }
    return count;
  }

  event(input: Omit<EventLogRecord, "id" | "ts"> & { id?: UUID; ts?: string }) {
    const record: EventLogRecord = { ...input, id: input.id ?? id(), ts: input.ts ?? now() };
    this.eventLogs.set(record.id, record);
    return record;
  }

  audit(actor: string, action: string, entityType: string, entityId: UUID | undefined, before: unknown, after: unknown, reason?: string) {
    const record: AuditLogRecord = { id: id(), actor, action, entityType, entityId, before, after, reason, createdAt: now() };
    this.auditLogs.set(record.id, record);
    return record;
  }

  findActiveDeployment(surface: string, taskType?: string) {
    return [...this.deployments.values()].find((deployment) => deployment.status === "active" && deployment.surface === surface && (!taskType || !deployment.taskType || deployment.taskType === taskType));
  }

  renderBundleForRequest(renderRequestId: UUID) {
    const request = this.mustGet(this.renderRequests, renderRequestId, "render_request");
    const attempts = [...this.renderAttempts.values()].filter((attempt) => attempt.renderRequestId === request.id);
    const assets = [...this.renderAssets.values()].filter((asset) => asset.renderRequestId === request.id);
    const trace = [...this.traceEvents.values()].filter((event) => event.renderRequestId === request.id || event.traceId === request.traceId);
    const invocations = [...this.aiInvocations.values()].filter((invocation) => invocation.traceId === request.traceId);
    const feedback = [...this.feedback.values()].filter((item) => item.renderRequestId === request.id);
    return { request, attempts, assets, trace, invocations, feedback };
  }

  mustGet<T>(map: Map<UUID, T>, idValue: UUID, name: string): T {
    const value = map.get(idValue);
    if (!value) {
      throw new Error(name + " not found: " + idValue);
    }
    return value;
  }
}

export const repository = new InMemoryRepository();

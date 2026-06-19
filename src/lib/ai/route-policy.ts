import type { AiTaskType } from "@/lib/ai/types";
import { ensureAiRegistrySeeded, findModel } from "@/lib/ai/registry";
import { repository } from "@/lib/db/repository";
import type { ModelRoutePolicyRecord, Surface } from "@/lib/db/schema";

export function resolveRoutePolicy(surface: Surface, taskType: AiTaskType): ModelRoutePolicyRecord {
  ensureAiRegistrySeeded();
  const policy = [...repository.routePolicies.values()].find((item) => item.status === "active" && item.surface === surface && item.taskType === taskType);
  if (!policy) {
    throw new Error("No active model route policy for " + surface + "/" + taskType);
  }
  return policy;
}

export function selectModelRoute(policy: ModelRoutePolicyRecord, lastErrorCode?: string, gateFailed = false) {
  const candidates = gateFailed
    ? policy.policy.escalation
    : lastErrorCode
      ? policy.policy.fallbacks.filter((fallback) => !fallback.onErrorCodes || fallback.onErrorCodes.includes(lastErrorCode))
      : policy.policy.primary;
  for (const candidate of candidates) {
    const model = findModel(candidate.providerKey, candidate.modelKey);
    const provider = [...repository.providers.values()].find((item) => item.providerKey === candidate.providerKey);
    if (model && provider && provider.status === "enabled" && model.status === "enabled" && model.allowedTasks.includes(policy.taskType)) {
      return { provider, model };
    }
  }
  throw new Error("No enabled model route available for policy " + policy.name);
}

import { seedAiControlPlane } from "@/lib/ai/bootstrap";
import type { AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import { customHttpAdapter } from "@/lib/ai/providers/custom-http";
import { fluxAdapter } from "@/lib/ai/providers/flux";
import { geminiAdapter } from "@/lib/ai/providers/gemini";
import { ideogramAdapter } from "@/lib/ai/providers/ideogram";
import { localAdapter } from "@/lib/ai/providers/local";
import { openaiAdapter } from "@/lib/ai/providers/openai";
import { reveAdapter } from "@/lib/ai/providers/reve";
import { repository } from "@/lib/db/repository";

export const providerAdapters: Record<string, AiProviderAdapter> = {
  local: localAdapter,
  gemini: geminiAdapter,
  openai: openaiAdapter,
  "custom-http": customHttpAdapter,
  flux: fluxAdapter,
  ideogram: ideogramAdapter,
  reve: reveAdapter
};

export function ensureAiRegistrySeeded() {
  seedAiControlPlane(repository);
}

export function listProviders() {
  ensureAiRegistrySeeded();
  return [...repository.providers.values()];
}

export function listModels() {
  ensureAiRegistrySeeded();
  return [...repository.models.values()];
}

export function findModel(providerKey: string, modelKey: string) {
  ensureAiRegistrySeeded();
  return [...repository.models.values()].find((model) => model.providerKey === providerKey && model.modelKey === modelKey);
}

export function getAdapter(providerKey: string) {
  const adapter = providerAdapters[providerKey];
  if (!adapter) {
    throw new Error("No adapter registered for provider " + providerKey);
  }
  return adapter;
}

export function providerContractMatrix(taskType: AiTaskType) {
  ensureAiRegistrySeeded();
  return listModels().map((model) => ({
    providerKey: model.providerKey,
    modelKey: model.modelKey,
    adapterExists: Boolean(providerAdapters[model.providerKey]),
    supportsTask: model.allowedTasks.includes(taskType),
    enabled: model.status === "enabled"
  }));
}

import type { AiModelRecord } from "@/lib/db/schema";
import type { AiTaskType } from "@/lib/ai/types";

export function hasCapabilities(model: AiModelRecord, capabilities: string[]) {
  return capabilities.every((capability) => model.capabilities.includes(capability));
}

export function supportsTask(model: AiModelRecord, taskType: AiTaskType) {
  return model.status === "enabled" && model.allowedTasks.includes(taskType);
}

export function assertModelCapability(model: AiModelRecord, taskType: AiTaskType, capabilities: string[]) {
  if (!supportsTask(model, taskType)) {
    throw new Error("Model " + model.modelKey + " does not support task " + taskType);
  }
  const missing = capabilities.filter((capability) => !model.capabilities.includes(capability));
  if (missing.length > 0) {
    throw new Error("Model " + model.modelKey + " missing capabilities: " + missing.join(", "));
  }
}

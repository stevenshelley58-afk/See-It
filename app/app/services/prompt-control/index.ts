// =============================================================================
// PROMPT CONTROL PLANE - Main Exports
// =============================================================================

// Resolver
export {
  SYSTEM_TENANT_ID,
  resolvePrompt,
  buildResolvedConfigSnapshot,
  loadRuntimeConfig,
  computeRequestHash,
  renderTemplate,
  resolveDotPath,
  type PromptMessage,
  type PromptOverride,
  type ResolvedPrompt,
  type RuntimeConfigSnapshot,
  type ResolvedConfigSnapshot,
} from "./prompt-resolver.server";

// Version Management
export {
  createPromptDefinition,
  createVersion,
  activateVersion,
  rollbackToPreviousVersion,
  archiveVersion,
  getPromptWithVersions,
  listPromptsForShop,
  type CreatePromptDefinitionInput,
  type CreateVersionInput,
  type ActivateVersionInput,
} from "./prompt-version-manager.server";

// LLM Call Tracking
export {
  startCall,
  completeCallSuccess,
  completeCallFailure,
  trackedCall,
  getCallsForRun,
  getCallsForTestRun,
  getDailyCostForShop,
  findCachedByDedupeHash,
  // Legacy wrappers (deprecated)
  startLLMCall,
  completeLLMCall,
  type StartCallInput,
  type CompleteCallSuccessInput,
  type CompleteCallFailureInput,
} from "./llm-call-tracker.server";

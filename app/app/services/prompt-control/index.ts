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
  startLLMCall,
  completeLLMCall,
  trackedLLMCall,
  getCallsForRun,
  getCallsForTestRun,
  getPromptCallStats,
  getDailyCostForShop,
  // Deduplication/caching
  getRequestHash,
  findCachedRender,
  recordCacheHit,
  updateLLMCallWithOutput,
  findRecentCallForRun,
  type StartLLMCallInput,
  type CompleteLLMCallInput,
  type PromptStats,
  type CachedRenderResult,
  // Legacy type aliases
  type StartCallInput,
  type CompleteCallInput,
} from "./llm-call-tracker.server";

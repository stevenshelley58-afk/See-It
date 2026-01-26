-- =============================================================================
-- Drop llm_calls prompt_key CHECK constraint
-- Prompt keys must be extensible (no DB-level enumeration lock-in).
-- =============================================================================

ALTER TABLE "llm_calls"
  DROP CONSTRAINT IF EXISTS "llm_calls_prompt_key_chk";


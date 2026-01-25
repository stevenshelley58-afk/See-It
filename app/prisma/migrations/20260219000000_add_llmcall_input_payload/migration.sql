-- =============================================================================
-- Add LLMCall.input_payload for full request visibility
-- =============================================================================

ALTER TABLE "llm_calls"
ADD COLUMN IF NOT EXISTS "input_payload" JSONB;


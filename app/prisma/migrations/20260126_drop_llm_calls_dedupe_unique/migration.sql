-- =============================================================================
-- Drop unique constraint on llm_calls(shop_id, dedupe_hash)
-- llm_calls is telemetry, not a cache. Telemetry must allow duplicates.
-- =============================================================================

-- Drop the UNIQUE partial index (try all common naming variants)
DROP INDEX IF EXISTS "ux_llm_calls_shop_dedupe_hash";
DROP INDEX IF EXISTS "llm_calls_shop_id_dedupe_hash_key";
DROP INDEX IF EXISTS "ux_llm_calls_shop_dedupe_hash_unique";
DROP INDEX IF EXISTS "llm_calls_shop_id_dedupe_hash_idx_unique";

-- Create a NON-unique partial index for lookup speed (telemetry only)
CREATE INDEX IF NOT EXISTS "idx_llm_calls_shop_dedupe_hash"
  ON "llm_calls" ("shop_id", "dedupe_hash")
  WHERE "dedupe_hash" IS NOT NULL;

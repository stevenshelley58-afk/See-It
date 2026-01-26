-- =============================================================================
-- FAIL-HARD PRODUCTION RESET (DESTRUCTIVE)
--
-- Intent:
-- - Complete delete of all previous runs and data.
-- - Post-reset, the system behaves like a brand-new install (nothing should work
--   until required bootstrap flows recreate data).
--
-- Notes:
-- - This intentionally wipes the SYSTEM seed tenant/prompts as well (if present).
-- - This keeps schema + _prisma_migrations intact.
-- =============================================================================

BEGIN;

-- Shopify sessions are not FK'd to shops; truncate explicitly.
TRUNCATE TABLE "Session";

-- Truncate all app tables (explicit list for safety).
-- Order doesn't matter with CASCADE, but listing everything makes intent obvious.
TRUNCATE TABLE
  "monitor_artifacts",
  "monitor_events",
  "composite_variants",
  "composite_runs",
  "prep_events",
  "see_it_captures",
  "saved_room_owners",
  "saved_rooms",
  "render_jobs",
  "room_sessions",
  "product_assets",
  "usage_daily",
  "prompt_audit_log",
  "prompt_test_runs",
  "prompt_control_versions",
  "prompt_definitions",
  "shop_runtime_configs",
  "llm_calls",
  "shops"
CASCADE;

COMMIT;


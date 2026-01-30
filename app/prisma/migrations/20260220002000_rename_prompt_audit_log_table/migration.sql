-- Rename prompt audit log table to pluralized form for consistency
ALTER TABLE "prompt_audit_log" RENAME TO "prompt_audit_logs";

-- Rename existing indexes if they exist (best-effort; ignore if absent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'prompt_audit_log_shop_id_created_at_idx') THEN
    EXECUTE 'ALTER INDEX "prompt_audit_log_shop_id_created_at_idx" RENAME TO "prompt_audit_logs_shop_id_created_at_idx"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'prompt_audit_log_shop_id_target_type_target_id_idx') THEN
    EXECUTE 'ALTER INDEX "prompt_audit_log_shop_id_target_type_target_id_idx" RENAME TO "prompt_audit_logs_shop_id_target_type_target_id_idx"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'prompt_audit_log_shop_id_action_idx') THEN
    EXECUTE 'ALTER INDEX "prompt_audit_log_shop_id_action_idx" RENAME TO "prompt_audit_logs_shop_id_action_idx"';
  END IF;
END $$;

-- Add previous_active_version_id column to prompt_control_versions table
-- This tracks the activation chain for reliable rollback functionality

ALTER TABLE "prompt_control_versions"
ADD COLUMN IF NOT EXISTS "previous_active_version_id" TEXT;

-- Add index for efficient lookups when following the rollback chain
CREATE INDEX IF NOT EXISTS "prompt_control_versions_previous_active_version_id_idx"
ON "prompt_control_versions"("previous_active_version_id");

-- See It Now v2 pipeline: facts + prompt pack + monitoring tables
-- Safe migration (idempotent) using IF NOT EXISTS checks.

-- ============================================================================
-- product_assets: v2 pipeline columns
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_assets' AND column_name = 'extracted_facts'
    ) THEN
        ALTER TABLE "product_assets" ADD COLUMN "extracted_facts" JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_assets' AND column_name = 'merchant_overrides'
    ) THEN
        ALTER TABLE "product_assets" ADD COLUMN "merchant_overrides" JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_assets' AND column_name = 'resolved_facts'
    ) THEN
        ALTER TABLE "product_assets" ADD COLUMN "resolved_facts" JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_assets' AND column_name = 'prompt_pack'
    ) THEN
        ALTER TABLE "product_assets" ADD COLUMN "prompt_pack" JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_assets' AND column_name = 'prompt_pack_version'
    ) THEN
        ALTER TABLE "product_assets" ADD COLUMN "prompt_pack_version" INTEGER NOT NULL DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_assets' AND column_name = 'extracted_at'
    ) THEN
        ALTER TABLE "product_assets" ADD COLUMN "extracted_at" TIMESTAMP(3);
    END IF;
END $$;

-- ============================================================================
-- prompt_versions: prompt config history (used by render_runs)
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'prompt_versions'
    ) THEN
        CREATE TABLE "prompt_versions" (
            "id" TEXT NOT NULL,
            "version" INTEGER NOT NULL,
            "extractor_prompt_hash" TEXT NOT NULL,
            "builder_prompt_hash" TEXT NOT NULL,
            "global_prompt_hash" TEXT NOT NULL,
            "variant_intents_hash" TEXT NOT NULL,
            "material_behaviors_hash" TEXT NOT NULL,
            "scale_guardrails_hash" TEXT NOT NULL,
            "config_snapshot" JSONB NOT NULL,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
        );

        CREATE UNIQUE INDEX "prompt_versions_version_key" ON "prompt_versions"("version");
    END IF;
END $$;

-- ============================================================================
-- render_runs: one per See It Now render request
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'render_runs'
    ) THEN
        CREATE TABLE "render_runs" (
            "id" TEXT NOT NULL,
            "shop_id" TEXT NOT NULL,
            "product_asset_id" TEXT NOT NULL,
            "room_session_id" TEXT,
            "request_id" TEXT NOT NULL,

            "prompt_pack_version" INTEGER NOT NULL,
            "model" TEXT NOT NULL,

            "product_image_hash" TEXT NOT NULL,
            "product_image_meta" JSONB NOT NULL,
            "room_image_hash" TEXT NOT NULL,
            "room_image_meta" JSONB NOT NULL,

            "resolved_facts_hash" TEXT NOT NULL,
            "resolved_facts_json" JSONB NOT NULL,
            "prompt_pack_hash" TEXT NOT NULL,
            "prompt_pack_json" JSONB NOT NULL,

            "total_duration_ms" INTEGER,
            "status" TEXT NOT NULL,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "render_runs_pkey" PRIMARY KEY ("id")
        );

        ALTER TABLE "render_runs"
            ADD CONSTRAINT "render_runs_shop_id_fkey"
            FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;

        ALTER TABLE "render_runs"
            ADD CONSTRAINT "render_runs_product_asset_id_fkey"
            FOREIGN KEY ("product_asset_id") REFERENCES "product_assets"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;

        -- prompt_pack_version references PromptVersion.version (unique)
        ALTER TABLE "render_runs"
            ADD CONSTRAINT "render_runs_prompt_pack_version_fkey"
            FOREIGN KEY ("prompt_pack_version") REFERENCES "prompt_versions"("version")
            ON DELETE RESTRICT ON UPDATE CASCADE;

        CREATE INDEX "render_runs_shop_id_created_at_idx" ON "render_runs"("shop_id", "created_at");
        CREATE INDEX "render_runs_product_asset_id_idx" ON "render_runs"("product_asset_id");
        CREATE INDEX "render_runs_prompt_pack_version_idx" ON "render_runs"("prompt_pack_version");
        CREATE INDEX "render_runs_status_idx" ON "render_runs"("status");
    END IF;
END $$;

-- ============================================================================
-- variant_results: one per variant per render run
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'variant_results'
    ) THEN
        CREATE TABLE "variant_results" (
            "id" TEXT NOT NULL,
            "render_run_id" TEXT NOT NULL,
            "variant_id" TEXT NOT NULL,
            "final_prompt_hash" TEXT NOT NULL,
            "status" TEXT NOT NULL,
            "latency_ms" INTEGER,
            "output_image_key" TEXT,
            "output_image_hash" TEXT,
            "error_message" TEXT,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "variant_results_pkey" PRIMARY KEY ("id")
        );

        ALTER TABLE "variant_results"
            ADD CONSTRAINT "variant_results_render_run_id_fkey"
            FOREIGN KEY ("render_run_id") REFERENCES "render_runs"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;

        CREATE INDEX "variant_results_render_run_id_idx" ON "variant_results"("render_run_id");
        CREATE INDEX "variant_results_variant_id_idx" ON "variant_results"("variant_id");
        CREATE INDEX "variant_results_status_idx" ON "variant_results"("status");
    END IF;
END $$;


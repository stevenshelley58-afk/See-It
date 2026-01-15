-- Add See It Now per-product prompt fields to product_assets
-- These fields enable per-product LLM-generated prompts and variants

DO $$
BEGIN
    -- Add generated_see_it_now_prompt column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'generated_see_it_now_prompt') THEN
        ALTER TABLE "product_assets" ADD COLUMN "generated_see_it_now_prompt" TEXT;
    END IF;

    -- Add see_it_now_variants column (JSON array of {id, prompt})
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'see_it_now_variants') THEN
        ALTER TABLE "product_assets" ADD COLUMN "see_it_now_variants" JSONB;
    END IF;

    -- Add detected_archetype column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'detected_archetype') THEN
        ALTER TABLE "product_assets" ADD COLUMN "detected_archetype" TEXT;
    END IF;

    -- Add use_generated_prompt column (defaults to false)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'use_generated_prompt') THEN
        ALTER TABLE "product_assets" ADD COLUMN "use_generated_prompt" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

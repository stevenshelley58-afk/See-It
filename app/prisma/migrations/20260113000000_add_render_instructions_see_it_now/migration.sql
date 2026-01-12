-- Add render_instructions_see_it_now column to product_assets
-- This stores custom AI instructions for See It Now hero shot renders

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'render_instructions_see_it_now') THEN
        ALTER TABLE "product_assets" ADD COLUMN "render_instructions_see_it_now" TEXT;
    END IF;
END $$;

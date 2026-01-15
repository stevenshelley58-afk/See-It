-- Add product prep placement rule fields if they don't exist
-- This migration is safe to run even if columns already exist

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'scene_role') THEN
        ALTER TABLE "product_assets" ADD COLUMN "scene_role" TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'replacement_rule') THEN
        ALTER TABLE "product_assets" ADD COLUMN "replacement_rule" TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_assets' AND column_name = 'allow_space_creation') THEN
        ALTER TABLE "product_assets" ADD COLUMN "allow_space_creation" BOOLEAN;
    END IF;
END $$;

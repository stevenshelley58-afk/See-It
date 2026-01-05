-- Add Gemini Files API columns for pre-upload optimization
-- Files uploaded to Gemini expire after 48 hours

-- Add to ProductAsset (new columns)
ALTER TABLE "product_assets" ADD COLUMN IF NOT EXISTS "gemini_file_uri" TEXT;
ALTER TABLE "product_assets" ADD COLUMN IF NOT EXISTS "gemini_file_expires_at" TIMESTAMP;

-- Add expiry tracking to RoomSession (uri column already exists)
ALTER TABLE "room_sessions" ADD COLUMN IF NOT EXISTS "gemini_file_expires_at" TIMESTAMP;

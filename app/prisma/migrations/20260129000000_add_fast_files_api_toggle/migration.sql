-- Add per-shop runtime toggle to skip GCS downloads when cached Gemini Files API URI is still valid
ALTER TABLE "shop_runtime_configs"
ADD COLUMN "skip_gcs_download_when_gemini_uri_valid" BOOLEAN NOT NULL DEFAULT false;


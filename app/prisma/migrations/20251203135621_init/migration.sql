-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop_domain" TEXT NOT NULL,
    "shopify_shop_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "monthly_quota" INTEGER NOT NULL,
    "daily_quota" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" DATETIME
);

-- CreateTable
CREATE TABLE "product_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "source_image_id" TEXT NOT NULL,
    "source_image_url" TEXT NOT NULL,
    "prepared_image_url" TEXT,
    "status" TEXT NOT NULL,
    "prep_strategy" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "product_assets_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "room_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop_id" TEXT NOT NULL,
    "original_room_image_url" TEXT,
    "cleaned_room_image_url" TEXT,
    "gemini_file_uri" TEXT,
    "created_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "last_used_at" DATETIME,
    CONSTRAINT "room_sessions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "render_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "product_asset_id" TEXT,
    "room_session_id" TEXT,
    "placement_x" REAL NOT NULL,
    "placement_y" REAL NOT NULL,
    "placement_scale" REAL NOT NULL,
    "style_preset" TEXT,
    "quality" TEXT,
    "config_json" TEXT,
    "status" TEXT NOT NULL,
    "image_url" TEXT,
    "model_id" TEXT,
    "prompt_id" TEXT,
    "prompt_version" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    CONSTRAINT "render_jobs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "render_jobs_product_asset_id_fkey" FOREIGN KEY ("product_asset_id") REFERENCES "product_assets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "render_jobs_room_session_id_fkey" FOREIGN KEY ("room_session_id") REFERENCES "room_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_daily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "prep_renders" INTEGER NOT NULL DEFAULT 0,
    "cleanup_renders" INTEGER NOT NULL DEFAULT 0,
    "composite_renders" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "usage_daily_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_shop_domain_key" ON "shops"("shop_domain");

-- CreateIndex
CREATE INDEX "product_assets_shop_id_product_id_idx" ON "product_assets"("shop_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_shop_id_date_key" ON "usage_daily"("shop_id", "date");

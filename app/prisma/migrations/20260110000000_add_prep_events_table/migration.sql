-- Create prep_events table for product prep auditing/analytics
-- Matches Prisma model PrepEvent (@@map("prep_events"))

-- CreateTable
CREATE TABLE "prep_events" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "prep_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prep_events_asset_id_idx" ON "prep_events"("asset_id");

-- CreateIndex
CREATE INDEX "prep_events_shop_id_timestamp_idx" ON "prep_events"("shop_id", "timestamp");

-- CreateIndex
CREATE INDEX "prep_events_product_id_idx" ON "prep_events"("product_id");

-- CreateIndex
CREATE INDEX "prep_events_event_type_idx" ON "prep_events"("event_type");

-- AddForeignKey
ALTER TABLE "prep_events" ADD CONSTRAINT "prep_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prep_events" ADD CONSTRAINT "prep_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "product_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


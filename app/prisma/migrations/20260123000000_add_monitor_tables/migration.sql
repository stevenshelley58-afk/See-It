-- CreateTable
CREATE TABLE "monitor_events" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shop_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "run_id" TEXT,
    "variant_id" TEXT,
    "trace_id" TEXT,
    "span_id" TEXT,
    "parent_span_id" TEXT,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "overflow_artifact_id" TEXT,

    CONSTRAINT "monitor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_artifacts" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shop_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "run_id" TEXT,
    "variant_id" TEXT,
    "type" TEXT NOT NULL,
    "gcs_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "retention_class" TEXT NOT NULL DEFAULT 'standard',
    "expires_at" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "monitor_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitor_events_shop_id_idx" ON "monitor_events"("shop_id");

-- CreateIndex
CREATE INDEX "monitor_events_request_id_idx" ON "monitor_events"("request_id");

-- CreateIndex
CREATE INDEX "monitor_events_run_id_idx" ON "monitor_events"("run_id");

-- CreateIndex
CREATE INDEX "monitor_events_type_ts_idx" ON "monitor_events"("type", "ts");

-- CreateIndex
CREATE INDEX "monitor_artifacts_shop_id_idx" ON "monitor_artifacts"("shop_id");

-- CreateIndex
CREATE INDEX "monitor_artifacts_request_id_idx" ON "monitor_artifacts"("request_id");

-- CreateIndex
CREATE INDEX "monitor_artifacts_run_id_idx" ON "monitor_artifacts"("run_id");

-- CreateIndex
CREATE INDEX "monitor_artifacts_type_idx" ON "monitor_artifacts"("type");

-- AddForeignKey
ALTER TABLE "monitor_events" ADD CONSTRAINT "monitor_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_artifacts" ADD CONSTRAINT "monitor_artifacts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

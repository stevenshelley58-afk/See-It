CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"session_step_id" uuid,
	"request_id" text,
	"provider" varchar(20) NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"operation" varchar(30) NOT NULL,
	"input_params" jsonb,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"queue_time_ms" integer,
	"process_time_ms" integer,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"cost_usd" real,
	"is_regeneration" boolean DEFAULT false,
	"regeneration_reason" varchar(30),
	"original_request_id" uuid,
	"output_quality_score" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"session_id" varchar(100),
	"shop_domain" varchar(255),
	"data" jsonb NOT NULL,
	"client_timestamp" timestamp,
	"server_timestamp" timestamp DEFAULT now(),
	"user_agent" text,
	"ip" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid,
	"product_id" uuid,
	"session_id" uuid,
	"shopify_order_id" text NOT NULL,
	"order_number" text,
	"product_title" text,
	"quantity" integer DEFAULT 1,
	"line_item_price" real,
	"order_total" real,
	"had_ar_session" boolean DEFAULT false,
	"ar_session_ids" jsonb,
	"time_from_ar_to_purchase_ms" integer,
	"customer_id_hash" text,
	"is_repeat_customer" boolean,
	"ordered_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp NOT NULL,
	"shop_id" uuid,
	"total_sessions" integer DEFAULT 0,
	"completed_sessions" integer DEFAULT 0,
	"abandoned_sessions" integer DEFAULT 0,
	"error_sessions" integer DEFAULT 0,
	"funnel_room_capture" integer DEFAULT 0,
	"funnel_mask" integer DEFAULT 0,
	"funnel_inpaint" integer DEFAULT 0,
	"funnel_placement" integer DEFAULT 0,
	"funnel_complete" integer DEFAULT 0,
	"add_to_cart_count" integer DEFAULT 0,
	"purchase_count" integer DEFAULT 0,
	"revenue_from_ar" real DEFAULT 0,
	"total_ai_cost" real DEFAULT 0,
	"regeneration_cost" real DEFAULT 0,
	"cost_per_session" real,
	"cost_per_conversion" real,
	"total_errors" integer DEFAULT 0,
	"critical_errors" integer DEFAULT 0,
	"avg_session_duration_ms" integer,
	"avg_inpaint_time_ms" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"shop_id" uuid,
	"error_type" varchar(30) NOT NULL,
	"error_code" varchar(100) NOT NULL,
	"error_message" text NOT NULL,
	"stack_trace" text,
	"step" varchar(30),
	"action" varchar(50),
	"input_data" jsonb,
	"device_type" varchar(20),
	"os" varchar(50),
	"browser" varchar(50),
	"user_agent" text,
	"severity" varchar(20) NOT NULL,
	"is_user_facing" boolean DEFAULT false,
	"recovery_action" varchar(30),
	"acknowledged" boolean DEFAULT false,
	"acknowledged_by" text,
	"acknowledged_at" timestamp,
	"resolved" boolean DEFAULT false,
	"resolved_at" timestamp,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prepared_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"setup_session_id" uuid,
	"original_url" text,
	"original_width" integer,
	"original_height" integer,
	"prepared_url" text,
	"prepared_width" integer,
	"prepared_height" integer,
	"method" varchar(20) NOT NULL,
	"auto_confidence" real,
	"manual_edits_required" boolean DEFAULT false,
	"edit_types" jsonb,
	"processing_time_ms" integer,
	"revision_count" integer DEFAULT 0,
	"quality_score" real,
	"approved_by_merchant" boolean DEFAULT false,
	"times_used_in_sessions" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_setup_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid,
	"product_id" uuid,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"status" varchar(20) NOT NULL,
	"images_attempted" integer DEFAULT 0,
	"images_completed" integer DEFAULT 0,
	"images_failed" integer DEFAULT 0,
	"auto_success_count" integer DEFAULT 0,
	"manual_edit_count" integer DEFAULT 0,
	"errors_encountered" integer DEFAULT 0,
	"help_clicked" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid,
	"shopify_product_id" text NOT NULL,
	"title" text,
	"product_type" text,
	"vendor" text,
	"price" real,
	"is_ar_enabled" boolean DEFAULT false,
	"ar_enabled_at" timestamp,
	"prepared_images_count" integer DEFAULT 0,
	"setup_started_at" timestamp,
	"setup_completed_at" timestamp,
	"setup_duration_ms" integer,
	"setup_method" varchar(20),
	"setup_abandoned" boolean DEFAULT false,
	"total_sessions" integer DEFAULT 0,
	"completed_sessions" integer DEFAULT 0,
	"last_session_at" timestamp,
	"orders_with_ar" integer DEFAULT 0,
	"orders_without_ar" integer DEFAULT 0,
	"ar_conversion_rate" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"step" varchar(30) NOT NULL,
	"status" varchar(20) NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"retake_count" integer DEFAULT 0,
	"mask_edit_count" integer DEFAULT 0,
	"placement_adjustments" integer DEFAULT 0,
	"regeneration_count" integer DEFAULT 0,
	"auto_vs_manual" varchar(10),
	"auto_confidence" real,
	"quality_rating" integer,
	"input_file" text,
	"output_file" text,
	"error_code" varchar(50),
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(100) NOT NULL,
	"shop_id" uuid,
	"product_id" uuid,
	"shop_domain" varchar(255) NOT NULL,
	"product_title" text,
	"product_price" real,
	"status" varchar(20) NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"duration_ms" integer,
	"current_step" varchar(30),
	"steps_completed" integer DEFAULT 0,
	"abandonment_step" varchar(30),
	"abandonment_reason" text,
	"device_type" varchar(20),
	"os" varchar(50),
	"os_version" varchar(20),
	"browser" varchar(50),
	"browser_version" varchar(20),
	"screen_width" integer,
	"screen_height" integer,
	"has_camera" boolean,
	"has_gyroscope" boolean,
	"webgl_support" boolean,
	"connection_type" varchar(20),
	"entry_point" varchar(50),
	"referrer" text,
	"time_on_page_before_ar_ms" integer,
	"post_ar_action" varchar(30),
	"added_to_cart" boolean DEFAULT false,
	"added_to_cart_at" timestamp,
	"total_ai_cost" real DEFAULT 0,
	"regeneration_count" integer DEFAULT 0,
	"regeneration_cost" real DEFAULT 0,
	"had_error" boolean DEFAULT false,
	"error_count" integer DEFAULT 0,
	"gcs_path" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"name" text,
	"shopify_plan" varchar(50),
	"installed_at" timestamp,
	"uninstalled_at" timestamp,
	"billing_status" varchar(50),
	"is_embedded" boolean DEFAULT false,
	"embed_enabled_at" timestamp,
	"embed_disabled_at" timestamp,
	"theme_id" text,
	"theme_name" text,
	"total_products" integer DEFAULT 0,
	"ar_enabled_products" integer DEFAULT 0,
	"total_sessions" integer DEFAULT 0,
	"completed_sessions" integer DEFAULT 0,
	"last_session_at" timestamp,
	"health_score" integer,
	"needs_attention" boolean DEFAULT false,
	"attention_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "shops_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "system_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"response_time_ms" integer,
	"error_rate" real,
	"last_checked_at" timestamp NOT NULL,
	"last_healthy_at" timestamp,
	"last_error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_session_step_id_session_steps_id_fk" FOREIGN KEY ("session_step_id") REFERENCES "public"."session_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_images" ADD CONSTRAINT "prepared_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_images" ADD CONSTRAINT "prepared_images_setup_session_id_product_setup_sessions_id_fk" FOREIGN KEY ("setup_session_id") REFERENCES "public"."product_setup_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setup_sessions" ADD CONSTRAINT "product_setup_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setup_sessions" ADD CONSTRAINT "product_setup_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_steps" ADD CONSTRAINT "session_steps_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_session_idx" ON "ai_requests" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ai_requests_provider_idx" ON "ai_requests" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_type_idx" ON "analytics_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_events_timestamp_idx" ON "analytics_events" USING btree ("server_timestamp");--> statement-breakpoint
CREATE INDEX "conversions_shop_idx" ON "conversions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "conversions_product_idx" ON "conversions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "conversions_ordered_at_idx" ON "conversions" USING btree ("ordered_at");--> statement-breakpoint
CREATE INDEX "daily_metrics_date_idx" ON "daily_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "daily_metrics_shop_idx" ON "daily_metrics" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "errors_error_code_idx" ON "errors" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "errors_severity_idx" ON "errors" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "errors_occurred_at_idx" ON "errors" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "errors_shop_idx" ON "errors" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "prepared_images_product_idx" ON "prepared_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_setup_shop_idx" ON "product_setup_sessions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "product_setup_product_idx" ON "product_setup_sessions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_shop_idx" ON "products" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "products_shopify_id_idx" ON "products" USING btree ("shopify_product_id");--> statement-breakpoint
CREATE INDEX "session_steps_session_idx" ON "session_steps" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_steps_step_idx" ON "session_steps" USING btree ("step");--> statement-breakpoint
CREATE INDEX "sessions_session_id_idx" ON "sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_shop_idx" ON "sessions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "sessions_shop_domain_idx" ON "sessions" USING btree ("shop_domain");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_started_at_idx" ON "sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sessions_updated_at_idx" ON "sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "shops_domain_idx" ON "shops" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "shops_health_idx" ON "shops" USING btree ("needs_attention");--> statement-breakpoint
CREATE INDEX "system_health_service_idx" ON "system_health" USING btree ("service");
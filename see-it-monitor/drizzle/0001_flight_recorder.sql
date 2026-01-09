-- Add Flight Recorder columns to sessions table
ALTER TABLE "sessions" ADD COLUMN "flow" varchar(50);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "flow_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "env" varchar(20);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "app_version" varchar(100);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "worker_version" varchar(100);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "outcome" varchar(30);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "fingerprint" varchar(255);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "fingerprint_version" integer;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "first_divergence_node_key" varchar(100);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "flags" jsonb;
--> statement-breakpoint

-- Create run_nodes table
CREATE TABLE "run_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"node_key" varchar(100) NOT NULL,
	"lane" varchar(50) NOT NULL,
	"order_index" integer NOT NULL,
	"contract_name" text,
	"owning_file" text,
	"owning_line" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "run_nodes_session_idx" ON "run_nodes" ("session_id");
--> statement-breakpoint
CREATE INDEX "run_nodes_session_node_idx" ON "run_nodes" ("session_id","node_key");
--> statement-breakpoint

-- Create run_signals table
CREATE TABLE "run_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"node_key" varchar(100) NOT NULL,
	"signal_type" varchar(20) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "run_signals_session_idx" ON "run_signals" ("session_id");
--> statement-breakpoint
CREATE INDEX "run_signals_session_node_idx" ON "run_signals" ("session_id","node_key");
--> statement-breakpoint
CREATE INDEX "run_signals_session_signal_idx" ON "run_signals" ("session_id","signal_type");
--> statement-breakpoint

-- Create artifacts table
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" varchar(255) NOT NULL UNIQUE,
	"session_id" uuid NOT NULL,
	"node_key" varchar(100),
	"type" varchar(50) NOT NULL,
	"storage_key" text,
	"sha256" varchar(64),
	"width" integer,
	"height" integer,
	"mime" varchar(100),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "artifacts_session_idx" ON "artifacts" ("session_id");
--> statement-breakpoint
CREATE INDEX "artifacts_artifact_id_idx" ON "artifacts" ("artifact_id");
--> statement-breakpoint

-- Create artifact_edges table
CREATE TABLE "artifact_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_artifact_id" varchar(255) NOT NULL,
	"child_artifact_id" varchar(255) NOT NULL,
	"edge_type" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "artifact_edges_parent_idx" ON "artifact_edges" ("parent_artifact_id");
--> statement-breakpoint
CREATE INDEX "artifact_edges_child_idx" ON "artifact_edges" ("child_artifact_id");
--> statement-breakpoint

-- Create model_calls table
CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_call_id" varchar(255) NOT NULL UNIQUE,
	"session_id" uuid NOT NULL,
	"node_key" varchar(100),
	"provider" varchar(50) NOT NULL,
	"model" text NOT NULL,
	"prompt_artifact_id" varchar(255),
	"prompt_hash" varchar(64),
	"config_hash" varchar(64),
	"latency_ms" integer,
	"status" varchar(20) NOT NULL,
	"failure_class" varchar(50),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "model_calls_session_idx" ON "model_calls" ("session_id");
--> statement-breakpoint
CREATE INDEX "model_calls_model_call_id_idx" ON "model_calls" ("model_call_id");
--> statement-breakpoint

-- Create archetypes table
CREATE TABLE "archetypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"severity" varchar(20),
	"tags" jsonb,
	"signature_rules" jsonb,
	"fix_playbook" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

-- Create archetype_matches table
CREATE TABLE "archetype_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"archetype_id" uuid NOT NULL,
	"confidence" real NOT NULL,
	"matched_tokens" jsonb,
	"decided_by" varchar(50),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "archetype_matches_session_idx" ON "archetype_matches" ("session_id");
--> statement-breakpoint
CREATE INDEX "archetype_matches_archetype_idx" ON "archetype_matches" ("archetype_id");
--> statement-breakpoint

-- Create archetype_tests table
CREATE TABLE "archetype_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archetype_id" uuid NOT NULL,
	"test_name" text NOT NULL,
	"test_definition" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "archetype_tests_archetype_idx" ON "archetype_tests" ("archetype_id");
--> statement-breakpoint

-- Add foreign key constraints
ALTER TABLE "run_nodes" ADD CONSTRAINT "run_nodes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "run_signals" ADD CONSTRAINT "run_signals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "archetype_matches" ADD CONSTRAINT "archetype_matches_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "archetype_matches" ADD CONSTRAINT "archetype_matches_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "archetypes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "archetype_tests" ADD CONSTRAINT "archetype_tests_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "archetypes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

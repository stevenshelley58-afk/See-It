/**
 * See It Monitor - Database Schema
 * Comprehensive analytics for the entire AR experience
 */

import { pgTable, text, timestamp, integer, boolean, jsonb, real, uuid, varchar, index } from 'drizzle-orm/pg-core';

// ============================================
// MERCHANT DATA
// ============================================

export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  name: text('name'),
  shopifyPlan: varchar('shopify_plan', { length: 50 }),
  
  // Installation status
  installedAt: timestamp('installed_at'),
  uninstalledAt: timestamp('uninstalled_at'),
  billingStatus: varchar('billing_status', { length: 50 }), // active, cancelled, trial
  
  // Embed status
  isEmbedded: boolean('is_embedded').default(false),
  embedEnabledAt: timestamp('embed_enabled_at'),
  embedDisabledAt: timestamp('embed_disabled_at'),
  themeId: text('theme_id'),
  themeName: text('theme_name'),
  
  // Computed stats (updated periodically)
  totalProducts: integer('total_products').default(0),
  arEnabledProducts: integer('ar_enabled_products').default(0),
  totalSessions: integer('total_sessions').default(0),
  completedSessions: integer('completed_sessions').default(0),
  lastSessionAt: timestamp('last_session_at'),
  
  // Health scoring
  healthScore: integer('health_score'), // 0-100
  needsAttention: boolean('needs_attention').default(false),
  attentionReason: text('attention_reason'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  domainIdx: index('shops_domain_idx').on(table.domain),
  healthIdx: index('shops_health_idx').on(table.needsAttention),
}));

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').references(() => shops.id),
  shopifyProductId: text('shopify_product_id').notNull(),
  
  title: text('title'),
  productType: text('product_type'),
  vendor: text('vendor'),
  price: real('price'),
  
  // AR readiness
  isArEnabled: boolean('is_ar_enabled').default(false),
  arEnabledAt: timestamp('ar_enabled_at'),
  preparedImagesCount: integer('prepared_images_count').default(0),
  
  // Setup experience
  setupStartedAt: timestamp('setup_started_at'),
  setupCompletedAt: timestamp('setup_completed_at'),
  setupDurationMs: integer('setup_duration_ms'),
  setupMethod: varchar('setup_method', { length: 20 }), // auto, manual, hybrid
  setupAbandoned: boolean('setup_abandoned').default(false),
  
  // Usage stats
  totalSessions: integer('total_sessions').default(0),
  completedSessions: integer('completed_sessions').default(0),
  lastSessionAt: timestamp('last_session_at'),
  
  // Conversion tracking
  ordersWithAr: integer('orders_with_ar').default(0),
  ordersWithoutAr: integer('orders_without_ar').default(0),
  arConversionRate: real('ar_conversion_rate'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  shopIdx: index('products_shop_idx').on(table.shopId),
  shopifyIdIdx: index('products_shopify_id_idx').on(table.shopifyProductId),
}));

// ============================================
// SESSION TRACKING
// ============================================

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 100 }).notNull().unique(), // Our generated session ID
  shopId: uuid('shop_id').references(() => shops.id),
  productId: uuid('product_id').references(() => products.id),
  
  // Shop/product info (denormalized for fast queries)
  shopDomain: varchar('shop_domain', { length: 255 }).notNull(),
  productTitle: text('product_title'),
  productPrice: real('product_price'),
  
  // Session lifecycle
  status: varchar('status', { length: 20 }).notNull(), // in_progress, completed, abandoned, error
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  durationMs: integer('duration_ms'),
  
  // Progress tracking
  currentStep: varchar('current_step', { length: 30 }),
  stepsCompleted: integer('steps_completed').default(0),
  abandonmentStep: varchar('abandonment_step', { length: 30 }),
  abandonmentReason: text('abandonment_reason'),
  
  // Device context
  deviceType: varchar('device_type', { length: 20 }), // mobile, tablet, desktop
  os: varchar('os', { length: 50 }),
  osVersion: varchar('os_version', { length: 20 }),
  browser: varchar('browser', { length: 50 }),
  browserVersion: varchar('browser_version', { length: 20 }),
  screenWidth: integer('screen_width'),
  screenHeight: integer('screen_height'),
  hasCamera: boolean('has_camera'),
  hasGyroscope: boolean('has_gyroscope'),
  webglSupport: boolean('webgl_support'),
  connectionType: varchar('connection_type', { length: 20 }),
  
  // User journey
  entryPoint: varchar('entry_point', { length: 50 }), // product_page, collection, direct
  referrer: text('referrer'),
  timeOnPageBeforeAr: integer('time_on_page_before_ar_ms'),
  
  // Post-session actions
  postArAction: varchar('post_ar_action', { length: 30 }), // add_to_cart, continue, leave
  addedToCart: boolean('added_to_cart').default(false),
  addedToCartAt: timestamp('added_to_cart_at'),
  
  // Cost tracking (aggregated from ai_requests)
  totalAiCost: real('total_ai_cost').default(0),
  regenerationCount: integer('regeneration_count').default(0),
  regenerationCost: real('regeneration_cost').default(0),
  
  // Error tracking
  hadError: boolean('had_error').default(false),
  errorCount: integer('error_count').default(0),
  
  // GCS reference
  gcsPath: text('gcs_path'),
  
  // Flight Recorder fields
  flow: varchar('flow', { length: 50 }), // cleanup, placement_v2, product_prep, unknown
  flowVersion: varchar('flow_version', { length: 50 }),
  env: varchar('env', { length: 20 }), // prod, preview, dev, unknown
  appVersion: varchar('app_version', { length: 100 }),
  workerVersion: varchar('worker_version', { length: 100 }),
  outcome: varchar('outcome', { length: 30 }), // ok, divergent, error, validator_fail, ui_mismatch, unknown
  fingerprint: varchar('fingerprint', { length: 255 }),
  fingerprintVersion: integer('fingerprint_version'),
  firstDivergenceNodeKey: varchar('first_divergence_node_key', { length: 100 }),
  flags: jsonb('flags'), // For banners like missing_flow, missing_env
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  sessionIdIdx: index('sessions_session_id_idx').on(table.sessionId),
  shopIdx: index('sessions_shop_idx').on(table.shopId),
  shopDomainIdx: index('sessions_shop_domain_idx').on(table.shopDomain),
  statusIdx: index('sessions_status_idx').on(table.status),
  startedAtIdx: index('sessions_started_at_idx').on(table.startedAt),
  updatedAtIdx: index('sessions_updated_at_idx').on(table.updatedAt),
}));

export const sessionSteps = pgTable('session_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id),
  
  step: varchar('step', { length: 30 }).notNull(), // room_capture, mask, inpaint, placement, final
  status: varchar('status', { length: 20 }).notNull(), // started, completed, failed, skipped
  
  startedAt: timestamp('started_at').notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
  
  // Step-specific metrics
  retakeCount: integer('retake_count').default(0), // room captures
  maskEditCount: integer('mask_edit_count').default(0),
  placementAdjustments: integer('placement_adjustments').default(0),
  regenerationCount: integer('regeneration_count').default(0),
  
  // For mask step
  autoVsManual: varchar('auto_vs_manual', { length: 10 }), // auto, manual, hybrid
  autoConfidence: real('auto_confidence'),
  
  // Quality
  qualityRating: integer('quality_rating'), // 1-5 if user rates
  
  // Files
  inputFile: text('input_file'),
  outputFile: text('output_file'),
  
  // Error info
  errorCode: varchar('error_code', { length: 50 }),
  errorMessage: text('error_message'),
  
  metadata: jsonb('metadata'), // Additional step-specific data
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  sessionIdx: index('session_steps_session_idx').on(table.sessionId),
  stepIdx: index('session_steps_step_idx').on(table.step),
}));

// ============================================
// AI PROVIDER TRACKING (COSTS)
// ============================================

export const aiRequests = pgTable('ai_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id),
  sessionStepId: uuid('session_step_id').references(() => sessionSteps.id),
  
  // Request info
  requestId: text('request_id'), // Provider's request ID
  provider: varchar('provider', { length: 20 }).notNull(), // replicate, fal, openai
  model: text('model').notNull(),
  modelVersion: text('model_version'),
  
  // What was requested
  operation: varchar('operation', { length: 30 }).notNull(), // inpaint, segment, remove_bg, upscale
  inputParams: jsonb('input_params'),
  
  // Timing
  startedAt: timestamp('started_at').notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
  queueTimeMs: integer('queue_time_ms'),
  processTimeMs: integer('process_time_ms'),
  
  // Result
  status: varchar('status', { length: 20 }).notNull(), // pending, success, failed, timeout
  errorMessage: text('error_message'),
  
  // Cost
  costUsd: real('cost_usd'),
  
  // Regeneration tracking
  isRegeneration: boolean('is_regeneration').default(false),
  regenerationReason: varchar('regeneration_reason', { length: 30 }), // user_requested, auto_retry, quality_fail
  originalRequestId: uuid('original_request_id'),
  
  // Output quality (if we implement scoring)
  outputQualityScore: real('output_quality_score'),
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  sessionIdx: index('ai_requests_session_idx').on(table.sessionId),
  providerIdx: index('ai_requests_provider_idx').on(table.provider),
  createdAtIdx: index('ai_requests_created_at_idx').on(table.createdAt),
}));

// ============================================
// ERROR TRACKING
// ============================================

export const errors = pgTable('errors', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id),
  shopId: uuid('shop_id').references(() => shops.id),
  
  // Error classification
  errorType: varchar('error_type', { length: 30 }).notNull(), // client, server, ai_provider, shopify
  errorCode: varchar('error_code', { length: 100 }).notNull(),
  errorMessage: text('error_message').notNull(),
  stackTrace: text('stack_trace'),
  
  // Context
  step: varchar('step', { length: 30 }),
  action: varchar('action', { length: 50 }),
  inputData: jsonb('input_data'), // Sanitized
  
  // Device context
  deviceType: varchar('device_type', { length: 20 }),
  os: varchar('os', { length: 50 }),
  browser: varchar('browser', { length: 50 }),
  userAgent: text('user_agent'),
  
  // Severity
  severity: varchar('severity', { length: 20 }).notNull(), // critical, error, warning
  isUserFacing: boolean('is_user_facing').default(false),
  
  // Recovery
  recoveryAction: varchar('recovery_action', { length: 30 }), // retry_success, retry_fail, abandoned
  
  // Status
  acknowledged: boolean('acknowledged').default(false),
  acknowledgedBy: text('acknowledged_by'),
  acknowledgedAt: timestamp('acknowledged_at'),
  resolved: boolean('resolved').default(false),
  resolvedAt: timestamp('resolved_at'),
  
  occurredAt: timestamp('occurred_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  errorCodeIdx: index('errors_error_code_idx').on(table.errorCode),
  severityIdx: index('errors_severity_idx').on(table.severity),
  occurredAtIdx: index('errors_occurred_at_idx').on(table.occurredAt),
  shopIdx: index('errors_shop_idx').on(table.shopId),
}));

// ============================================
// CONVERSION TRACKING
// ============================================

export const conversions = pgTable('conversions', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').references(() => shops.id),
  productId: uuid('product_id').references(() => products.id),
  sessionId: uuid('session_id').references(() => sessions.id),
  
  // Shopify order info
  shopifyOrderId: text('shopify_order_id').notNull(),
  orderNumber: text('order_number'),
  
  // What was purchased
  productTitle: text('product_title'),
  quantity: integer('quantity').default(1),
  lineItemPrice: real('line_item_price'),
  orderTotal: real('order_total'),
  
  // AR correlation
  hadArSession: boolean('had_ar_session').default(false),
  arSessionIds: jsonb('ar_session_ids'), // Array of session IDs if multiple
  timeFromArToPurchase: integer('time_from_ar_to_purchase_ms'),
  
  // Customer (hashed for privacy)
  customerIdHash: text('customer_id_hash'),
  isRepeatCustomer: boolean('is_repeat_customer'),
  
  orderedAt: timestamp('ordered_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  shopIdx: index('conversions_shop_idx').on(table.shopId),
  productIdx: index('conversions_product_idx').on(table.productId),
  orderedAtIdx: index('conversions_ordered_at_idx').on(table.orderedAt),
}));

// ============================================
// PRODUCT SETUP TRACKING
// ============================================

export const productSetupSessions = pgTable('product_setup_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').references(() => shops.id),
  productId: uuid('product_id').references(() => products.id),
  
  startedAt: timestamp('started_at').notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
  
  status: varchar('status', { length: 20 }).notNull(), // in_progress, completed, abandoned
  
  // Images processed
  imagesAttempted: integer('images_attempted').default(0),
  imagesCompleted: integer('images_completed').default(0),
  imagesFailed: integer('images_failed').default(0),
  
  // Method breakdown
  autoSuccessCount: integer('auto_success_count').default(0),
  manualEditCount: integer('manual_edit_count').default(0),
  
  // Friction
  errorsEncountered: integer('errors_encountered').default(0),
  helpClicked: boolean('help_clicked').default(false),
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  shopIdx: index('product_setup_shop_idx').on(table.shopId),
  productIdx: index('product_setup_product_idx').on(table.productId),
}));

export const preparedImages = pgTable('prepared_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').references(() => products.id),
  setupSessionId: uuid('setup_session_id').references(() => productSetupSessions.id),
  
  // Original image
  originalUrl: text('original_url'),
  originalWidth: integer('original_width'),
  originalHeight: integer('original_height'),
  
  // Prepared image
  preparedUrl: text('prepared_url'),
  preparedWidth: integer('prepared_width'),
  preparedHeight: integer('prepared_height'),
  
  // Preparation method
  method: varchar('method', { length: 20 }).notNull(), // auto, manual, hybrid
  autoConfidence: real('auto_confidence'),
  manualEditsRequired: boolean('manual_edits_required').default(false),
  editTypes: jsonb('edit_types'), // ['mask_adjustment', 'background_removal', 'crop']
  
  // Processing
  processingTimeMs: integer('processing_time_ms'),
  revisionCount: integer('revision_count').default(0),
  
  // Quality
  qualityScore: real('quality_score'),
  approvedByMerchant: boolean('approved_by_merchant').default(false),
  
  // Usage
  timesUsedInSessions: integer('times_used_in_sessions').default(0),
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  productIdx: index('prepared_images_product_idx').on(table.productId),
}));

// ============================================
// ANALYTICS EVENTS (Raw event log)
// ============================================

export const analyticsEvents = pgTable('analytics_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  eventType: varchar('event_type', { length: 50 }).notNull(),
  sessionId: varchar('session_id', { length: 100 }),
  shopDomain: varchar('shop_domain', { length: 255 }),
  
  data: jsonb('data').notNull(),
  
  // Client info
  clientTimestamp: timestamp('client_timestamp'),
  serverTimestamp: timestamp('server_timestamp').defaultNow(),
  
  // For debugging
  userAgent: text('user_agent'),
  ip: varchar('ip', { length: 45 }), // Anonymize after processing
  
}, (table) => ({
  eventTypeIdx: index('analytics_events_type_idx').on(table.eventType),
  sessionIdx: index('analytics_events_session_idx').on(table.sessionId),
  serverTimestampIdx: index('analytics_events_timestamp_idx').on(table.serverTimestamp),
}));

// ============================================
// PREP EVENTS (Product preparation audit log)
// ============================================

export const prepEvents = pgTable('prep_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Asset/product/shop identifiers (from app DB)
  assetId: text('asset_id').notNull(),
  productId: text('product_id').notNull(),
  shopId: text('shop_id').notNull(),
  
  // Event metadata
  timestamp: timestamp('timestamp').notNull(),
  actorType: varchar('actor_type', { length: 20 }).notNull(), // "system" | "merchant"
  actorId: text('actor_id'), // nullable for system, best-effort for merchant
  eventType: varchar('event_type', { length: 50 }).notNull(),
  
  // Event payload (JSON)
  payload: jsonb('payload').notNull(),
}, (table) => ({
  assetIdx: index('prep_events_asset_idx').on(table.assetId),
  shopTimestampIdx: index('prep_events_shop_timestamp_idx').on(table.shopId, table.timestamp),
  productIdx: index('prep_events_product_idx').on(table.productId),
  eventTypeIdx: index('prep_events_event_type_idx').on(table.eventType),
}));

// ============================================
// AGGREGATED METRICS (Pre-computed for dashboard)
// ============================================

export const dailyMetrics = pgTable('daily_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: timestamp('date').notNull(),
  shopId: uuid('shop_id').references(() => shops.id), // null = global
  
  // Sessions
  totalSessions: integer('total_sessions').default(0),
  completedSessions: integer('completed_sessions').default(0),
  abandonedSessions: integer('abandoned_sessions').default(0),
  errorSessions: integer('error_sessions').default(0),
  
  // Funnel
  funnelRoomCapture: integer('funnel_room_capture').default(0),
  funnelMask: integer('funnel_mask').default(0),
  funnelInpaint: integer('funnel_inpaint').default(0),
  funnelPlacement: integer('funnel_placement').default(0),
  funnelComplete: integer('funnel_complete').default(0),
  
  // Conversions
  addToCartCount: integer('add_to_cart_count').default(0),
  purchaseCount: integer('purchase_count').default(0),
  revenueFromAr: real('revenue_from_ar').default(0),
  
  // Costs
  totalAiCost: real('total_ai_cost').default(0),
  regenerationCost: real('regeneration_cost').default(0),
  costPerSession: real('cost_per_session'),
  costPerConversion: real('cost_per_conversion'),
  
  // Errors
  totalErrors: integer('total_errors').default(0),
  criticalErrors: integer('critical_errors').default(0),
  
  // Performance
  avgSessionDurationMs: integer('avg_session_duration_ms'),
  avgInpaintTimeMs: integer('avg_inpaint_time_ms'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  dateIdx: index('daily_metrics_date_idx').on(table.date),
  shopIdx: index('daily_metrics_shop_idx').on(table.shopId),
}));

// ============================================
// FLIGHT RECORDER - RUN NODES
// ============================================

export const runNodes = pgTable('run_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id).notNull(),
  nodeKey: varchar('node_key', { length: 100 }).notNull(),
  lane: varchar('lane', { length: 50 }).notNull(), // UI, API, Worker, Model, Storage, DB
  orderIndex: integer('order_index').notNull(),
  contractName: text('contract_name'),
  owningFile: text('owning_file'),
  owningLine: integer('owning_line'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  sessionIdx: index('run_nodes_session_idx').on(table.sessionId),
  sessionNodeIdx: index('run_nodes_session_node_idx').on(table.sessionId, table.nodeKey),
}));

// ============================================
// FLIGHT RECORDER - RUN SIGNALS
// ============================================

export const runSignals = pgTable('run_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id).notNull(),
  nodeKey: varchar('node_key', { length: 100 }).notNull(),
  signalType: varchar('signal_type', { length: 20 }).notNull(), // intended, attempted, produced, observed
  timestamp: timestamp('timestamp').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  sessionIdx: index('run_signals_session_idx').on(table.sessionId),
  sessionNodeIdx: index('run_signals_session_node_idx').on(table.sessionId, table.nodeKey),
  sessionSignalIdx: index('run_signals_session_signal_idx').on(table.sessionId, table.signalType),
}));

// ============================================
// FLIGHT RECORDER - ARTIFACTS
// ============================================

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  artifactId: varchar('artifact_id', { length: 255 }).notNull().unique(),
  sessionId: uuid('session_id').references(() => sessions.id).notNull(),
  nodeKey: varchar('node_key', { length: 100 }),
  type: varchar('type', { length: 50 }).notNull(),
  storageKey: text('storage_key'),
  sha256: varchar('sha256', { length: 64 }),
  width: integer('width'),
  height: integer('height'),
  mime: varchar('mime', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  sessionIdx: index('artifacts_session_idx').on(table.sessionId),
  artifactIdIdx: index('artifacts_artifact_id_idx').on(table.artifactId),
}));

// ============================================
// FLIGHT RECORDER - ARTIFACT EDGES
// ============================================

export const artifactEdges = pgTable('artifact_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentArtifactId: varchar('parent_artifact_id', { length: 255 }).notNull(),
  childArtifactId: varchar('child_artifact_id', { length: 255 }).notNull(),
  edgeType: varchar('edge_type', { length: 50 }).notNull(), // derived_from, mask_of, overlay_of, etc.
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  parentIdx: index('artifact_edges_parent_idx').on(table.parentArtifactId),
  childIdx: index('artifact_edges_child_idx').on(table.childArtifactId),
}));

// ============================================
// FLIGHT RECORDER - MODEL CALLS
// ============================================

export const modelCalls = pgTable('model_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelCallId: varchar('model_call_id', { length: 255 }).notNull().unique(),
  sessionId: uuid('session_id').references(() => sessions.id).notNull(),
  nodeKey: varchar('node_key', { length: 100 }),
  provider: varchar('provider', { length: 50 }).notNull(),
  model: text('model').notNull(),
  promptArtifactId: varchar('prompt_artifact_id', { length: 255 }),
  promptHash: varchar('prompt_hash', { length: 64 }),
  configHash: varchar('config_hash', { length: 64 }),
  latencyMs: integer('latency_ms'),
  status: varchar('status', { length: 20 }).notNull(),
  failureClass: varchar('failure_class', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  sessionIdx: index('model_calls_session_idx').on(table.sessionId),
  modelCallIdIdx: index('model_calls_model_call_id_idx').on(table.modelCallId),
}));

// ============================================
// FLIGHT RECORDER - ARCHETYPES
// ============================================

export const archetypes = pgTable('archetypes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  severity: varchar('severity', { length: 20 }), // critical, error, warning
  tags: jsonb('tags'), // Array of tag strings
  signatureRules: jsonb('signature_rules'), // Tokens, weights, etc.
  fixPlaybook: text('fix_playbook'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const archetypeMatches = pgTable('archetype_matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id).notNull(),
  archetypeId: uuid('archetype_id').references(() => archetypes.id).notNull(),
  confidence: real('confidence').notNull(), // 0.0 to 1.0
  matchedTokens: jsonb('matched_tokens'), // Array of matched token strings
  decidedBy: varchar('decided_by', { length: 50 }), // auto, manual, etc.
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  sessionIdx: index('archetype_matches_session_idx').on(table.sessionId),
  archetypeIdx: index('archetype_matches_archetype_idx').on(table.archetypeId),
}));

export const archetypeTests = pgTable('archetype_tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  archetypeId: uuid('archetype_id').references(() => archetypes.id).notNull(),
  testName: text('test_name').notNull(),
  testDefinition: jsonb('test_definition'), // What it checks, expected outcome
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  archetypeIdx: index('archetype_tests_archetype_idx').on(table.archetypeId),
}));

// ============================================
// SYSTEM HEALTH
// ============================================

export const systemHealth = pgTable('system_health', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  service: varchar('service', { length: 50 }).notNull(), // railway_api, replicate, fal, shopify
  status: varchar('status', { length: 20 }).notNull(), // healthy, degraded, down
  
  responseTimeMs: integer('response_time_ms'),
  errorRate: real('error_rate'),
  
  lastCheckedAt: timestamp('last_checked_at').notNull(),
  lastHealthyAt: timestamp('last_healthy_at'),
  lastErrorMessage: text('last_error_message'),
  
  metadata: jsonb('metadata'),
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  serviceIdx: index('system_health_service_idx').on(table.service),
}));

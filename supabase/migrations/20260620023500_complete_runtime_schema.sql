create table if not exists session (
  id text primary key,
  shop_id uuid references shop(id),
  state text,
  is_online boolean,
  scope text,
  expires_at timestamptz,
  access_token_encrypted text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists ai_provider (
  id uuid primary key default gen_random_uuid(),
  provider_key text unique not null,
  display_name text not null,
  adapter_key text not null,
  adapter_version text not null,
  status text check (status in ('enabled','disabled','degraded')) not null,
  secret_ref text,
  base_url text,
  docs_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists ai_model (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references ai_provider(id),
  model_key text not null,
  display_name text,
  model_version text,
  status text check (status in ('enabled','disabled','deprecated','testing')) not null,
  capabilities_json jsonb not null,
  default_params_json jsonb default '{}',
  limits_json jsonb default '{}',
  pricing_json jsonb default '{}',
  docs_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(provider_id, model_key, model_version)
);

create table if not exists ai_model_task (
  id uuid primary key default gen_random_uuid(),
  ai_model_id uuid references ai_model(id),
  task_type text not null,
  enabled boolean default true,
  created_at timestamptz default now(),
  unique(ai_model_id, task_type)
);

create table if not exists model_route_policy (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  surface text,
  task_type text,
  status text check (status in ('draft','active','archived')),
  policy_json jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists prompt_template (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  task_type text not null,
  surface text not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists prompt_version (
  id uuid primary key default gen_random_uuid(),
  prompt_template_id uuid references prompt_template(id),
  version integer not null,
  status text check (status in ('draft','review','approved','active','archived')),
  system_instruction text,
  developer_instruction text,
  user_prompt_template text not null,
  negative_prompt_template text,
  variables_schema_json jsonb default '{}',
  output_schema_json jsonb default '{}',
  allowed_asset_roles_json jsonb default '[]',
  required_asset_order_json jsonb default '[]',
  default_params_json jsonb default '{}',
  prompt_hash text not null,
  notes text,
  created_by text,
  approved_by text,
  created_at timestamptz default now(),
  approved_at timestamptz,
  unique(prompt_template_id, version)
);

create table if not exists prompt_bundle (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  surface text not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists prompt_bundle_version (
  id uuid primary key default gen_random_uuid(),
  prompt_bundle_id uuid references prompt_bundle(id),
  version integer not null,
  status text check (status in ('draft','review','approved','active','archived')),
  prompt_version_map_json jsonb not null,
  bundle_hash text not null,
  notes text,
  created_by text,
  approved_by text,
  created_at timestamptz default now(),
  approved_at timestamptz,
  unique(prompt_bundle_id, version)
);

create table if not exists render_recipe (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  surface text not null,
  kind text check (kind in ('shopper','lifestyle','demo','test','replay','eval')),
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists render_recipe_version (
  id uuid primary key default gen_random_uuid(),
  render_recipe_id uuid references render_recipe(id),
  version integer not null,
  status text check (status in ('draft','review','approved','active','archived')),
  prompt_bundle_version_id uuid references prompt_bundle_version(id),
  model_route_policy_id uuid references model_route_policy(id),
  gate_policy_json jsonb not null,
  retry_policy_json jsonb not null,
  storage_policy_json jsonb not null,
  output_policy_json jsonb not null,
  recipe_hash text not null,
  notes text,
  created_by text,
  approved_by text,
  created_at timestamptz default now(),
  approved_at timestamptz,
  unique(render_recipe_id, version)
);

create table if not exists prompt_deployment (
  id uuid primary key default gen_random_uuid(),
  surface text not null,
  task_type text,
  render_recipe_version_id uuid references render_recipe_version(id),
  status text check (status in ('active','rolled_back','paused')),
  traffic_percent integer default 100,
  started_at timestamptz default now(),
  ended_at timestamptz,
  created_by text,
  reason text
);

create table if not exists render_request (
  id uuid primary key default gen_random_uuid(),
  trace_id text unique not null,
  shop_id uuid references shop(id),
  room_session_id uuid references room_session(id),
  product_setup_id uuid references product_setup(id),
  source_render_request_id uuid references render_request(id),
  kind text check (kind in ('shopper','lifestyle','demo','test','replay','eval')),
  surface text check (surface in ('widget','admin','founder','demo','cron','system')),
  status text check (status in ('created','assets_pending','queued','running','evaluating','done','failed','cancelled','expired')),
  tap_x numeric,
  tap_y numeric,
  hint_text text,
  attempt_count integer default 0,
  remaining_refinements integer default 3,
  selected_result_asset_id uuid,
  final_gate_score numeric,
  final_error_code text,
  final_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists ai_invocation (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  surface text not null,
  task_type text not null,
  provider_id uuid references ai_provider(id),
  ai_model_id uuid references ai_model(id),
  adapter_key text not null,
  adapter_version text not null,
  prompt_template_id uuid references prompt_template(id),
  prompt_version_id uuid references prompt_version(id),
  prompt_bundle_version_id uuid references prompt_bundle_version(id),
  render_recipe_version_id uuid references render_recipe_version(id),
  resolved_system_instruction text,
  resolved_developer_instruction text,
  resolved_user_prompt text,
  resolved_negative_prompt text,
  variables_json jsonb default '{}',
  image_inputs_json jsonb default '[]',
  params_json jsonb default '{}',
  request_json_redacted jsonb default '{}',
  response_json_redacted jsonb default '{}',
  normalized_result_json jsonb default '{}',
  provider_response_id text,
  finish_reason text,
  safety_json jsonb default '{}',
  usage_json jsonb default '{}',
  cost_estimate_usd numeric,
  latency_ms integer,
  status text check (status in ('created','sent','succeeded','failed','cancelled')),
  error_code text,
  error_message text,
  retryable boolean default false,
  idempotency_key text unique,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists render_attempt (
  id uuid primary key default gen_random_uuid(),
  render_request_id uuid references render_request(id),
  attempt_number integer not null,
  parent_attempt_id uuid references render_attempt(id),
  ai_invocation_id uuid references ai_invocation(id),
  provider_id uuid references ai_provider(id),
  ai_model_id uuid references ai_model(id),
  render_recipe_version_id uuid references render_recipe_version(id),
  prompt_bundle_version_id uuid references prompt_bundle_version(id),
  status text check (status in ('queued','running','provider_done','stored','evaluated','accepted','rejected','failed','cancelled')),
  reason text,
  result_asset_id uuid,
  gate_score numeric,
  gate_detail_json jsonb default '{}',
  latency_ms integer,
  cost_estimate_usd numeric,
  error_code text,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists render_asset (
  id uuid primary key default gen_random_uuid(),
  render_request_id uuid references render_request(id),
  render_attempt_id uuid references render_attempt(id),
  ai_invocation_id uuid references ai_invocation(id),
  role text check (role in ('product_image','product_cutout','room_original','room_normalized','previous_render','mask','provider_output','gate_input','gate_debug','final_output','intermediate','eval_reference')),
  storage_bucket text not null,
  storage_key text not null,
  mime_type text,
  width integer,
  height integer,
  sha256 text,
  bytes integer,
  retention_expires_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists render_trace_event (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  render_request_id uuid references render_request(id),
  render_attempt_id uuid references render_attempt(id),
  ai_invocation_id uuid references ai_invocation(id),
  event_name text not null,
  event_level text check (event_level in ('debug','info','warn','error')),
  message text,
  props_json jsonb default '{}',
  duration_ms integer,
  created_at timestamptz default now()
);

create table if not exists manual_review (
  id uuid primary key default gen_random_uuid(),
  render_request_id uuid references render_request(id),
  reviewer text,
  score integer check (score >= 1 and score <= 10),
  status text check (status in ('approved','rejected','needs_prompt_work','needs_model_work','needs_asset_work')),
  issue_tags text[],
  notes text,
  created_at timestamptz default now()
);

create table if not exists job (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text check (status in ('queued','leased','running','succeeded','failed','dead','cancelled')),
  priority integer default 100,
  payload_json jsonb not null,
  idempotency_key text unique,
  lease_owner text,
  leased_until timestamptz,
  attempt_count integer default 0,
  max_attempts integer default 3,
  last_error_code text,
  last_error_message text,
  run_after timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz default now()
);

create table if not exists eval_dataset (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  status text check (status in ('active','archived')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists eval_case (
  id uuid primary key default gen_random_uuid(),
  eval_dataset_id uuid references eval_dataset(id),
  case_slug text not null,
  product_asset_key text,
  cutout_asset_key text,
  room_asset_key text,
  mask_asset_key text,
  expected_json jsonb default '{}',
  notes text,
  created_at timestamptz default now(),
  unique(eval_dataset_id, case_slug)
);

create table if not exists eval_run (
  id uuid primary key default gen_random_uuid(),
  eval_dataset_id uuid references eval_dataset(id),
  name text,
  render_recipe_version_id uuid references render_recipe_version(id),
  model_route_policy_id uuid references model_route_policy(id),
  status text check (status in ('queued','running','completed','failed','cancelled')),
  summary_json jsonb default '{}',
  created_by text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists eval_result (
  id uuid primary key default gen_random_uuid(),
  eval_run_id uuid references eval_run(id),
  eval_case_id uuid references eval_case(id),
  render_request_id uuid references render_request(id),
  automated_score_json jsonb default '{}',
  manual_score_json jsonb default '{}',
  status text check (status in ('pass','fail','review')),
  created_at timestamptz default now()
);

create table if not exists ai_experiment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text check (type in ('prompt_version_test','model_test','recipe_test','gate_threshold_test','fallback_policy_test','parameter_test')),
  surface text not null,
  status text check (status in ('draft','running','paused','completed','archived')),
  start_at timestamptz,
  end_at timestamptz,
  traffic_percent integer default 0,
  success_metric text,
  guardrail_json jsonb default '{}',
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists ai_experiment_arm (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references ai_experiment(id),
  name text not null,
  render_recipe_version_id uuid references render_recipe_version(id),
  ai_model_id uuid references ai_model(id),
  prompt_bundle_version_id uuid references prompt_bundle_version(id),
  params_override_json jsonb default '{}',
  traffic_weight integer default 0,
  status text check (status in ('active','paused','archived')),
  created_at timestamptz default now()
);

create table if not exists ai_experiment_assignment (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references ai_experiment(id),
  arm_id uuid references ai_experiment_arm(id),
  assignment_key text not null,
  render_request_id uuid references render_request(id),
  created_at timestamptz default now(),
  unique(experiment_id, assignment_key)
);

create table if not exists usage_monthly (
  shop_id uuid references shop(id),
  month text,
  renders_started integer default 0,
  renders_accepted integer default 0,
  renders_failed integer default 0,
  lifestyle_images_used integer default 0,
  cost_estimate_usd numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key(shop_id, month)
);

create table if not exists prospect (
  id uuid primary key default gen_random_uuid(),
  store_domain text unique,
  store_name text,
  contact_email text,
  email_verified boolean default false,
  owner_name text,
  hero_product_json jsonb,
  personalization_line text,
  score text check (score in ('A','B','C')),
  status text check (status in ('queued','demo_built','approved','sent','clicked','trial','customer','rejected','bounced','unsubscribed')),
  demo_slug text unique,
  demo_expires_at timestamptz,
  sequence_id text,
  batch_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists suppression (
  email text primary key,
  reason text check (reason in ('unsub','bounce','manual','customer')),
  created_at timestamptz default now()
);

insert into eval_dataset(name, description, status) values
  ('shopper_core_15', 'Core shopper room render fixtures', 'active'),
  ('scale_sensitive_20', 'Scale sensitive fixtures', 'active'),
  ('lighting_hard_20', 'Lighting hard fixtures', 'active'),
  ('furniture_large_20', 'Large furniture fixtures', 'active'),
  ('wall_items_20', 'Wall item fixtures', 'active'),
  ('decor_small_20', 'Small decor fixtures', 'active'),
  ('merchant_lifestyle_20', 'Merchant lifestyle fixtures', 'active'),
  ('negative_controls_10', 'Negative controls', 'active')
on conflict (name) do nothing;

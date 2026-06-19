alter table if exists shop drop constraint if exists shop_plan_check;
alter table if exists shop
  add constraint shop_plan_check
  check (plan in ('trial', 'starter', 'growth', 'cancelled')) not valid;

alter table if exists product_setup drop constraint if exists product_setup_prep_status_check;
alter table if exists product_setup
  add constraint product_setup_prep_status_check
  check (prep_status in ('none', 'extracting', 'awaiting_confirm', 'ready', 'failed')) not valid;

alter table if exists room_session drop constraint if exists room_session_source_check;
alter table if exists room_session
  add constraint room_session_source_check
  check (source in ('widget', 'demo', 'merchant_test', 'eval')) not valid;

alter table if exists render_feedback drop constraint if exists render_feedback_verdict_check;
alter table if exists render_feedback
  add constraint render_feedback_verdict_check
  check (verdict in ('up', 'down')) not valid;

alter table if exists event_log drop constraint if exists event_log_surface_check;
alter table if exists event_log
  add constraint event_log_surface_check
  check (surface in ('widget', 'admin', 'demo', 'outreach', 'billing', 'system', 'founder', 'ai')) not valid;

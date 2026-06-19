# Render Observability

Every shopper, merchant, replay, eval, and demo render must be traceable from request to output or failure.

## Required Records

For each generated image workflow:

- `render_request`: surface, kind, status, tap, retry/refinement links, final status, and trace ID.
- `render_attempt`: attempt number, provider/model, recipe, prompt bundle, latency, cost, gate score, and error details.
- `ai_invocation`: redacted provider request/response, resolved instructions, params, image inputs, normalized result, latency, cost, and error state.
- `render_asset`: storage bucket/key, role, mime type, dimensions, checksum, and retention expiry.
- `render_trace_event`: state transitions and debug events.
- `render_feedback`: shopper verdict and issue tag.
- `manual_review`: founder QA outcome for render operations.

## Critical Events

The trace should include these events where applicable:

- `render_request_created`
- `render_quota_consumed`
- `product_cutout_selected`
- `prompt_bundle_resolved`
- `model_route_selected`
- `provider_attempt_started`
- `provider_attempt_finished`
- `output_asset_stored`
- `quality_gate_completed`
- `render_retry_scheduled`
- `render_escalated`
- `render_completed`
- `render_failed`
- `replay_created`
- `manual_review_recorded`

## Founder Views

- `/founder/renders`: render list and attempt status.
- `/founder/renders/:renderId`: full trace, prompt snapshots, provider/model, assets, gate, cost, latency, and feedback.
- `/founder/renders/:renderId/replay`: source render context and alternate prompt/model replay.
- `/founder/quality`: gate failures, manual review queue, fixture status.
- `/founder/ai/costs`: invocation cost and latency trends.

## Harness Evidence

`pnpm.cmd run harness:smoke` writes:

- `out/harness-report.json`
- `out/harness-report.html`
- `out/benchmarks/{run_id}/index.html`

The report includes input product, cutout, room, tap marker, output artifact reference, provider/model, prompt version, recipe version, params, cost, latency, gate scores, baseline comparison, pass/fail badge, and manual review fields.

## Retention

Generated shopper images and uploaded room photos are private Supabase Storage objects. Signed reads are temporary. Retention purge jobs remove expired room/render objects while preserving database audit records.

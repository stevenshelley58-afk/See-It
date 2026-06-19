import { repository } from "@/lib/db/repository";

export const REQUIRED_TRACE_EVENTS = [
  "render_request_created",
  "asset_upload_url_issued",
  "asset_upload_verified",
  "room_normalized",
  "product_cutout_selected",
  "prompt_bundle_resolved",
  "model_route_selected",
  "ai_invocation_created",
  "provider_request_sent",
  "provider_response_received",
  "provider_output_stored",
  "quality_gate_started",
  "quality_gate_completed",
  "render_retry_scheduled",
  "render_escalated",
  "render_accepted",
  "render_rejected",
  "render_failed",
  "render_result_signed",
  "render_shown",
  "feedback_submitted",
  "replay_created",
  "manual_review_submitted"
];

export function traceRender(traceId: string, eventName: string, props: Record<string, unknown> = {}, renderRequestId?: string, eventLevel: "debug" | "info" | "warn" | "error" = "info") {
  return repository.trace({ traceId, renderRequestId, eventName, eventLevel, props });
}

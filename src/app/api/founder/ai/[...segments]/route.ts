import { NextRequest, NextResponse } from "next/server";
import { ensureAiRegistrySeeded, listModels, listProviders } from "@/lib/ai/registry";
import { repository } from "@/lib/db/repository";

export async function GET(_request: NextRequest, { params }: { params: { segments: string[] } }) {
  ensureAiRegistrySeeded();
  const [resource] = params.segments;
  if (resource === "providers") return NextResponse.json({ providers: listProviders() });
  if (resource === "models") return NextResponse.json({ models: listModels() });
  if (resource === "prompts") return NextResponse.json({ templates: [...repository.promptTemplates.values()], versions: [...repository.promptVersions.values()] });
  if (resource === "bundles") return NextResponse.json({ bundles: [...repository.bundles.values()], versions: [...repository.bundleVersions.values()] });
  if (resource === "recipes") return NextResponse.json({ recipes: [...repository.recipes.values()], versions: [...repository.recipeVersions.values()] });
  if (resource === "deployments") return NextResponse.json({ deployments: [...repository.deployments.values()] });
  return NextResponse.json({ ok: true, resource, segments: params.segments });
}

export async function POST(request: NextRequest, { params }: { params: { segments: string[] } }) {
  ensureAiRegistrySeeded();
  const body = await request.json().catch(() => ({}));
  const [resource, id, action] = params.segments;
  if (resource === "prompt-versions" && action === "approve") {
    return NextResponse.json(repository.updatePromptVersion(id, { status: "approved", approvedBy: "founder", approvedAt: new Date().toISOString() }));
  }
  if (resource === "prompt-versions" && action === "archive") {
    return NextResponse.json(repository.updatePromptVersion(id, { status: "archived" }));
  }
  if (resource === "deployments" && action === "rollback") {
    return NextResponse.json(repository.rollbackDeployment(id, "founder", String(body.reason ?? "manual rollback")));
  }
  if (resource === "deployments" && action === "pause") {
    const current = repository.mustGet(repository.deployments, id, "prompt_deployment");
    const next = { ...current, status: "paused" as const, endedAt: new Date().toISOString() };
    repository.deployments.set(id, next);
    return NextResponse.json(next);
  }
  repository.audit("founder", "api_write", resource ?? "ai", undefined, undefined, body, "founder api");
  return NextResponse.json({ ok: true, resource, body });
}

export async function PATCH(request: NextRequest, { params }: { params: { segments: string[] } }) {
  const body = await request.json().catch(() => ({}));
  repository.audit("founder", "api_patch", params.segments.join("/"), undefined, undefined, body, "founder api");
  return NextResponse.json({ ok: true, body });
}

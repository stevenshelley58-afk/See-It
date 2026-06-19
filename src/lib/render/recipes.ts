import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { repository } from "@/lib/db/repository";
import type { RenderKind, Surface } from "@/lib/db/schema";

export function resolveActiveRecipe(surface: Surface, kind: RenderKind) {
  ensureAiRegistrySeeded();
  const deployment = repository.findActiveDeployment(surface);
  if (!deployment) {
    throw new Error("No active prompt deployment for " + surface);
  }
  const version = repository.mustGet(repository.recipeVersions, deployment.renderRecipeVersionId, "render_recipe_version");
  const recipe = repository.mustGet(repository.recipes, version.renderRecipeId, "render_recipe");
  if (recipe.kind !== kind && kind !== "replay" && kind !== "eval") {
    throw new Error("Active recipe kind mismatch: " + recipe.kind + " != " + kind);
  }
  return { deployment, recipe, recipeVersion: version };
}

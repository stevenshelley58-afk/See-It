import { ListChecks } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Render recipes</h1>
          <p>Recipe versions connecting prompt bundles, route policies, gate policy, retry policy, storage, and output rules.</p>
        </div>
        <span className="status-pill">recipe data</span>
      </div>
      <div className="metric-grid">
        <Metric label="Recipes" value={control.recipes.length} />
        <Metric label="Recipe versions" value={control.recipeVersions.length} />
        <Metric label="Route policies" value={control.routePolicies.length} />
      </div>
      <section className="band">
        <div className="toolbar"><ListChecks size={18} /><strong>Recipe versions</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Recipe</th><th>Kind</th><th>Version</th><th>Status</th><th>Bundle</th><th>Route policy</th></tr></thead>
        <tbody>
          {control.recipeVersions.length === 0 ? <tr><td colSpan={6}>No recipe versions.</td></tr> : control.recipeVersions.map((version) => {
            const recipe = control.recipes.find((item) => item.id === version.renderRecipeId);
            return (
              <tr key={version.id}>
                <td>{recipe?.name ?? version.renderRecipeId}</td>
                <td>{recipe?.kind ?? "-"}</td>
                <td>{version.version}</td>
                <td>{version.status}</td>
                <td>{version.promptBundleVersionId}</td>
                <td>{version.modelRoutePolicyId}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Shell>
  );
}

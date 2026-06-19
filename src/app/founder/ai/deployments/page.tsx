import { Rocket } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane } from "@/lib/db/supabase-persistence";

export default async function DeploymentsPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const active = control.deployments.filter((deployment) => deployment.status === "active").length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Deployments</h1>
          <p>Active, paused, and rolled-back prompt recipe deployments by surface and task.</p>
        </div>
        <span className="status-pill">rollback-ready</span>
      </div>
      <div className="metric-grid">
        <Metric label="Deployments" value={control.deployments.length} />
        <Metric label="Active" value={active} />
        <Metric label="Recipe versions" value={control.recipeVersions.length} />
      </div>
      <section className="band">
        <div className="toolbar"><Rocket size={18} /><strong>Deployment history</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Started</th><th>Surface</th><th>Task</th><th>Status</th><th>Traffic</th><th>Recipe version</th><th>Reason</th></tr></thead>
        <tbody>
          {control.deployments.length === 0 ? <tr><td colSpan={7}>No deployments.</td></tr> : control.deployments.map((deployment) => (
            <tr key={deployment.id}>
              <td>{deployment.startedAt}</td>
              <td>{deployment.surface}</td>
              <td>{deployment.taskType ?? "-"}</td>
              <td>{deployment.status}</td>
              <td>{deployment.trafficPercent}%</td>
              <td>{deployment.renderRecipeVersionId}</td>
              <td>{deployment.reason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

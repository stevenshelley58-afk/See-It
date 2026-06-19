import { Cpu } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const enabled = control.models.filter((model) => model.status === "enabled").length;
  const testing = control.models.filter((model) => model.status === "testing").length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Models</h1>
          <p>Capability-based model registry with allowed tasks, pricing snapshots, and provider routing metadata.</p>
        </div>
        <span className="status-pill">swappable</span>
      </div>
      <div className="metric-grid">
        <Metric label="Models" value={control.models.length} />
        <Metric label="Enabled" value={enabled} />
        <Metric label="Testing" value={testing} />
        <Metric label="Capabilities" value={new Set(control.models.flatMap((model) => model.capabilities)).size} />
      </div>
      <section className="band">
        <div className="toolbar"><Cpu size={18} /><strong>Model registry</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Model</th><th>Provider</th><th>Status</th><th>Tasks</th><th>Capabilities</th><th>Pricing</th></tr></thead>
        <tbody>
          {control.models.map((model) => (
            <tr key={model.id}>
              <td>{model.displayName}</td>
              <td>{model.providerKey}</td>
              <td>{model.status}</td>
              <td>{model.allowedTasks.length}</td>
              <td>{model.capabilities.slice(0, 4).join(", ")}{model.capabilities.length > 4 ? "..." : ""}</td>
              <td>{JSON.stringify(model.pricing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

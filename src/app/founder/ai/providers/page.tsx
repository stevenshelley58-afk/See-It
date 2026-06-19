import { Plug } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const enabled = control.providers.filter((provider) => provider.status === "enabled").length;
  const degraded = control.providers.filter((provider) => provider.status === "degraded").length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Providers</h1>
          <p>Adapter versions, secret references, docs links, and enabled/degraded provider state.</p>
        </div>
        <span className="status-pill">database</span>
      </div>
      <div className="metric-grid">
        <Metric label="Providers" value={control.providers.length} />
        <Metric label="Enabled" value={enabled} />
        <Metric label="Degraded" value={degraded} />
        <Metric label="Models" value={control.models.length} />
      </div>
      <section className="band">
        <div className="toolbar"><Plug size={18} /><strong>Provider registry</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Provider</th><th>Status</th><th>Adapter</th><th>Secret ref</th><th>Models</th><th>Docs</th></tr></thead>
        <tbody>
          {control.providers.map((provider) => (
            <tr key={provider.id}>
              <td>{provider.displayName}</td>
              <td>{provider.status}</td>
              <td>{provider.adapterKey} {provider.adapterVersion}</td>
              <td>{provider.secretRef ?? "-"}</td>
              <td>{control.models.filter((model) => model.providerId === provider.id).length}</td>
              <td>{provider.docsUrl ? <a href={provider.docsUrl}>Open</a> : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

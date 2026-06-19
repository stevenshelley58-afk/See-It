import { Boxes } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane } from "@/lib/db/supabase-persistence";

export default async function BundlesPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Prompt bundles</h1>
          <p>Versioned prompt bundle maps used by render recipes and deployment activation.</p>
        </div>
        <span className="status-pill">versioned</span>
      </div>
      <div className="metric-grid">
        <Metric label="Bundles" value={control.bundles.length} />
        <Metric label="Bundle versions" value={control.bundleVersions.length} />
        <Metric label="Approved versions" value={control.bundleVersions.filter((version) => version.status === "approved" || version.status === "active").length} />
      </div>
      <section className="band">
        <div className="toolbar"><Boxes size={18} /><strong>Bundle versions</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Bundle</th><th>Version</th><th>Status</th><th>Prompt map</th><th>Hash</th></tr></thead>
        <tbody>
          {control.bundleVersions.length === 0 ? <tr><td colSpan={5}>No bundles.</td></tr> : control.bundleVersions.map((version) => (
            <tr key={version.id}>
              <td>{control.bundles.find((bundle) => bundle.id === version.promptBundleId)?.name ?? version.promptBundleId}</td>
              <td>{version.version}</td>
              <td>{version.status}</td>
              <td>{Object.keys(version.promptVersionMap).join(", ")}</td>
              <td>{version.bundleHash.slice(0, 14)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

import { GitCompareArrows, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane, loadExperimentOverview } from "@/lib/db/supabase-persistence";

export default async function FounderAiPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const { experiments } = await loadExperimentOverview();
  const activeDeployments = control.deployments.filter((deployment) => deployment.status === "active").length;
  const enabledProviders = control.providers.filter((provider) => provider.status === "enabled").length;
  const enabledModels = control.models.filter((model) => model.status === "enabled").length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>AI control center</h1>
          <p>Provider routing, model capabilities, prompt versions, deployments, experiments, replay, benchmarks, and audit events.</p>
        </div>
        <div className="toolbar">
          <Link className="btn" href="/founder/ai/replay"><RotateCcw size={16} />Replay</Link>
          <Link className="btn" href="/founder/ai/test-lab"><Play size={16} />Test</Link>
          <Link className="btn primary" href="/founder/ai/prompts"><GitCompareArrows size={16} />Prompts</Link>
        </div>
      </div>
      <div className="metric-grid">
        <Metric label="Enabled providers" value={enabledProviders} />
        <Metric label="Enabled models" value={enabledModels} />
        <Metric label="Prompt versions" value={control.promptVersions.length} />
        <Metric label="Active deployments" value={activeDeployments} />
        <Metric label="Route policies" value={control.routePolicies.length} />
        <Metric label="Running experiments" value={experiments.filter((experiment) => experiment.status === "running").length} />
      </div>
      <table className="table">
        <thead><tr><th>Provider</th><th>Status</th><th>Adapter</th><th>Models</th><th>Docs</th></tr></thead>
        <tbody>
          {control.providers.map((provider) => (
            <tr key={provider.id}>
              <td>{provider.displayName}</td>
              <td><span className="status-pill">{provider.status}</span></td>
              <td>{provider.adapterVersion}</td>
              <td>{control.models.filter((model) => model.providerKey === provider.providerKey).length}</td>
              <td>{provider.docsUrl ? <a href={provider.docsUrl}>Open</a> : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

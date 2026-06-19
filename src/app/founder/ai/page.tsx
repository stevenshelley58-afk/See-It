import { GitCompareArrows, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded, listModels, listProviders } from "@/lib/ai/registry";

export default function FounderAiPage() {
  ensureAiRegistrySeeded();
  const providers = listProviders();
  const models = listModels();
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
      <table className="table">
        <thead><tr><th>Provider</th><th>Status</th><th>Adapter</th><th>Models</th></tr></thead>
        <tbody>
          {providers.map((provider) => (
            <tr key={provider.id}>
              <td>{provider.displayName}</td>
              <td><span className="status-pill">{provider.status}</span></td>
              <td>{provider.adapterVersion}</td>
              <td>{models.filter((model) => model.providerKey === provider.providerKey).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

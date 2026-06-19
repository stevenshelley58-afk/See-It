import { Activity, Gauge } from "lucide-react";
import Link from "next/link";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { getFounderDashboard } from "@/lib/founder/dashboard";

export default async function FounderHomePage() {
  ensureAiRegistrySeeded();
  const data = await getFounderDashboard();
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Founder operations</h1>
          <p>{data.todaysAction}</p>
        </div>
        <Link className="btn primary" href="/founder/renders"><Activity size={16} />Render traces</Link>
      </div>
      <div className="metric-grid">
        <Metric label="Renders today" value={data.rendersToday} />
        <Metric label="Accepted rate" value={Math.round(data.acceptedRenderRate * 100) + "%"} />
        <Metric label="Gate rejection" value={Math.round(data.gateRejectionRate * 100) + "%"} />
        <Metric label="Provider errors" value={Math.round(data.providerErrorRate * 100) + "%"} />
        <Metric label="p95 latency" value={data.p95Latency + "ms"} />
        <Metric label="Cost today" value={"$" + data.costToday} />
      </div>
      <section className="band">
        <div className="toolbar"><Gauge size={18} /><strong>Active controls</strong></div>
        <p className="muted">Prompt deployments: {data.activePromptDeployments}. Models available: {data.models.length}. Providers available: {data.providers.length}.</p>
      </section>
    </Shell>
  );
}

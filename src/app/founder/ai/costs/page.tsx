import { DollarSign } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { repository } from "@/lib/db/repository";
import { loadAiControlPlane, loadAiInvocations } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const invocations = await loadAiInvocations(1000);
  const total = invocations.reduce((sum, invocation) => sum + (invocation.costEstimateUsd ?? 0), 0);
  const failedCost = invocations.filter((invocation) => invocation.status === "failed").reduce((sum, invocation) => sum + (invocation.costEstimateUsd ?? 0), 0);
  const acceptedCount = invocations.filter((invocation) => invocation.status === "succeeded").length;
  const byModel = invocations.reduce<Record<string, { count: number; cost: number; failures: number }>>((acc, invocation) => {
    const provider = repository.providers.get(invocation.providerId);
    const model = repository.models.get(invocation.aiModelId);
    const key = (provider?.providerKey ?? invocation.providerId) + " / " + (model?.modelKey ?? invocation.aiModelId);
    const row = acc[key] ?? { count: 0, cost: 0, failures: 0 };
    row.count += 1;
    row.cost += invocation.costEstimateUsd ?? 0;
    row.failures += invocation.status === "failed" ? 1 : 0;
    acc[key] = row;
    return acc;
  }, {});

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>AI costs</h1>
          <p>Spend by provider/model, failed render cost, and cost per accepted AI result.</p>
        </div>
        <span className="status-pill">durable</span>
      </div>
      <div className="metric-grid">
        <Metric label="Total cost" value={"$" + total.toFixed(4)} />
        <Metric label="Failed cost" value={"$" + failedCost.toFixed(4)} />
        <Metric label="Invocations" value={invocations.length} />
        <Metric label="Cost per accepted" value={"$" + (acceptedCount ? total / acceptedCount : 0).toFixed(4)} />
      </div>
      <section className="band">
        <div className="toolbar"><DollarSign size={18} /><strong>Provider and model cost</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Provider / model</th><th>Invocations</th><th>Failures</th><th>Cost</th></tr></thead>
        <tbody>
          {Object.entries(byModel).length === 0 ? <tr><td colSpan={4}>No AI cost records yet.</td></tr> : Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost).map(([key, row]) => (
            <tr key={key}>
              <td>{key}</td>
              <td>{row.count}</td>
              <td>{row.failures}</td>
              <td>{"$" + row.cost.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

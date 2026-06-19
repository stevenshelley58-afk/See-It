import { listModels, listProviders } from "@/lib/ai/registry";
import { repository } from "@/lib/db/repository";

export function getFounderDashboard() {
  const renders = [...repository.renderRequests.values()];
  const invocations = [...repository.aiInvocations.values()];
  const accepted = renders.filter((render) => render.status === "done").length;
  const failed = renders.filter((render) => render.status === "failed").length;
  const costs = invocations.reduce((sum, invocation) => sum + (invocation.costEstimateUsd ?? 0), 0);
  return {
    rendersToday: renders.length,
    acceptedRenderRate: renders.length ? accepted / renders.length : 0,
    gateRejectionRate: renders.length ? failed / renders.length : 0,
    providerErrorRate: invocations.length ? invocations.filter((invocation) => invocation.status === "failed").length / invocations.length : 0,
    p50Latency: percentile(invocations.map((invocation) => invocation.latencyMs ?? 0), 0.5),
    p95Latency: percentile(invocations.map((invocation) => invocation.latencyMs ?? 0), 0.95),
    costToday: Number(costs.toFixed(4)),
    costPerAcceptedRender: accepted ? Number((costs / accepted).toFixed(4)) : 0,
    activePromptDeployments: [...repository.deployments.values()].filter((deployment) => deployment.status === "active").length,
    activeExperiments: [...repository.experiments.values()].filter((experiment) => experiment.status === "running").length,
    shopsNeedingAttention: [...repository.shops.values()].filter((shop) => shop.uninstalledAt || shop.plan === "cancelled").length,
    providers: listProviders(),
    models: listModels(),
    todaysAction: "Review failed render traces and benchmark any prompt changes before activation."
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

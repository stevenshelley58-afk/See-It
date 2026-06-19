import { BarChart3 } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadEvalOverview } from "@/lib/db/supabase-persistence";

export default async function EvalsPage() {
  const { datasets, cases, runs, results } = await loadEvalOverview();
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const passRate = results.length ? Math.round((passed / results.length) * 100) : 0;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Evaluations</h1>
          <p>Fixture datasets, benchmark runs, pass rates, failed cases, and render links for prompt or model promotion.</p>
        </div>
        <span className="status-pill">durable</span>
      </div>
      <div className="metric-grid">
        <Metric label="Datasets" value={datasets.length} />
        <Metric label="Cases" value={cases.length} />
        <Metric label="Completed runs" value={completedRuns} />
        <Metric label="Pass rate" value={passRate + "%"} />
        <Metric label="Failed results" value={failed} />
      </div>
      <section className="band">
        <div className="toolbar"><BarChart3 size={18} /><strong>Recent eval runs</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Created</th><th>Run</th><th>Dataset</th><th>Status</th><th>Results</th></tr></thead>
        <tbody>
          {runs.length === 0 ? <tr><td colSpan={5}>No eval runs yet.</td></tr> : runs.slice(0, 20).map((run) => (
            <tr key={run.id}>
              <td>{run.createdAt}</td>
              <td>{run.name ?? run.id}</td>
              <td>{datasets.find((dataset) => dataset.id === run.evalDatasetId)?.name ?? run.evalDatasetId}</td>
              <td>{run.status}</td>
              <td>{results.filter((result) => result.evalRunId === run.id).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

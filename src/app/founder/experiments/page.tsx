import { FlaskConical } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadExperimentOverview } from "@/lib/db/supabase-persistence";

export default async function ExperimentsPage() {
  const { experiments, arms, assignments } = await loadExperimentOverview();
  const running = experiments.filter((experiment) => experiment.status === "running").length;
  const paused = experiments.filter((experiment) => experiment.status === "paused").length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Experiments</h1>
          <p>Prompt, model, recipe, gate, fallback, and parameter tests with arm assignment and promotion state.</p>
        </div>
        <span className="status-pill">durable</span>
      </div>
      <div className="metric-grid">
        <Metric label="Experiments" value={experiments.length} />
        <Metric label="Running" value={running} />
        <Metric label="Paused" value={paused} />
        <Metric label="Arms" value={arms.length} />
        <Metric label="Assignments" value={assignments.length} />
      </div>
      <section className="band">
        <div className="toolbar"><FlaskConical size={18} /><strong>Active experiment controls</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Updated</th><th>Name</th><th>Surface</th><th>Type</th><th>Status</th><th>Traffic</th><th>Arms</th></tr></thead>
        <tbody>
          {experiments.length === 0 ? <tr><td colSpan={7}>No experiments yet.</td></tr> : experiments.slice(0, 20).map((experiment) => (
            <tr key={experiment.id}>
              <td>{experiment.updatedAt}</td>
              <td>{experiment.name}</td>
              <td>{experiment.surface}</td>
              <td>{experiment.type}</td>
              <td>{experiment.status}</td>
              <td>{experiment.trafficPercent}%</td>
              <td>{arms.filter((arm) => arm.experimentId === experiment.id).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

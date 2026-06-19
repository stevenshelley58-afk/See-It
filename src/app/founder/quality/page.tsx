import { ShieldCheck } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadEvalOverview, loadFounderRenderRequests, loadManualReviews } from "@/lib/db/supabase-persistence";

function gateBand(score?: number) {
  if (score === undefined) {
    return "missing";
  }
  if (score < 6) {
    return "0-5";
  }
  if (score < 8) {
    return "6-7";
  }
  return "8-10";
}

export default async function QualityPage() {
  const [renders, reviews, evals] = await Promise.all([loadFounderRenderRequests(500), loadManualReviews(200), loadEvalOverview()]);
  const rejected = renders.filter((render) => render.status === "failed" || render.finalErrorCode === "gate_rejected").length;
  const accepted = renders.filter((render) => render.status === "done").length;
  const evalPassRate = evals.results.length ? Math.round((evals.results.filter((result) => result.status === "pass").length / evals.results.length) * 100) : 0;
  const gateBands = renders.reduce<Record<string, number>>((acc, render) => {
    const key = gateBand(render.finalGateScore);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const failureTags = reviews.flatMap((review) => review.issueTags).reduce<Record<string, number>>((acc, tag) => {
    acc[tag] = (acc[tag] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Quality</h1>
          <p>Gate outcomes, manual review queue, recurring failure tags, and fixture pass rates.</p>
        </div>
        <span className="status-pill">durable</span>
      </div>
      <div className="metric-grid">
        <Metric label="Accepted renders" value={accepted} />
        <Metric label="Rejected renders" value={rejected} />
        <Metric label="Manual reviews" value={reviews.length} />
        <Metric label="Eval pass rate" value={evalPassRate + "%"} />
        <Metric label="Low gate scores" value={gateBands["0-5"] ?? 0} />
      </div>
      <div className="split">
        <section className="band">
          <div className="toolbar"><ShieldCheck size={18} /><strong>Gate score histogram</strong></div>
          <table className="table">
            <tbody>
              {["8-10", "6-7", "0-5", "missing"].map((band) => (
                <tr key={band}><td>{band}</td><td>{gateBands[band] ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="band">
          <div className="toolbar"><ShieldCheck size={18} /><strong>Top failure tags</strong></div>
          <table className="table">
            <tbody>
              {Object.entries(failureTags).length === 0 ? <tr><td>No manual tags yet.</td></tr> : Object.entries(failureTags).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => (
                <tr key={tag}><td>{tag}</td><td>{count}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <table className="table">
        <thead><tr><th>Created</th><th>Render</th><th>Status</th><th>Score</th><th>Tags</th></tr></thead>
        <tbody>
          {reviews.length === 0 ? <tr><td colSpan={5}>No manual review queue yet.</td></tr> : reviews.slice(0, 20).map((review) => (
            <tr key={review.id}>
              <td>{review.createdAt}</td>
              <td>{review.renderRequestId}</td>
              <td>{review.status}</td>
              <td>{review.score ?? "-"}</td>
              <td>{review.issueTags.join(", ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadFounderRenderRequests } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function ReplayPage() {
  const renders = await loadFounderRenderRequests(200);
  const replayable = renders.filter((render) => render.roomSessionId && render.status === "done");

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Replay</h1>
          <p>Historical renders that can be rerun through alternate prompt versions, route policies, or models.</p>
        </div>
        <span className="status-pill">durable jobs</span>
      </div>
      <div className="metric-grid">
        <Metric label="Renders" value={renders.length} />
        <Metric label="Replayable" value={replayable.length} />
        <Metric label="Replay jobs" value={renders.filter((render) => render.kind === "replay").length} />
      </div>
      <section className="band">
        <div className="toolbar"><RotateCcw size={18} /><strong>Replay candidates</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Created</th><th>Render</th><th>Kind</th><th>Status</th><th>Trace</th><th>Open</th></tr></thead>
        <tbody>
          {replayable.length === 0 ? <tr><td colSpan={6}>No replayable renders yet.</td></tr> : replayable.slice(0, 30).map((render) => (
            <tr key={render.id}>
              <td>{render.createdAt}</td>
              <td>{render.id}</td>
              <td>{render.kind}</td>
              <td>{render.status}</td>
              <td>{render.traceId}</td>
              <td><Link href={"/founder/renders/" + render.id}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

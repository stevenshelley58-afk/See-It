import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { loadFounderRenderRequests } from "@/lib/db/supabase-persistence";

export default async function RenderOperationsPage() {
  const renders = await loadFounderRenderRequests();
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Render operations</h1>
          <p>Every render request, attempt, prompt snapshot, provider payload, gate decision, cost, latency, asset, replay, and feedback record.</p>
        </div>
        <Link className="btn primary" href="/founder/ai/replay"><RotateCcw size={16} />Replay</Link>
      </div>
      <table className="table">
        <thead><tr><th>Created</th><th>Render</th><th>Surface</th><th>Status</th><th>Gate</th><th>Attempts</th><th>Open</th></tr></thead>
        <tbody>
          {renders.length === 0 ? <tr><td colSpan={7}>No renders yet.</td></tr> : renders.map((render) => (
            <tr key={render.id}>
              <td>{render.createdAt}</td>
              <td>{render.id}</td>
              <td>{render.surface}</td>
              <td>{render.status}</td>
              <td>{render.finalGateScore ?? "-"}</td>
              <td>{render.attemptCount}</td>
              <td><Link href={"/founder/renders/" + render.id}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

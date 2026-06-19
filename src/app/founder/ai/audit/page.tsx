import { ClipboardList } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadAuditLogs } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const audits = await loadAuditLogs(300);
  const promptActions = audits.filter((audit) => audit.entityType.includes("prompt")).length;
  const renderActions = audits.filter((audit) => audit.entityType.includes("render")).length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>AI audit</h1>
          <p>Founder changes to prompts, deployments, experiments, manual review, replay, and fixture promotion.</p>
        </div>
        <span className="status-pill">append-only</span>
      </div>
      <div className="metric-grid">
        <Metric label="Audit rows" value={audits.length} />
        <Metric label="Prompt actions" value={promptActions} />
        <Metric label="Render actions" value={renderActions} />
      </div>
      <section className="band">
        <div className="toolbar"><ClipboardList size={18} /><strong>Recent audit events</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Created</th><th>Actor</th><th>Action</th><th>Entity</th><th>Reason</th></tr></thead>
        <tbody>
          {audits.length === 0 ? <tr><td colSpan={5}>No audit events yet.</td></tr> : audits.map((audit) => (
            <tr key={audit.id}>
              <td>{audit.createdAt}</td>
              <td>{audit.actor}</td>
              <td>{audit.action}</td>
              <td>{audit.entityType}{audit.entityId ? " / " + audit.entityId : ""}</td>
              <td>{audit.reason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

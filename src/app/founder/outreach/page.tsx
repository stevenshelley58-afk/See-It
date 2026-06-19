import { Send } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadOutreachOverview } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const { prospects, suppressions } = await loadOutreachOverview();
  const approved = prospects.filter((prospect) => prospect.status === "approved").length;
  const sent = prospects.filter((prospect) => prospect.status === "sent").length;
  const customers = prospects.filter((prospect) => prospect.status === "customer").length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Outreach</h1>
          <p>Demo prospects, approval state, sender sync status, email suppression, and conversion state.</p>
        </div>
        <span className="status-pill">growth</span>
      </div>
      <div className="metric-grid">
        <Metric label="Prospects" value={prospects.length} />
        <Metric label="Approved" value={approved} />
        <Metric label="Sent" value={sent} />
        <Metric label="Customers" value={customers} />
        <Metric label="Suppressions" value={suppressions.length} />
      </div>
      <section className="band">
        <div className="toolbar"><Send size={18} /><strong>Prospect queue</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Updated</th><th>Store</th><th>Email</th><th>Score</th><th>Status</th><th>Demo</th></tr></thead>
        <tbody>
          {prospects.length === 0 ? <tr><td colSpan={6}>No prospects yet.</td></tr> : prospects.map((prospect) => (
            <tr key={String(prospect.id)}>
              <td>{String(prospect.updated_at ?? prospect.created_at ?? "-")}</td>
              <td>{String(prospect.store_domain ?? prospect.store_name ?? "-")}</td>
              <td>{String(prospect.contact_email ?? "-")}</td>
              <td>{String(prospect.score ?? "-")}</td>
              <td>{String(prospect.status ?? "-")}</td>
              <td>{String(prospect.demo_slug ?? "-")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

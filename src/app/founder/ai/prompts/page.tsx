import { GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const approved = control.promptVersions.filter((version) => version.status === "approved" || version.status === "active").length;
  const drafts = control.promptVersions.filter((version) => version.status === "draft" || version.status === "review").length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Prompts</h1>
          <p>Prompt templates and versioned instructions with approval, comparison, deployment, and rollback readiness.</p>
        </div>
        <span className="status-pill">versioned</span>
      </div>
      <div className="metric-grid">
        <Metric label="Templates" value={control.promptTemplates.length} />
        <Metric label="Versions" value={control.promptVersions.length} />
        <Metric label="Approved" value={approved} />
        <Metric label="Draft/review" value={drafts} />
      </div>
      <section className="band">
        <div className="toolbar"><GitCompareArrows size={18} /><strong>Prompt templates</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Name</th><th>Surface</th><th>Task</th><th>Versions</th><th>Latest status</th><th>Open</th></tr></thead>
        <tbody>
          {control.promptTemplates.map((template) => {
            const versions = control.promptVersions.filter((version) => version.promptTemplateId === template.id);
            const latest = versions.sort((a, b) => b.version - a.version)[0];
            return (
              <tr key={template.id}>
                <td>{template.name}</td>
                <td>{template.surface}</td>
                <td>{template.taskType}</td>
                <td>{versions.length}</td>
                <td>{latest?.status ?? "-"}</td>
                <td><Link href={"/founder/ai/prompts/" + template.id}>Open</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Shell>
  );
}

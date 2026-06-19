import { FileText } from "lucide-react";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function PromptDetailPage({ params }: { params: Promise<{ promptId: string }> }) {
  const { promptId } = await params;
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const template = control.promptTemplates.find((item) => item.id === promptId);
  const versions = control.promptVersions.filter((version) => version.promptTemplateId === promptId).sort((a, b) => b.version - a.version);

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>{template?.name ?? "Prompt"}</h1>
          <p>{template ? template.description ?? template.taskType : "Prompt template not found."}</p>
        </div>
        <span className="status-pill">{versions.length} versions</span>
      </div>
      <section className="band">
        <div className="toolbar"><FileText size={18} /><strong>Version history</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Version</th><th>Status</th><th>Approved</th><th>Hash</th><th>Instructions</th></tr></thead>
        <tbody>
          {versions.length === 0 ? <tr><td colSpan={5}>No prompt versions.</td></tr> : versions.map((version) => (
            <tr key={version.id}>
              <td>{version.version}</td>
              <td>{version.status}</td>
              <td>{version.approvedAt ?? "-"}</td>
              <td>{version.promptHash.slice(0, 14)}</td>
              <td>{version.userPromptTemplate.slice(0, 120)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

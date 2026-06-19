import { Play } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";
import { loadAiControlPlane, loadAiInvocations } from "@/lib/db/supabase-persistence";

export default async function TestLabPage() {
  const control = await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const invocations = await loadAiInvocations(200);
  const promptTests = invocations.filter((invocation) => invocation.taskType === "prompt_eval");
  const testableVersions = control.promptVersions.filter((version) => ["approved", "active", "draft", "review"].includes(version.status));

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Prompt test lab</h1>
          <p>Prompt versions available for one-off model tests, fixture evaluation, and benchmark comparison.</p>
        </div>
        <span className="status-pill">audited</span>
      </div>
      <div className="metric-grid">
        <Metric label="Testable versions" value={testableVersions.length} />
        <Metric label="Prompt test invocations" value={promptTests.length} />
        <Metric label="Failed tests" value={promptTests.filter((item) => item.status === "failed").length} />
      </div>
      <section className="band">
        <div className="toolbar"><Play size={18} /><strong>Prompt test inputs</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Prompt</th><th>Version</th><th>Status</th><th>Task</th><th>Hash</th></tr></thead>
        <tbody>
          {testableVersions.length === 0 ? <tr><td colSpan={5}>No prompt versions available.</td></tr> : testableVersions.slice(0, 30).map((version) => (
            <tr key={version.id}>
              <td>{control.promptTemplates.find((template) => template.id === version.promptTemplateId)?.name ?? version.promptTemplateId}</td>
              <td>{version.version}</td>
              <td>{version.status}</td>
              <td>{control.promptTemplates.find((template) => template.id === version.promptTemplateId)?.taskType ?? "-"}</td>
              <td>{version.promptHash.slice(0, 14)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

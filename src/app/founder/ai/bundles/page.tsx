import { Shell } from "@/components/shell";
import { ensureAiRegistrySeeded } from "@/lib/ai/registry";

export default function Page() {
  ensureAiRegistrySeeded();
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Prompt bundles</h1>
          <p>Inspectable records, route decisions, prompt snapshots, benchmark status, costs, failures, and audit history are managed from this surface.</p>
        </div>
        <span className="status-pill">observable</span>
      </div>
      <section className="band">
        <p className="muted">This screen is wired to the shared AI control plane and render observability model. Write APIs are audit logged.</p>
      </section>
    </Shell>
  );
}

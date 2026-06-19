import { Settings } from "lucide-react";
import { Shell } from "@/components/shell";

export default function Page() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Widget eligibility, retention, theme deep links, support contacts, and compliance state.</p>
        </div>
        <span className="status-pill">ready</span>
      </div>
      <section className="band">
        <div className="toolbar"><Settings size={18} /><strong>Settings</strong></div>
        <p className="muted">Widget eligibility, retention, theme deep links, support contacts, and compliance state.</p>
      </section>
    </Shell>
  );
}

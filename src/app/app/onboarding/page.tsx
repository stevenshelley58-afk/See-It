import { Settings } from "lucide-react";
import { Shell } from "@/components/shell";

export default function Page() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Onboarding</h1>
          <p>OAuth, product sync, dimension extraction, cutout generation, test render, and theme editor activation.</p>
        </div>
        <span className="status-pill">ready</span>
      </div>
      <section className="band">
        <div className="toolbar"><Settings size={18} /><strong>Onboarding</strong></div>
        <p className="muted">OAuth, product sync, dimension extraction, cutout generation, test render, and theme editor activation.</p>
      </section>
    </Shell>
  );
}

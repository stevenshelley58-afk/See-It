import { Settings } from "lucide-react";
import { Shell } from "@/components/shell";

export default function Page() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p>Trial, Starter, and Growth plans enforce shopper render and lifestyle image quotas.</p>
        </div>
        <span className="status-pill">ready</span>
      </div>
      <section className="band">
        <div className="toolbar"><Settings size={18} /><strong>Billing</strong></div>
        <p className="muted">Trial, Starter, and Growth plans enforce shopper render and lifestyle image quotas.</p>
      </section>
    </Shell>
  );
}

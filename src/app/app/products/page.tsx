import { Settings } from "lucide-react";
import { Shell } from "@/components/shell";

export default function Page() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>Product setup fields include dimensions, source image, cutout, readiness, enable state, and AI trace links.</p>
        </div>
        <span className="status-pill">ready</span>
      </div>
      <section className="band">
        <div className="toolbar"><Settings size={18} /><strong>Products</strong></div>
        <p className="muted">Product setup fields include dimensions, source image, cutout, readiness, enable state, and AI trace links.</p>
      </section>
    </Shell>
  );
}

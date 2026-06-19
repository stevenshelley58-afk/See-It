import { Settings } from "lucide-react";
import { Shell } from "@/components/shell";

export default function Page() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Lifestyle studio</h1>
          <p>Generate one approved lifestyle image from an approved recipe, then push approved media to Shopify.</p>
        </div>
        <span className="status-pill">ready</span>
      </div>
      <section className="band">
        <div className="toolbar"><Settings size={18} /><strong>Lifestyle studio</strong></div>
        <p className="muted">Generate one approved lifestyle image from an approved recipe, then push approved media to Shopify.</p>
      </section>
    </Shell>
  );
}

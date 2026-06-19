import { ArrowRight, ImageIcon, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Shell } from "@/components/shell";

export default function HomePage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>See It operations</h1>
          <p>Merchant setup, shopper previews, and founder AI control are routed through one observable render system.</p>
        </div>
        <Link className="btn primary" href="/app"><ArrowRight size={16} />Open app</Link>
      </div>
      <div className="split">
        <section className="band">
          <h2>Launch surfaces</h2>
          <div className="preview-grid">
            <div className="preview-tile"><ImageIcon size={32} /> Shopper room</div>
            <div className="preview-tile"><ImageIcon size={32} /> Lifestyle studio</div>
            <div className="preview-tile"><ShieldCheck size={32} /> AI trace</div>
          </div>
        </section>
        <aside className="band">
          <h2>Non-negotiables</h2>
          <p>No provider calls outside the AI router. No production prompt constants. Durable jobs own critical render work. Every render has trace, assets, invocations, gate result, replay, and cost visibility.</p>
        </aside>
      </div>
    </Shell>
  );
}

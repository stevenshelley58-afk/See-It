import { CheckCircle2, ExternalLink, ImagePlus } from "lucide-react";
import Link from "next/link";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";

export default function MerchantHomePage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Merchant setup</h1>
          <p>Configure one product, confirm dimensions, generate a cutout, test render, and enable the widget.</p>
        </div>
        <Link className="btn primary" href="/app/onboarding"><ImagePlus size={16} />Start setup</Link>
      </div>
      <div className="metric-grid">
        <Metric label="First render target" value="<5m" />
        <Metric label="PDP button target" value="<10m" />
        <Metric label="Trial renders" value="50" />
        <Metric label="Lifestyle test" value="1" />
      </div>
      <section className="band">
        <div className="toolbar"><CheckCircle2 size={18} /><strong>Activation flow</strong></div>
        <p className="muted">OAuth install, product sync, dimension confirmation, cutout generation, room upload, test render, widget enable, theme editor deep link.</p>
        <Link className="btn" href="/app/products"><ExternalLink size={16} />Products</Link>
      </section>
    </Shell>
  );
}

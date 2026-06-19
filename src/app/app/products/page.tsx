import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { Shell } from "@/components/shell";

export default function ProductsPage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>Product setups track dimensions, cutouts, readiness, widget enablement, and AI trace links.</p>
        </div>
        <span className="status-pill">product setup</span>
      </div>
      <section className="band">
        <div className="toolbar"><PackageCheck size={18} /><strong>Configured products</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Product</th><th>Dimensions</th><th>Cutout</th><th>Status</th><th>Widget</th><th>Open</th></tr></thead>
        <tbody>
          <tr>
            <td colSpan={6}>Product records appear after embedded product sync.</td>
          </tr>
        </tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <Link className="btn" href="/app/onboarding">Activation checklist</Link>
      </div>
    </Shell>
  );
}

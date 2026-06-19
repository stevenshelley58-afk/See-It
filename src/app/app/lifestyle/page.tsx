import { Images } from "lucide-react";
import { Shell } from "@/components/shell";

export default function LifestylePage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Lifestyle studio</h1>
          <p>Single-image lifestyle generation from approved recipes with approval state and Shopify media push queue.</p>
        </div>
        <span className="status-pill">release A</span>
      </div>
      <section className="band">
        <div className="toolbar"><Images size={18} /><strong>Lifestyle jobs</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Product</th><th>Recipe</th><th>Status</th><th>Approved</th><th>Media push</th></tr></thead>
        <tbody>
          <tr><td colSpan={5}>Lifestyle jobs appear after a merchant starts generation.</td></tr>
        </tbody>
      </table>
    </Shell>
  );
}

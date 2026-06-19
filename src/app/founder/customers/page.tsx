import { Users } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadFounderRenderRequests, loadShops } from "@/lib/db/supabase-persistence";

export default async function CustomersPage() {
  const [shops, renders] = await Promise.all([loadShops(), loadFounderRenderRequests(1000)]);
  const active = shops.filter((shop) => !shop.uninstalledAt && shop.plan !== "cancelled").length;
  const needingAttention = shops.filter((shop) => shop.uninstalledAt || shop.plan === "cancelled" || !shop.roomPreviewEnabled).length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>Installed shops, plan status, widget enablement, quota remaining, and recent render volume.</p>
        </div>
        <span className="status-pill">shops</span>
      </div>
      <div className="metric-grid">
        <Metric label="Shops" value={shops.length} />
        <Metric label="Active" value={active} />
        <Metric label="Needs attention" value={needingAttention} />
        <Metric label="Renders tracked" value={renders.length} />
      </div>
      <section className="band">
        <div className="toolbar"><Users size={18} /><strong>Shop health</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Installed</th><th>Shop</th><th>Plan</th><th>Billing</th><th>Widget</th><th>Render quota</th><th>Renders</th></tr></thead>
        <tbody>
          {shops.length === 0 ? <tr><td colSpan={7}>No shops installed yet.</td></tr> : shops.map((shop) => (
            <tr key={shop.id}>
              <td>{shop.installedAt}</td>
              <td>{shop.shopDomain}</td>
              <td>{shop.plan}</td>
              <td>{shop.billingStatus}</td>
              <td>{shop.roomPreviewEnabled ? "enabled" : "disabled"}</td>
              <td>{shop.rendersQuota}</td>
              <td>{renders.filter((render) => render.shopId === shop.id).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

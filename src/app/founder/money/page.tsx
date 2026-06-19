import { WalletCards } from "lucide-react";
import { Metric } from "@/components/metric";
import { Shell } from "@/components/shell";
import { loadAiInvocations, loadShops, loadUsageMonthly } from "@/lib/db/supabase-persistence";

function numberFrom(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
}

export default async function MoneyPage() {
  const [shops, usage, invocations] = await Promise.all([loadShops(), loadUsageMonthly(), loadAiInvocations(1000)]);
  const monthlyCost = usage.reduce((sum, row) => sum + numberFrom(row, "cost_estimate_usd"), 0);
  const invocationCost = invocations.reduce((sum, invocation) => sum + (invocation.costEstimateUsd ?? 0), 0);
  const trialShops = shops.filter((shop) => shop.plan === "trial").length;
  const paidShops = shops.filter((shop) => ["starter", "growth"].includes(shop.plan)).length;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Money</h1>
          <p>Shopify billing state, quota consumption, render starts, accepted renders, failed render cost, and AI spend.</p>
        </div>
        <span className="status-pill">billing</span>
      </div>
      <div className="metric-grid">
        <Metric label="Paid shops" value={paidShops} />
        <Metric label="Trial shops" value={trialShops} />
        <Metric label="Monthly usage cost" value={"$" + monthlyCost.toFixed(4)} />
        <Metric label="Invocation cost" value={"$" + invocationCost.toFixed(4)} />
      </div>
      <section className="band">
        <div className="toolbar"><WalletCards size={18} /><strong>Usage rollups</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Month</th><th>Shop</th><th>Started</th><th>Accepted</th><th>Failed</th><th>Lifestyle</th><th>Cost</th></tr></thead>
        <tbody>
          {usage.length === 0 ? <tr><td colSpan={7}>No monthly usage rollups yet.</td></tr> : usage.map((row) => (
            <tr key={String(row.shop_id) + String(row.month)}>
              <td>{String(row.month ?? "-")}</td>
              <td>{shops.find((shop) => shop.id === row.shop_id)?.shopDomain ?? String(row.shop_id ?? "-")}</td>
              <td>{numberFrom(row, "renders_started")}</td>
              <td>{numberFrom(row, "renders_accepted")}</td>
              <td>{numberFrom(row, "renders_failed")}</td>
              <td>{numberFrom(row, "lifestyle_images_used")}</td>
              <td>{"$" + numberFrom(row, "cost_estimate_usd").toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

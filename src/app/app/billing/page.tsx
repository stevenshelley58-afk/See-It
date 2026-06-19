import { CreditCard } from "lucide-react";
import { Shell } from "@/components/shell";
import { PLANS } from "@/lib/shopify/billing";

export default function BillingPage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p>Shopify billing status and quota limits for shopper renders and merchant lifestyle images.</p>
        </div>
        <span className="status-pill">Shopify billing</span>
      </div>
      <section className="band">
        <div className="toolbar"><CreditCard size={18} /><strong>Plans</strong></div>
      </section>
      <table className="table">
        <thead><tr><th>Plan</th><th>Price</th><th>Renders</th><th>Lifestyle images</th></tr></thead>
        <tbody>
          {Object.entries(PLANS).map(([name, plan]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{"$" + plan.priceUsd}</td>
              <td>{plan.renders}</td>
              <td>{plan.lifestyleImages}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

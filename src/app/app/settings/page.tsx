import { Settings } from "lucide-react";
import { Shell } from "@/components/shell";

export default function SettingsPage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Widget eligibility, retention policy, theme activation link, support contact, and compliance state.</p>
        </div>
        <span className="status-pill">store controls</span>
      </div>
      <section className="band">
        <div className="toolbar"><Settings size={18} /><strong>Store controls</strong></div>
      </section>
      <table className="table">
        <tbody>
          <tr><td>Room preview widget</td><td>enabled by shop state</td></tr>
          <tr><td>Generated image retention</td><td>7 days for shopper renders</td></tr>
          <tr><td>Privacy webhooks</td><td>customers/data_request, customers/redact, shop/redact</td></tr>
          <tr><td>Theme app extension</td><td>room preview block</td></tr>
        </tbody>
      </table>
    </Shell>
  );
}

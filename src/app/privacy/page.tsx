import { Clock, Database, ShieldCheck } from "lucide-react";
import { Shell } from "@/components/shell";

export default function PrivacyPage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Privacy</h1>
          <p>Temporary room-photo processing, private generated assets, Shopify privacy webhooks, and retention controls.</p>
        </div>
        <span className="status-pill">public policy</span>
      </div>
      <div className="split">
        <section className="band">
          <div className="toolbar"><ShieldCheck size={18} /><strong>Shopper data</strong></div>
          <p>See It processes shopper room photos only to generate the room preview requested by the shopper. The app does not create shopper accounts, collect shopper email, or provide a saved room gallery.</p>
          <table className="table">
            <tbody>
              <tr><td>Room uploads</td><td>Private Supabase Storage with 24 hour operational retention.</td></tr>
              <tr><td>Generated shopper renders</td><td>Private generated assets with 7 day retention for support and debugging.</td></tr>
              <tr><td>Trace metadata</td><td>Prompt, provider, gate, cost, and feedback metadata retained for render operations with secrets redacted.</td></tr>
              <tr><td>Merchant data</td><td>Product setup and lifestyle assets are retained while the Shopify app is installed or until merchant deletion/uninstall policy applies.</td></tr>
            </tbody>
          </table>
        </section>
        <aside className="band">
          <div className="toolbar"><Clock size={18} /><strong>Retention</strong></div>
          <p>Expired shopper assets are purged by scheduled jobs. If an asset is removed, render history keeps metadata needed for audit and replay while showing the asset as unavailable due to retention policy.</p>
          <div className="toolbar"><Database size={18} /><strong>Shopify compliance</strong></div>
          <p>Privacy webhooks for `customers/data_request`, `customers/redact`, and `shop/redact` are HMAC verified before work is accepted. App uninstall disables the widget, clears the offline token, updates billing state, and writes an event log.</p>
        </aside>
      </div>
    </Shell>
  );
}

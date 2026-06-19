import Link from "next/link";
import type { ReactNode } from "react";

const links = [
  ["/app", "Merchant"],
  ["/app/products", "Products"],
  ["/app/lifestyle", "Lifestyle"],
  ["/app/billing", "Billing"],
  ["/founder", "Founder"],
  ["/founder/ai", "AI"],
  ["/founder/renders", "Renders"],
  ["/founder/quality", "Quality"],
  ["/founder/ai/costs", "Costs"],
  ["/privacy", "Privacy"]
] as const;

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="app-shell">
      <nav className="side-nav" aria-label="Primary">
        <strong>See It</strong>
        {links.map(([href, label]) => (
          <Link href={href} key={href}>{label}</Link>
        ))}
      </nav>
      <section className="content">{children}</section>
    </main>
  );
}

import { repository } from "@/lib/db/repository";

export function createDemoSlug(storeDomain: string) {
  return storeDomain.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function recordDemoGenerated(storeDomain: string) {
  const slug = createDemoSlug(storeDomain);
  repository.event({ surface: "demo", name: "demo_generated", props: { storeDomain, slug } });
  return { slug, url: "/demo/" + slug };
}

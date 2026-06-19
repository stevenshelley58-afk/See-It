import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { loadRenderBundle } from "@/lib/db/supabase-persistence";

export const dynamic = "force-dynamic";

export default async function RenderDetailPage({ params }: { params: Promise<{ renderId: string }> }) {
  const { renderId } = await params;
  const bundle = await loadRenderBundle(renderId);
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Render trace</h1>
          <p>Prompt snapshots, inputs, outputs, provider responses, gate notes, costs, latency, storage keys, feedback, and replay controls.</p>
        </div>
        <Link className="btn primary" href={"/founder/renders/" + renderId + "/replay"}><RotateCcw size={16} />Replay</Link>
      </div>
      <section className="band">
        <pre>{JSON.stringify(bundle ?? { renderId, status: "not_found" }, null, 2)}</pre>
      </section>
    </Shell>
  );
}

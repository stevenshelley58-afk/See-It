import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { repository } from "@/lib/db/repository";

export default function RenderDetailPage({ params }: { params: { renderId: string } }) {
  const bundle = repository.renderRequests.has(params.renderId) ? repository.renderBundleForRequest(params.renderId) : undefined;
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Render trace</h1>
          <p>Prompt snapshots, inputs, outputs, provider responses, gate notes, costs, latency, storage keys, feedback, and replay controls.</p>
        </div>
        <Link className="btn primary" href={"/founder/renders/" + params.renderId + "/replay"}><RotateCcw size={16} />Replay</Link>
      </div>
      <section className="band">
        <pre>{JSON.stringify(bundle ?? { renderId: params.renderId, status: "not_found" }, null, 2)}</pre>
      </section>
    </Shell>
  );
}

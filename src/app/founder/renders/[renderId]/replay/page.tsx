import { Shell } from "@/components/shell";

export default async function RenderReplayPage({ params }: { params: Promise<{ renderId: string }> }) {
  const { renderId } = await params;
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Replay render</h1>
          <p>Source render {renderId} can be replayed with same or alternate prompt bundle, model, recipe, gate policy, fallback policy, and parameters.</p>
        </div>
        <span className="status-pill">founder only</span>
      </div>
      <section className="band">Replay creates a linked render_request and never mutates the original.</section>
    </Shell>
  );
}

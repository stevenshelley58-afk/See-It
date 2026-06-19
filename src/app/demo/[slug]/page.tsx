import { Shell } from "@/components/shell";

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Demo {slug}</h1>
          <p>Personalized generated preview assets expire under demo retention policy unless converted.</p>
        </div>
        <span className="status-pill">demo</span>
      </div>
      <div className="preview-grid">
        <div className="preview-tile">Product</div>
        <div className="preview-tile">Room render</div>
        <div className="preview-tile">Lifestyle</div>
      </div>
    </Shell>
  );
}

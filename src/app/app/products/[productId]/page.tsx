import { ImagePlus } from "lucide-react";
import { Shell } from "@/components/shell";

export default async function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Product detail</h1>
          <p>Dimensions, source asset, generated cutout, render test, enable state, and AI trace references.</p>
        </div>
        <span className="status-pill">{productId}</span>
      </div>
      <section className="band">
        <div className="toolbar"><ImagePlus size={18} /><strong>Product setup fields</strong></div>
        <div className="preview-grid">
          <div className="preview-tile">source image</div>
          <div className="preview-tile">cutout</div>
          <div className="preview-tile">test render</div>
        </div>
      </section>
      <table className="table">
        <tbody>
          <tr><td>Width cm</td><td>-</td></tr>
          <tr><td>Height cm</td><td>-</td></tr>
          <tr><td>Depth cm</td><td>-</td></tr>
          <tr><td>Category</td><td>-</td></tr>
          <tr><td>AI traces</td><td>-</td></tr>
        </tbody>
      </table>
    </Shell>
  );
}

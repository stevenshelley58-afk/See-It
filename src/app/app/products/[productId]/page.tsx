import { Settings } from "lucide-react";
import { Shell } from "@/components/shell";

export default function Page() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Product detail</h1>
          <p>Confirm dimensions, regenerate cutout, run a merchant test render, and open extraction or cutout AI traces.</p>
        </div>
        <span className="status-pill">ready</span>
      </div>
      <section className="band">
        <div className="toolbar"><Settings size={18} /><strong>Product detail</strong></div>
        <p className="muted">Confirm dimensions, regenerate cutout, run a merchant test render, and open extraction or cutout AI traces.</p>
      </section>
    </Shell>
  );
}

import { CheckCircle2 } from "lucide-react";
import { Shell } from "@/components/shell";

const steps = [
  ["OAuth install", "complete"],
  ["Product sync", "required"],
  ["Dimension confirmation", "required"],
  ["Cutout generation", "required"],
  ["Merchant test render", "required"],
  ["Widget enable", "required"],
  ["Theme editor deep link", "required"]
] as const;

export default function OnboardingPage() {
  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Onboarding</h1>
          <p>Activation checklist for getting one product from install to a working PDP button.</p>
        </div>
        <span className="status-pill">activation</span>
      </div>
      <table className="table">
        <thead><tr><th>Step</th><th>Status</th></tr></thead>
        <tbody>
          {steps.map(([step, status]) => (
            <tr key={step}>
              <td><span className="toolbar"><CheckCircle2 size={16} />{step}</span></td>
              <td>{status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

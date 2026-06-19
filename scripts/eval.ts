import { runBenchmarkSuite } from "@/lib/render/evals";

const report = runBenchmarkSuite();
if (!report.gate) {
  throw new Error("Eval smoke failed");
}
console.log("eval smoke passed " + report.passCount + "/" + report.total);

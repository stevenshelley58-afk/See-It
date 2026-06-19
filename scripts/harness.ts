import { mkdirSync, writeFileSync } from "node:fs";
import { runBenchmarkSuite } from "@/lib/render/evals";

const report = runBenchmarkSuite();
mkdirSync("out", { recursive: true });
mkdirSync("out/benchmarks/smoke", { recursive: true });
writeFileSync("out/harness-report.json", JSON.stringify(report, null, 2));
writeFileSync("out/harness-report.html", "<!doctype html><title>Harness</title><h1>See It Harness</h1><p>Pass " + report.passCount + "/" + report.total + "</p>");
writeFileSync("out/benchmarks/smoke/index.html", "<!doctype html><title>Benchmark</title><h1>Benchmark smoke</h1>");
if (!report.gate) {
  throw new Error("Harness gate failed");
}
console.log("harness smoke passed " + report.passCount + "/" + report.total);

import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { runBenchmarkSuite } from "@/lib/render/evals";

test("shopper widget and release gates are present", async () => {
  const widget = readFileSync("extension/assets/widget.js", "utf8");
  expect(widget).toContain("See it in your room");
  expect(widget).toContain("We couldn't get this one right");
  expect(statSync("extension/assets/widget.js").size).toBeLessThan(30 * 1024);
  const report = runBenchmarkSuite();
  expect(report.total).toBe(15);
  expect(report.passCount).toBeGreaterThanOrEqual(13);
});

import { mkdirSync, writeFileSync } from "node:fs";
import { runBenchmarkSuite } from "@/lib/render/evals";

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function compactJson(value: unknown) {
  return escapeHtml(JSON.stringify(value));
}

function resultCard(result: ReturnType<typeof runBenchmarkSuite>["results"][number]) {
  const badgeClass = result.status === "pass" ? "pass" : "fail";
  const gateScores = Object.entries(result.automatedScore.detail)
    .map(([name, score]) => "<li><span>" + escapeHtml(name) + "</span><strong>" + escapeHtml(score) + "</strong></li>")
    .join("");
  return `
    <article class="case">
      <header>
        <div>
          <h2>${escapeHtml(result.caseSlug)}</h2>
          <p>${escapeHtml(result.category)} · ${escapeHtml(result.inputProduct.dimensionsMm.widthMm)} x ${escapeHtml(result.inputProduct.dimensionsMm.heightMm)} x ${escapeHtml(result.inputProduct.dimensionsMm.depthMm)} mm</p>
        </div>
        <span class="badge ${badgeClass}">${escapeHtml(result.status)}</span>
      </header>
      <section class="media-grid">
        <figure><div class="asset">Product<br><code>${escapeHtml(result.inputProduct.assetKey)}</code></div><figcaption>input product</figcaption></figure>
        <figure><div class="asset">Cutout<br><code>${escapeHtml(result.inputCutout.assetKey)}</code></div><figcaption>input cutout</figcaption></figure>
        <figure><div class="asset room">Tap ${escapeHtml(result.tap.x)}, ${escapeHtml(result.tap.y)}<span class="tap"></span><code>${escapeHtml(result.inputRoom.assetKey)}</code></div><figcaption>input room and tap marker</figcaption></figure>
        <figure><div class="asset output">Output<br><code>${escapeHtml(result.outputImage.assetKey)}</code></div><figcaption>output image</figcaption></figure>
      </section>
      <dl class="meta">
        <div><dt>provider/model</dt><dd>${escapeHtml(result.provider)} / ${escapeHtml(result.model)}</dd></div>
        <div><dt>prompt version</dt><dd>${escapeHtml(result.promptVersion)}</dd></div>
        <div><dt>recipe version</dt><dd>${escapeHtml(result.recipeVersion)}</dd></div>
        <div><dt>params</dt><dd><code>${compactJson(result.params)}</code></dd></div>
        <div><dt>cost</dt><dd>$${escapeHtml(result.costEstimateUsd.toFixed(4))}</dd></div>
        <div><dt>latency</dt><dd>${escapeHtml(result.latencyMs)} ms</dd></div>
        <div><dt>baseline</dt><dd>${escapeHtml(result.baselineComparison)}</dd></div>
      </dl>
      <ul class="scores">${gateScores}</ul>
      <label class="review">Manual review ${result.manualReview.required ? "(required)" : "(optional)"}<textarea name="${escapeHtml(result.caseSlug)}-manual-review"></textarea></label>
    </article>
  `;
}

function htmlReport(report: ReturnType<typeof runBenchmarkSuite>, runId: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>See It Harness ${escapeHtml(runId)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #172026; background: #f7f8f9; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .summary { margin: 0 0 24px; color: #52616b; }
    .case { background: white; border: 1px solid #d9e0e6; border-radius: 8px; margin: 0 0 18px; padding: 18px; }
    .case header { display: flex; justify-content: space-between; gap: 16px; align-items: start; margin-bottom: 14px; }
    .case h2 { margin: 0 0 4px; font-size: 18px; }
    .case p { margin: 0; color: #52616b; }
    .badge { border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .badge.pass { color: #075e38; background: #dff7ea; }
    .badge.fail { color: #8b1d1d; background: #ffe1e1; }
    .media-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0 0 14px; }
    figure { margin: 0; }
    figcaption { margin-top: 6px; font-size: 12px; color: #52616b; }
    .asset { min-height: 118px; display: grid; place-items: center; text-align: center; border: 1px solid #d9e0e6; border-radius: 6px; background: #f3f5f7; position: relative; padding: 10px; overflow-wrap: anywhere; }
    .asset code { display: block; margin-top: 6px; font-size: 11px; color: #52616b; }
    .room { background: #eef5ff; }
    .output { background: #f1f7ef; }
    .tap { position: absolute; left: 42%; top: 68%; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #d13131; background: white; transform: translate(-50%, -50%); }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; }
    .meta div { border: 1px solid #e4e9ee; border-radius: 6px; padding: 8px; }
    dt { font-size: 11px; text-transform: uppercase; color: #52616b; margin-bottom: 4px; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .scores { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; padding: 0; margin: 0 0 12px; list-style: none; }
    .scores li { display: flex; justify-content: space-between; border: 1px solid #e4e9ee; border-radius: 6px; padding: 6px; font-size: 12px; gap: 8px; }
    .review { display: grid; gap: 6px; font-weight: 700; }
    textarea { min-height: 58px; border: 1px solid #cfd8df; border-radius: 6px; font: inherit; padding: 8px; }
    @media (max-width: 860px) { .media-grid, .meta, .scores { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>See It Harness ${escapeHtml(runId)}</h1>
    <p class="summary">Dataset ${escapeHtml(report.dataset)} · ${escapeHtml(report.passCount)}/${escapeHtml(report.total)} automated pass · gate ${escapeHtml(report.gate ? "pass" : "fail")}</p>
    ${report.results.map(resultCard).join("\n")}
  </main>
</body>
</html>`;
}

const report = runBenchmarkSuite();
const runId = "smoke-" + new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("out", { recursive: true });
mkdirSync("out/benchmarks/" + runId, { recursive: true });
const html = htmlReport(report, runId);
writeFileSync("out/harness-report.json", JSON.stringify({ runId, ...report }, null, 2));
writeFileSync("out/harness-report.html", html);
writeFileSync("out/benchmarks/" + runId + "/index.html", html);
if (!report.gate) {
  throw new Error("Harness gate failed");
}
console.log("harness smoke passed " + report.passCount + "/" + report.total + " " + runId);

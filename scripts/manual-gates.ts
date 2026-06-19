import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type ManualGateEvidence = {
  releaseCandidate?: {
    appUrl?: string;
    commit?: string;
    deploymentId?: string;
    checkedAt?: string;
    reviewer?: string;
  };
  shopify?: {
    devStoreDomain?: string;
    oauthInstallWorks?: boolean;
    themeExtensionDeployed?: boolean;
    themeEditorBlockVisible?: boolean;
  };
  merchant?: {
    oneProductEnabledWithoutSupport?: boolean;
    productUrl?: string;
    installToPdpMinutes?: number;
    firstRenderMinutes?: number;
  };
  shopper?: {
    mobileHappyPath?: boolean;
    desktopHappyPath?: boolean;
  };
  lighthouse?: {
    beforePerformance?: number;
    afterPerformance?: number;
    reportBeforePath?: string;
    reportAfterPath?: string;
  };
  billing?: {
    testModeWorks?: boolean;
    evidence?: string;
  };
  humanReview?: {
    contactSheetReviewed?: boolean;
    contactSheetPath?: string;
    noProductIdentityFailures?: boolean;
    reviewer?: string;
    notes?: string;
  };
};

type Gate = {
  id: string;
  requirement: string;
  pass: boolean;
  evidence: string;
};

const args = process.argv.slice(2);
const templateMode = args.includes("--template");
const evidencePath = valueAfter("--evidence") ?? "out/manual-gates-evidence.json";
const reportPath = valueAfter("--report") ?? "out/manual-gates-report.md";
const jsonReportPath = valueAfter("--json-report") ?? "out/manual-gates-report.json";

function valueAfter(flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function sampleEvidence(): ManualGateEvidence {
  return {
    releaseCandidate: {
      appUrl: "https://see-it-nine.vercel.app",
      commit: "",
      deploymentId: "",
      checkedAt: new Date().toISOString(),
      reviewer: ""
    },
    shopify: {
      devStoreDomain: "",
      oauthInstallWorks: false,
      themeExtensionDeployed: false,
      themeEditorBlockVisible: false
    },
    merchant: {
      oneProductEnabledWithoutSupport: false,
      productUrl: "",
      installToPdpMinutes: 0,
      firstRenderMinutes: 0
    },
    shopper: {
      mobileHappyPath: false,
      desktopHappyPath: false
    },
    lighthouse: {
      beforePerformance: 0,
      afterPerformance: 0,
      reportBeforePath: "",
      reportAfterPath: ""
    },
    billing: {
      testModeWorks: false,
      evidence: ""
    },
    humanReview: {
      contactSheetReviewed: false,
      contactSheetPath: "out/harness-report.html",
      noProductIdentityFailures: false,
      reviewer: "",
      notes: ""
    }
  };
}

function readEvidence(path: string) {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, "utf8")) as ManualGateEvidence;
}

function bool(value: unknown) {
  return value === true;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function pathOrUrlExists(value: unknown) {
  if (!nonEmpty(value)) {
    return false;
  }
  const text = String(value);
  return /^https?:\/\//.test(text) || existsSync(text);
}

function gate(id: string, requirement: string, pass: boolean, evidence: string): Gate {
  return { id, requirement, pass, evidence };
}

function buildGates(evidence: ManualGateEvidence): Gate[] {
  const lighthouseBefore = numberValue(evidence.lighthouse?.beforePerformance);
  const lighthouseAfter = numberValue(evidence.lighthouse?.afterPerformance);
  const lighthouseDegradation = lighthouseBefore !== undefined && lighthouseAfter !== undefined
    ? lighthouseBefore - lighthouseAfter
    : undefined;

  return [
    gate(
      "shopify_oauth_dev_store",
      "Shopify OAuth install works on dev store",
      bool(evidence.shopify?.oauthInstallWorks) && nonEmpty(evidence.shopify?.devStoreDomain),
      "Set shopify.oauthInstallWorks=true and shopify.devStoreDomain after installing on a dev store."
    ),
    gate(
      "theme_extension_deploy",
      "Theme app extension deploys successfully",
      bool(evidence.shopify?.themeExtensionDeployed),
      "Set shopify.themeExtensionDeployed=true after Shopify CLI deploy succeeds."
    ),
    gate(
      "theme_editor_block",
      "Theme editor shows the See it in your room block",
      bool(evidence.shopify?.themeEditorBlockVisible),
      "Set shopify.themeEditorBlockVisible=true after enabling/confirming the app block."
    ),
    gate(
      "merchant_enable_product",
      "Merchant can enable one product without support",
      bool(evidence.merchant?.oneProductEnabledWithoutSupport) && nonEmpty(evidence.merchant?.productUrl),
      "Set merchant.oneProductEnabledWithoutSupport=true and merchant.productUrl to the tested PDP."
    ),
    gate(
      "install_to_pdp_under_10m",
      "Install to working PDP button completes under 10 minutes",
      numberValue(evidence.merchant?.installToPdpMinutes) !== undefined && Number(evidence.merchant?.installToPdpMinutes) > 0 && Number(evidence.merchant?.installToPdpMinutes) <= 10,
      "Set merchant.installToPdpMinutes to the measured install-to-working-button time."
    ),
    gate(
      "first_render_under_5m",
      "First merchant render completes under 5 minutes",
      numberValue(evidence.merchant?.firstRenderMinutes) !== undefined && Number(evidence.merchant?.firstRenderMinutes) > 0 && Number(evidence.merchant?.firstRenderMinutes) <= 5,
      "Set merchant.firstRenderMinutes to the measured first-render time."
    ),
    gate(
      "shopper_mobile_happy_path",
      "Shopper room upload/tap/result path works on mobile",
      bool(evidence.shopper?.mobileHappyPath),
      "Set shopper.mobileHappyPath=true after testing a mobile viewport/device on the dev-store PDP."
    ),
    gate(
      "shopper_desktop_happy_path",
      "Shopper room upload/tap/result path works on desktop",
      bool(evidence.shopper?.desktopHappyPath),
      "Set shopper.desktopHappyPath=true after testing desktop on the dev-store PDP."
    ),
    gate(
      "pdp_lighthouse_delta",
      "PDP Lighthouse performance delta is <= 10 points",
      lighthouseDegradation !== undefined
        && lighthouseDegradation <= 10
        && pathOrUrlExists(evidence.lighthouse?.reportBeforePath)
        && pathOrUrlExists(evidence.lighthouse?.reportAfterPath),
      "Set lighthouse before/after scores plus report paths or URLs; before - after must be <= 10."
    ),
    gate(
      "billing_test_mode",
      "Billing test mode works before App Store submission",
      bool(evidence.billing?.testModeWorks) && nonEmpty(evidence.billing?.evidence),
      "Set billing.testModeWorks=true and billing.evidence to the test-mode charge/subscription proof."
    ),
    gate(
      "human_contact_sheet_review",
      "Human contact sheet review is complete",
      bool(evidence.humanReview?.contactSheetReviewed)
        && pathOrUrlExists(evidence.humanReview?.contactSheetPath)
        && nonEmpty(evidence.humanReview?.reviewer),
      "Set humanReview.contactSheetReviewed=true, reviewer, and a contactSheetPath/URL."
    ),
    gate(
      "no_product_identity_failures",
      "No product identity failures in approved cases",
      bool(evidence.humanReview?.noProductIdentityFailures),
      "Set humanReview.noProductIdentityFailures=true after reviewer approval."
    )
  ];
}

function markdownReport(evidence: ManualGateEvidence, gates: Gate[]) {
  const passed = gates.filter((item) => item.pass).length;
  const lines = [
    "# Manual Gate Report",
    "",
    "- App URL: " + (evidence.releaseCandidate?.appUrl ?? ""),
    "- Commit: " + (evidence.releaseCandidate?.commit ?? ""),
    "- Deployment: " + (evidence.releaseCandidate?.deploymentId ?? ""),
    "- Checked at: " + (evidence.releaseCandidate?.checkedAt ?? ""),
    "- Reviewer: " + (evidence.releaseCandidate?.reviewer ?? evidence.humanReview?.reviewer ?? ""),
    "- Result: " + passed + "/" + gates.length + " manual gates passed",
    "",
    "| Gate | Status | Evidence Needed |",
    "| --- | --- | --- |"
  ];
  for (const item of gates) {
    lines.push("| `" + item.id + "` | " + (item.pass ? "pass" : "missing") + " | " + item.evidence.replaceAll("|", "\\|") + " |");
  }
  return lines.join("\n") + "\n";
}

mkdirSync("out", { recursive: true });

if (templateMode) {
  const evidence = sampleEvidence();
  const gates = buildGates(evidence);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  writeFileSync(reportPath, markdownReport(evidence, gates));
  writeFileSync(jsonReportPath, JSON.stringify({ evidencePath, reportPath, gates }, null, 2));
  console.log("manual gate evidence template written to " + evidencePath);
  console.log("manual gate report template written to " + reportPath);
  process.exit(0);
}

if (!existsSync(evidencePath)) {
  writeFileSync(evidencePath, JSON.stringify(sampleEvidence(), null, 2));
  console.log("manual gate evidence template written to " + evidencePath);
  throw new Error("Manual gate evidence missing; fill " + evidencePath + " and rerun manual:gates");
}

const evidence = readEvidence(evidencePath) ?? sampleEvidence();
const gates = buildGates(evidence);
writeFileSync(reportPath, markdownReport(evidence, gates));
writeFileSync(jsonReportPath, JSON.stringify({ evidencePath, reportPath, gates }, null, 2));

const failures = gates.filter((item) => !item.pass);
if (failures.length > 0) {
  throw new Error("Manual gate verification failed: " + failures.map((item) => item.id).join(", "));
}

console.log("manual gates passed " + gates.length + "/" + gates.length + " report " + reportPath);

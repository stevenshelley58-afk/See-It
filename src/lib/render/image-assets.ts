import { sha256Text } from "@/lib/ai/prompt-hash";

export function renderAssetPath(renderRequestId: string, attemptNumber: number, role: "provider-output" | "intermediate" | "gate-input-product" | "gate-input-render" | "final", index = 0) {
  if (role === "final") {
    return "renders/" + renderRequestId + "/final.png";
  }
  if (role === "intermediate") {
    return "renders/" + renderRequestId + "/attempt-" + attemptNumber + "/intermediate-" + index + ".png";
  }
  return "renders/" + renderRequestId + "/attempt-" + attemptNumber + "/" + role + ".png";
}

export function assetHash(storageKey: string) {
  return sha256Text(storageKey);
}

export const STORAGE_BUCKETS = ["rooms", "products", "renders", "ai-debug", "evals", "demo-assets", "exports"];

export function roomOriginalPath(roomSessionId: string, ext = "jpg") {
  return "rooms/" + roomSessionId + "/original." + ext.replace(/^\./, "");
}

export function roomNormalizedPath(roomSessionId: string) {
  return "rooms/" + roomSessionId + "/normalized.jpg";
}

export function productCutoutPath(shopId: string, productSetupId: string) {
  return "products/" + shopId + "/" + productSetupId + "/cutout-primary.png";
}

export function aiDebugPath(aiInvocationId: string, kind: "request" | "response" | "normalized") {
  return "ai-debug/" + aiInvocationId + "/" + kind + ".json";
}

export function evalCasePath(dataset: string, caseSlug: string, asset: "product" | "cutout" | "room" | "mask") {
  const ext = asset === "room" ? "jpg" : "png";
  return "evals/" + dataset + "/" + caseSlug + "/" + asset + "." + ext;
}

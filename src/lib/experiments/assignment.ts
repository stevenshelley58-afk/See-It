import { createHash } from "node:crypto";

export function deterministicAssignment(key: string, arms: Array<{ id: string; trafficWeight: number }>) {
  const total = arms.reduce((sum, arm) => sum + arm.trafficWeight, 0);
  if (total <= 0) {
    throw new Error("Experiment has no traffic");
  }
  const hash = createHash("sha256").update(key).digest("hex");
  const bucket = parseInt(hash.slice(0, 8), 16) % total;
  let cursor = 0;
  for (const arm of arms) {
    cursor += arm.trafficWeight;
    if (bucket < cursor) {
      return arm.id;
    }
  }
  return arms[arms.length - 1].id;
}

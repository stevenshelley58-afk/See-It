import type { AiProviderAdapter } from "@/lib/ai/types";

export const reveAdapter: AiProviderAdapter = {
  providerKey: "reve",
  adapterVersion: "reve-planned-v0",
  supports() {
    return false;
  },
  async invoke() {
    return {
      ok: false,
      outputAssets: [],
      error: { code: "provider_disabled", message: "reve is planned but not enabled", retryable: false },
      latencyMs: 1
    };
  }
};

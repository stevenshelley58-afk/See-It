import type { AiProviderAdapter } from "@/lib/ai/types";

export const ideogramAdapter: AiProviderAdapter = {
  providerKey: "ideogram",
  adapterVersion: "ideogram-planned-v0",
  supports() {
    return false;
  },
  async invoke() {
    return {
      ok: false,
      outputAssets: [],
      error: { code: "provider_disabled", message: "ideogram is planned but not enabled", retryable: false },
      latencyMs: 1
    };
  }
};

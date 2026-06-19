import type { AiProviderAdapter } from "@/lib/ai/types";

export const fluxAdapter: AiProviderAdapter = {
  providerKey: "flux",
  adapterVersion: "flux-planned-v0",
  supports() {
    return false;
  },
  async invoke() {
    return {
      ok: false,
      outputAssets: [],
      error: { code: "provider_disabled", message: "flux is planned but not enabled", retryable: false },
      latencyMs: 1
    };
  }
};

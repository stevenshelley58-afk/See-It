export type GateResult = {
  pass: boolean;
  score: number;
  detail: {
    productIdentity: number;
    scalePlausibility: number;
    placementAccuracy: number;
    lightingMatch: number;
    perspectiveMatch: number;
    shadowContact: number;
    sceneIntegration: number;
    artifactAbsence: number;
    promptCompliance: number;
    commercialUsefulness: number;
    notes: string;
    issueTags: string[];
  };
};

export function parseGateResult(value: unknown): GateResult {
  const record = value as Partial<GateResult>;
  const detail = record.detail ?? {} as GateResult["detail"];
  const numeric = (input: unknown, fallback: number) => typeof input === "number" ? input : fallback;
  const parsed: GateResult = {
    pass: Boolean(record.pass),
    score: numeric(record.score, 0),
    detail: {
      productIdentity: numeric(detail.productIdentity, 0),
      scalePlausibility: numeric(detail.scalePlausibility, 0),
      placementAccuracy: numeric(detail.placementAccuracy, 0),
      lightingMatch: numeric(detail.lightingMatch, 0),
      perspectiveMatch: numeric(detail.perspectiveMatch, 0),
      shadowContact: numeric(detail.shadowContact, 0),
      sceneIntegration: numeric(detail.sceneIntegration, 0),
      artifactAbsence: numeric(detail.artifactAbsence, 0),
      promptCompliance: numeric(detail.promptCompliance, 0),
      commercialUsefulness: numeric(detail.commercialUsefulness, 0),
      notes: typeof detail.notes === "string" ? detail.notes : "",
      issueTags: Array.isArray(detail.issueTags) ? detail.issueTags.map(String) : []
    }
  };
  parsed.pass = shouldPassGate(parsed);
  return parsed;
}

export function shouldPassGate(result: GateResult) {
  const critical = [result.detail.productIdentity, result.detail.scalePlausibility, result.detail.placementAccuracy, result.detail.artifactAbsence];
  const values = [
    result.detail.productIdentity,
    result.detail.scalePlausibility,
    result.detail.placementAccuracy,
    result.detail.lightingMatch,
    result.detail.perspectiveMatch,
    result.detail.shadowContact,
    result.detail.sceneIntegration,
    result.detail.artifactAbsence,
    result.detail.promptCompliance,
    result.detail.commercialUsefulness
  ];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const catastrophic = result.detail.issueTags.some((tag) => ["wrong_product", "impossible_scale", "unsafe", "personal_data"].includes(tag));
  return Math.min(...critical) >= 6 && mean >= 7 && !catastrophic;
}

export function deterministicGate(score = 8.2): GateResult {
  return parseGateResult({
    pass: true,
    score,
    detail: {
      productIdentity: score,
      scalePlausibility: score,
      placementAccuracy: score,
      lightingMatch: score,
      perspectiveMatch: score,
      shadowContact: score,
      sceneIntegration: score,
      artifactAbsence: score,
      promptCompliance: score,
      commercialUsefulness: score,
      notes: "deterministic local gate",
      issueTags: []
    }
  });
}

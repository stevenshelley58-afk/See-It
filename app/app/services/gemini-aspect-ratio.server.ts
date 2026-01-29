export type GeminiAspectRatio = { label: string; value: number };

// Gemini-compatible aspect ratios (label values per Gemini docs)
export const GEMINI_SUPPORTED_RATIOS: GeminiAspectRatio[] = [
  { label: "1:1", value: 1.0 },
  { label: "4:5", value: 0.8 },
  { label: "5:4", value: 1.25 },
  { label: "3:4", value: 0.75 },
  { label: "4:3", value: 4 / 3 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 1.5 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
];

export function findClosestGeminiRatio(
  width: number,
  height: number
): GeminiAspectRatio | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const inputRatio = width / height;
  let closest = GEMINI_SUPPORTED_RATIOS[0];
  let minDiff = Math.abs(inputRatio - closest.value);

  for (const r of GEMINI_SUPPORTED_RATIOS) {
    const diff = Math.abs(inputRatio - r.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = r;
    }
  }

  return closest;
}

export function findClosestGeminiRatioLabel(width: number, height: number): string | null {
  return findClosestGeminiRatio(width, height)?.label ?? null;
}


/**
 * Direction confidence (B79) — frontend twin of stocvest/signals/direction_confidence.py.
 *
 * The backend emits `direction_confidence` ("High" | "Moderate" | "Low") on the composite body.
 * This module parses that value and provides a deterministic client-side fallback (mirroring the
 * backend gates) for the rare path where the field is absent (older payloads / derived insights).
 *
 * Presentation only — never alters score or verdict.
 */

export type DirectionConfidenceTier = "High" | "Moderate" | "Low";

// Mirror of the backend per-dimension bars. Keep in sync with direction_confidence.py.
const HIGH = { conviction: 0.35, agreement: 0.67, dataQuality: 0.6 } as const;
const MODERATE = { conviction: 0.2, agreement: 0.5, dataQuality: 0.4 } as const;

export function parseDirectionConfidence(raw: unknown): DirectionConfidenceTier | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "high") return "High";
  if (v === "moderate") return "Moderate";
  if (v === "low") return "Low";
  return null;
}

/**
 * Client fallback when the API omits `direction_confidence`. Inputs mirror the backend:
 *   conviction   = |score| on -1..1   (pass score, or signalScore0to100 which is converted)
 *   agreement    = alignment_ratio 0..1
 *   dataQuality  = confidence 0..1
 */
export function deriveDirectionConfidence(params: {
  score?: number | null;
  signalScore0to100?: number | null;
  alignmentRatio?: number | null;
  confidence?: number | null;
  isNeutral: boolean;
}): DirectionConfidenceTier {
  if (params.isNeutral) return "Low";

  let conviction = 0;
  if (typeof params.score === "number" && Number.isFinite(params.score)) {
    conviction = Math.abs(params.score);
  } else if (typeof params.signalScore0to100 === "number" && Number.isFinite(params.signalScore0to100)) {
    // 0..100 maps to a directional score via (s/100)*2 - 1; |..| is the conviction.
    conviction = Math.abs((params.signalScore0to100 / 100) * 2 - 1);
  }
  const agreement = clamp01(params.alignmentRatio);
  const dataQuality = clamp01(params.confidence);

  const dims = { conviction, agreement, dataQuality };
  if (clears(dims, HIGH)) return "High";
  if (clears(dims, MODERATE)) return "Moderate";
  return "Low";
}

function clears(
  dims: { conviction: number; agreement: number; dataQuality: number },
  bars: { conviction: number; agreement: number; dataQuality: number }
): boolean {
  return dims.conviction >= bars.conviction && dims.agreement >= bars.agreement && dims.dataQuality >= bars.dataQuality;
}

function clamp01(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Tone token for chip styling: green / amber / muted. */
export function directionConfidenceTone(tier: DirectionConfidenceTier): "strong" | "moderate" | "weak" {
  if (tier === "High") return "strong";
  if (tier === "Moderate") return "moderate";
  return "weak";
}

/** Plain-language one-liner for tooltips when the API reason is absent. */
export function directionConfidenceFallbackReason(tier: DirectionConfidenceTier, isNeutral: boolean): string {
  if (isNeutral) return "Composite is neutral — no directional edge to trust yet.";
  if (tier === "High") return "Strong, well-aligned read with sufficient data.";
  if (tier === "Moderate") return "A real directional read, but one dimension is soft.";
  return "Score is near neutral, layers disagree, or data is thin — treat as fragile.";
}

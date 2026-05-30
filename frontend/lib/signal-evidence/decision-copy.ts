/**
 * Plain-English decision / execution copy for Signals and Evidence.
 * Informational only — does not grant or withhold trade permission.
 */

export const PLAIN_DECISION_FRAMING = "worth considering" as const;

export function readinessRationaleText(): string {
  return "Not enough signals agree yet. We need more layers to align before this becomes a trade worth considering.";
}

export function dataInsufficientRationaleText(): string {
  return "We still need more data layers before we can judge this setup. Wait for coverage to fill in — not worth considering as a candidate yet.";
}

export function riskRewardRationaleText(rrStr: string): string {
  return `The reward doesn't justify the risk at ${rrStr}:1 (below our minimum). Not worth considering for scenario planning yet.`;
}

export function confirmationRationaleText(): string {
  return "The layers don't fully agree on direction yet. More need to line up before this becomes a trade worth considering.";
}

export function regimeRationaleText(): string {
  return "Broader market conditions conflict with this setup's direction — not worth considering while that tension remains.";
}

export function timeframeDivergenceReinforcement(mode: "swing" | "day"): string {
  return mode === "day"
    ? "Short-term and longer-term trends point different ways — that's a caution flag."
    : "The short-term and longer-term trend are pointing in different directions — that's a caution flag.";
}

export function mergeRiskRewardGateLine(rationaleText: string, deskThresholdLine: string): string {
  const deskPart = deskThresholdLine.match(/below .+?\(\d+(?:\.\d+)?:1\)\.?/i);
  const rrPrefix =
    rationaleText.match(/^The reward doesn't justify the risk at [^)]+/i)?.[0] ??
    rationaleText.match(/^Risk\/reward too low \([^)]+\)/i)?.[0];
  if (!rrPrefix || !deskPart) return rationaleText;
  return `${rrPrefix} — ${deskPart[0].replace(/\.$/, "")}. Not worth considering for scenario planning yet.`;
}

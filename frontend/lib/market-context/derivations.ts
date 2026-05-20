import type { EarningsEvent } from "@/lib/api/earnings";

/**
 * Volatility category from VIX session change % + last-trade level.
 *
 *   - VIX level ≥ 22 OR VIX % >= +5 → "Expanding"
 *   - VIX level <= 13 OR VIX % <= -5 → "Compressed"
 *   - otherwise                      → "Contained"
 *   - missing data                   → "Unknown"
 */
export type VolatilityCategory = "Contained" | "Expanding" | "Compressed" | "Unknown";

export function classifyVolatility(
  vixLevel: number | null | undefined,
  vixPct: number | null | undefined
): VolatilityCategory {
  const level = typeof vixLevel === "number" && Number.isFinite(vixLevel) ? vixLevel : null;
  const pct = typeof vixPct === "number" && Number.isFinite(vixPct) ? vixPct : null;
  if (level == null && pct == null) return "Unknown";
  if ((level != null && level >= 22) || (pct != null && pct >= 5)) return "Expanding";
  if ((level != null && level <= 13) || (pct != null && pct <= -5)) return "Compressed";
  return "Contained";
}

export function volatilityPlainLine(cat: VolatilityCategory): string {
  switch (cat) {
    case "Expanding":
      return "Daily ranges widening vs prior sessions";
    case "Compressed":
      return "Daily ranges compressing vs prior sessions";
    case "Contained":
      return "Daily ranges stable vs prior sessions";
    default:
      return "Volatility input pending";
  }
}

/** User-facing volatility band on dashboard pills (not raw VIX). */
export function volatilityPillLabel(cat: VolatilityCategory): string {
  switch (cat) {
    case "Expanding":
      return "High";
    case "Compressed":
    case "Contained":
      return "Low";
    default:
      return "Pending";
  }
}

export type ParticipationCategory = "Broad" | "Mixed" | "Narrow" | "Unknown";

export function classifyParticipation(
  sectorPct5d: Array<number | null>,
  indexPct5d: Array<number | null>
): ParticipationCategory {
  const sectorClean = sectorPct5d.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const indexClean = indexPct5d.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (sectorClean.length === 0 && indexClean.length === 0) return "Unknown";
  const sectorUp = sectorClean.filter((v) => v > 0).length;
  const indexUp = indexClean.filter((v) => v > 0).length;
  if (sectorClean.length >= 4 && sectorUp >= 4 && indexClean.length >= 2 && indexUp >= 2) return "Broad";
  if (sectorClean.length >= 4 && sectorUp <= 1 && indexClean.length >= 2 && indexUp <= 1) return "Narrow";
  return "Mixed";
}

export function participationPlainLine(cat: ParticipationCategory): string {
  switch (cat) {
    case "Broad":
      return "Large- and small-cap indices and most sectors participating";
    case "Narrow":
      return "Few sectors or indices participating — leadership thin";
    case "Mixed":
      return "Mixed participation across sectors and indices";
    default:
      return "Participation input pending";
  }
}

/** Dashboard breadth pill label (participation category → plain English). */
export function breadthPillLabel(cat: ParticipationCategory): string {
  switch (cat) {
    case "Broad":
      return "Strong";
    case "Narrow":
      return "Weak";
    case "Mixed":
      return "Mixed";
    default:
      return "Pending";
  }
}

export type RotationProfileCategory = "Concentrated" | "Rotational" | "Mixed" | "Unknown";

export function classifyRotationProfile(sectorPct5d: Array<number | null>): RotationProfileCategory {
  const clean = sectorPct5d.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (clean.length < 3) return "Unknown";
  const sorted = [...clean].sort((a, b) => b - a);
  const max = sorted[0]!;
  const min = sorted[sorted.length - 1]!;
  const spread = max - min;
  const positives = clean.filter((v) => v > 0.2).length;
  const negatives = clean.filter((v) => v < -0.2).length;
  if (spread >= 3 && positives >= 1 && positives <= 2) return "Concentrated";
  if (positives >= 2 && negatives >= 1 && spread >= 1.5) return "Rotational";
  return "Mixed";
}

export function rotationProfilePlainLine(cat: RotationProfileCategory): string {
  switch (cat) {
    case "Concentrated":
      return "Narrow leadership — a few sectors carrying the move; broad follow-through unlikely";
    case "Rotational":
      return "Capital rotating across sectors — no single sector controlling the move; expect inconsistent follow-through";
    case "Mixed":
      return "Mixed sector behavior — partial leadership, no dominant pattern";
    default:
      return "Sector activity pending";
  }
}

export type RiskHorizonCategory = "Elevated" | "Active" | "Quiet" | "Unknown";

export function classifyRiskHorizon(
  upcomingEarnings: EarningsEvent[],
  macroWarning: string | null | undefined
): RiskHorizonCategory {
  if (typeof macroWarning === "string" && macroWarning.trim().length > 0) return "Elevated";
  const count = upcomingEarnings.length;
  if (count >= 4) return "Active";
  if (count > 0) return "Quiet";
  return "Quiet";
}

export function riskHorizonPlainLine(
  cat: RiskHorizonCategory,
  upcomingCount: number,
  macroWarning: string | null | undefined,
  soonestSymbol?: string,
  soonestDateLabel?: string
): string {
  if (cat === "Elevated" && macroWarning) return macroWarning;
  if (cat === "Active") {
    return soonestSymbol && soonestDateLabel
      ? `${upcomingCount} tracked earnings this week · next: ${soonestSymbol} on ${soonestDateLabel}`
      : `${upcomingCount} tracked earnings this week`;
  }
  if (cat === "Quiet" && upcomingCount > 0) {
    return soonestSymbol && soonestDateLabel
      ? `${upcomingCount} tracked earnings · next: ${soonestSymbol} on ${soonestDateLabel}`
      : `${upcomingCount} tracked earnings this week`;
  }
  return "No tracked earnings or high-impact macro prints in the next 7 sessions";
}

export function buildEnvironmentSummary(
  weeklyAvgPct5d: number | null,
  volatility: VolatilityCategory,
  participation: ParticipationCategory,
  risk: RiskHorizonCategory
): string {
  let drift: string;
  if (weeklyAvgPct5d == null) drift = "Short-horizon price drift unknown";
  else if (weeklyAvgPct5d >= 0.6) drift = "Short-horizon price drift up";
  else if (weeklyAvgPct5d <= -0.6) drift = "Short-horizon price drift down";
  else drift = "Short-horizon price drift mixed";

  const volPhrase = volatility === "Unknown" ? "volatility pending" : `volatility ${volatility.toLowerCase()}`;
  const partPhrase =
    participation === "Unknown" ? "participation pending" : `participation ${participation.toLowerCase()}`;
  const riskPhrase =
    risk === "Elevated" ? "macro risk approaching" : risk === "Active" ? "earnings risk approaching" : "macro risk quiet";

  return `${drift}, ${volPhrase}, ${partPhrase}, ${riskPhrase}.`;
}

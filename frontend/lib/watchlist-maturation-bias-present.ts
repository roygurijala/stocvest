/**
 * Maturation bias — presentation only (backend `long` | `short` | `neutral` unchanged).
 *
 * High layer counts with `neutral` composite bias measure consistency, not a tradable direction.
 * UI copy and chrome must not read as "Strong setup" + green ready without long/short.
 */

import type { AlignmentDisplayTier } from "@/lib/alignment-display-tier";
import { ACTIONABLE_ALIGNED_MIN } from "@/lib/alignment-display-tier";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export type MaturationDirectionalBias = "long" | "short" | "neutral";

export function normalizeMaturationBias(
  bias: string | undefined | null
): MaturationDirectionalBias {
  const b = (bias ?? "").trim().toLowerCase();
  if (b === "long" || b === "bullish") return "long";
  if (b === "short" || b === "bearish") return "short";
  return "neutral";
}

export function maturationHasDirectionalBias(
  bias: string | undefined | null
): boolean {
  const n = normalizeMaturationBias(bias);
  return n === "long" || n === "short";
}

/** True only when maturation persisted composite bias as neutral (not missing/legacy rows). */
export function isExplicitNeutralMaturationBias(bias: string | undefined | null): boolean {
  return (bias ?? "").trim().toLowerCase() === "neutral";
}

/** High alignment band (5–6) but composite stored no directional edge. */
export function isBalancedHighAlignment(input: {
  row: WatchlistMaturationRow | undefined;
  alignmentTier: AlignmentDisplayTier;
  aligned: number;
  total?: number;
}): boolean {
  if (!isExplicitNeutralMaturationBias(input.row?.bias)) {
    return false;
  }
  const total = input.total ?? 6;
  if (input.alignmentTier === "actionable" || input.row?.progress_band === "actionable") {
    return true;
  }
  if (input.aligned >= ACTIONABLE_ALIGNED_MIN && input.aligned <= total) {
    return true;
  }
  return false;
}

/** Prefix for session/desk/hold sublines (radar + watchlist cards). */
export function watchlistSetupQualityPrefix(bias: string | undefined | null): "Strong setup" | "Balanced" {
  return isExplicitNeutralMaturationBias(bias) ? "Balanced" : "Strong setup";
}

/** Primary line when layers are full but bias is neutral — no implied trade. */
export const WATCHLIST_BALANCED_NO_EDGE_LINE = "Balanced — no directional edge";

/** Neutral alignment KPI / status — verdict only; n/6 stays in the engine. */
export const NEUTRAL_ALIGNMENT_HEADLINE = "Balanced";
export const NEUTRAL_ALIGNMENT_SUBLINE = "Layers balanced — no trade setup";

export function formatNeutralAlignmentUserLine(): string {
  return NEUTRAL_ALIGNMENT_HEADLINE;
}

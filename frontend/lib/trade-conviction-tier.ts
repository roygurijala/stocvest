/**
 * Display-only conviction tiers (A+ / B+ / Developing).
 *
 * System verdict (`actionable` / `monitor` / `blocked`) stays authoritative for
 * scenario building and validation. Tiers explain *quality band* without
 * replacing gates or default recommendations.
 */

import { ACTIONABLE_ALIGNED_MIN, LAYER_TOTAL_DEFAULT } from "@/lib/alignment-display-tier";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";

/** Swing ledger + A-tier gold standard (2:1). */
export const MIN_RR_VERDICT_SWING = 2.0;
/** Day ledger minimum (matches `MIN_RISK_REWARD_DAY` backend). */
export const MIN_RR_VERDICT_DAY = 1.3;
/** A+ label always requires this R:R regardless of desk. */
export const MIN_RR_A_TIER = 2.0;
/** B+ band floor. */
export const MIN_RR_B_TIER_FLOOR = 1.3;
export const B_TIER_ALIGNED_MIN = ACTIONABLE_ALIGNED_MIN;

export type TradeConvictionTier = "a_plus" | "b_plus" | "developing";

export type TradeConvictionTierResult = {
  tier: TradeConvictionTier;
  label: string;
  shortLabel: string;
  summaryLine: string;
  /** Shown for B+ only — not a default recommendation. */
  detailLine: string | null;
  /** How to unlock full Scenario Builder on reference levels. */
  scenarioBuilderNote: string | null;
  tone: "bullish" | "caution" | "muted";
  isDefaultRecommendation: boolean;
};

function scenarioBuilderNoteForMode(mode: "swing" | "day"): string {
  const deskMin = minRiskRewardForVerdict(mode);
  return `Full Scenario Builder sheet opens at ${deskMin.toFixed(1)} : 1 on reference levels for this desk (${MIN_RR_A_TIER.toFixed(1)} : 1 for A-tier / high conviction).`;
}

export type TradeConvictionInput = {
  mode: "swing" | "day";
  riskReward: number;
  layersAligned: number;
  layersTotal?: number;
  decisionState: TradeDecisionState;
  counterTrend?: boolean;
  regimeConflict?: boolean;
  hasInsufficient?: boolean;
};

export function minRiskRewardForVerdict(mode: "swing" | "day"): number {
  return mode === "day" ? MIN_RR_VERDICT_DAY : MIN_RR_VERDICT_SWING;
}

export function isRrBelowVerdictThreshold(riskReward: number, mode: "swing" | "day"): boolean {
  if (!Number.isFinite(riskReward)) return true;
  return riskReward < minRiskRewardForVerdict(mode);
}

/** Parse R:R from maturation readiness text when numeric field is absent. */
export function parseRiskRewardFromReadiness(readiness: string | null | undefined): number | null {
  const text = (readiness ?? "").trim();
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*:?\s*1\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasMajorRiskBlock(input: TradeConvictionInput): boolean {
  return input.counterTrend === true || input.regimeConflict === true;
}

export function resolveTradeConvictionTier(input: TradeConvictionInput): TradeConvictionTierResult {
  const total =
    typeof input.layersTotal === "number" && input.layersTotal > 0
      ? input.layersTotal
      : LAYER_TOTAL_DEFAULT;
  const aligned = Math.max(0, Math.min(total, Math.round(input.layersAligned)));
  const rr = Number.isFinite(input.riskReward) ? input.riskReward : 0;
  const blocked = input.decisionState === "blocked";
  const insufficient = input.hasInsufficient === true;
  const majorBlock = hasMajorRiskBlock(input);

  const developingBase: TradeConvictionTierResult = {
    tier: "developing",
    label: "Watchlist / Developing",
    shortLabel: "Developing",
    summaryLine: "Setup is still maturing — focus on why gates are not cleared yet.",
    detailLine: null,
    scenarioBuilderNote: scenarioBuilderNoteForMode(input.mode),
    tone: "muted",
    isDefaultRecommendation: false
  };

  if (blocked || insufficient || aligned < 2 || rr < MIN_RR_B_TIER_FLOOR) {
    return developingBase;
  }

  const aPlusEligible =
    input.decisionState === "actionable" &&
    rr >= MIN_RR_A_TIER &&
    aligned >= B_TIER_ALIGNED_MIN &&
    !majorBlock;

  if (aPlusEligible) {
    return {
      tier: "a_plus",
      label: "High conviction",
      shortLabel: "A+",
      summaryLine: "A-tier setup — R/R and alignment meet the gold-standard gate.",
      detailLine: null,
      scenarioBuilderNote: scenarioBuilderNoteForMode(input.mode),
      tone: "bullish",
      isDefaultRecommendation: true
    };
  }

  const bPlusEligible =
    !blocked &&
    !insufficient &&
    !majorBlock &&
    aligned >= B_TIER_ALIGNED_MIN &&
    rr >= MIN_RR_B_TIER_FLOOR &&
    rr < MIN_RR_A_TIER;

  if (bPlusEligible) {
    const deskNote =
      input.mode === "day" && rr >= MIN_RR_VERDICT_DAY && !isRrBelowVerdictThreshold(rr, input.mode)
        ? " Day desk R/R gate is cleared; A-tier still requires 2.0 : 1."
        : " Reaching 2.0 : 1 would move this to A-tier (high conviction).";
    return {
      tier: "b_plus",
      label: "Tradable with discretion",
      shortLabel: "B+",
      summaryLine: `Strong alignment (${aligned}/${total}) with R/R ${rr.toFixed(1)} : 1 — below the 2.0 : 1 A-tier bar.`,
      detailLine: `Discretionary context only — not STOCVEST's default recommendation.${deskNote}`,
      scenarioBuilderNote: scenarioBuilderNoteForMode(input.mode),
      tone: "caution",
      isDefaultRecommendation: false
    };
  }

  return developingBase;
}

export function convictionTierFromDecision(
  decision: { state: TradeDecisionState; conviction?: TradeConvictionTierResult | null },
  fallback: TradeConvictionInput
): TradeConvictionTierResult {
  return decision.conviction ?? resolveTradeConvictionTier(fallback);
}

/**
 * Authoritative Decision synthesis for STOCVEST signal evidence.
 *
 * This file is the single source of truth for the displayed "Decision:" line, its state
 * (actionable / monitor / blocked), and the one-sentence rationale shown when permission
 * is withheld. The Signal Evidence card renders these values; the Signals page reads the
 * same output to publish authoritative context to the STOCVEST Assistant chatbot.
 *
 * Do not duplicate this logic elsewhere — if a screen needs the Decision, import from here.
 */

import type { SignalEvidenceData, SignalEvidenceInsight } from "@/lib/signal-evidence";
import {
  confirmationRationaleText,
  dataInsufficientRationaleText,
  readinessRationaleText,
  regimeRationaleText,
  riskRewardRationaleText
} from "@/lib/signal-evidence/decision-copy";
import {
  isRrBelowVerdictThreshold,
  resolveTradeConvictionTier,
  type TradeConvictionTierResult
} from "@/lib/trade-conviction-tier";

export type TradeDecisionState = "actionable" | "monitor" | "blocked";

/**
 * Decision rationale — exactly one primary reason shown when STOCVEST withholds permission.
 * Drawn from a fixed small set so the page acts like a judge ("here is why"), not a tutor
 * ("here is everything we measured"). Categories, in priority order:
 *   data_insufficient  → can't evaluate the setup with conviction
 *   risk_reward        → entry asymmetry below required threshold
 *   confirmation       → mixed agreement across the six signal layers
 *   regime             → macro / regime context conflicts with direction
 *   readiness          → fallback for monitor states that don't trip a specific gate
 */
export type DecisionRationaleCategory =
  | "data_insufficient"
  | "risk_reward"
  | "confirmation"
  | "regime"
  | "readiness";

export interface DecisionRationale {
  category: DecisionRationaleCategory;
  /** Short label preceding the sentence — state-aware ("Why hold:" vs "Why blocked:"). */
  label: string;
  /** Single declarative sentence: situation + STOCVEST principle. No suggestion phrasing. */
  text: string;
}

export interface TradeDecision {
  state: TradeDecisionState;
  line: string;
  reinforcements: string[];
  rationale: DecisionRationale | null;
  /** Display-only quality band — does not override `state`. */
  conviction?: TradeConvictionTierResult;
}

export type { TradeConvictionTierResult };

/**
 * Build the single rationale line shown under the Decision when permission is withheld.
 * One reason, one sentence. We pick by priority so the rationale names the gate the user
 * can most directly understand: data → risk/reward → confirmation → regime → readiness.
 * Returns null for actionable states (the Decision line itself is sufficient there).
 */
export function deriveDecisionRationale(
  state: TradeDecisionState,
  ctx: {
    rr: number;
    rrFail: boolean;
    hasInsufficient: boolean;
    coverageThin: boolean;
    weakAgreement: boolean;
    counterTrend: boolean;
    regimeConflict: boolean;
  }
): DecisionRationale | null {
  if (state === "actionable") return null;
  const label = state === "blocked" ? "Why blocked:" : "Why hold:";

  if (ctx.hasInsufficient || ctx.coverageThin) {
    return {
      category: "data_insufficient",
      label,
      text: dataInsufficientRationaleText()
    };
  }
  if (ctx.rrFail) {
    const rrStr = Number.isFinite(ctx.rr) ? ctx.rr.toFixed(1) : "—";
    return {
      category: "risk_reward",
      label,
      text: riskRewardRationaleText(rrStr)
    };
  }
  if (ctx.weakAgreement) {
    return {
      category: "confirmation",
      label,
      text: confirmationRationaleText()
    };
  }
  if (ctx.counterTrend || ctx.regimeConflict) {
    return {
      category: "regime",
      label,
      text: regimeRationaleText()
    };
  }
  return {
    category: "readiness",
    label,
    text: readinessRationaleText()
  };
}

export function synthTradeDecision(
  evidence: SignalEvidenceData,
  insight: SignalEvidenceInsight,
  mode: "swing" | "day" = "swing"
): TradeDecision {
  const layers = evidence.layers ?? [];
  const totalLayers = Math.max(1, layers.length);
  const availableLayers = layers.filter((l) => l.status !== "Unavailable").length;
  const directionalLayers = layers.filter((l) => l.status === "Bullish" || l.status === "Bearish").length;
  const hasInsufficient = insight.is_complete === false;
  const rr = Number.isFinite(insight.risk_reward) ? insight.risk_reward : 0;
  const rrFail = insight.rr_warning === true || isRrBelowVerdictThreshold(rr, mode);
  const agreementPct =
    insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)
      ? Math.round(Math.max(0, Math.min(1, insight.alignment_ratio)) * 100)
      : null;
  const weakAgreement = agreementPct != null ? agreementPct < 52 : directionalLayers < 3;
  const layersAligned =
    insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)
      ? Math.round(Math.max(0, Math.min(1, insight.alignment_ratio)) * totalLayers)
      : directionalLayers;
  const lowReadiness = layersAligned < 3;
  const strongReadiness = layersAligned >= 5;
  const strongAgreement = agreementPct != null ? agreementPct >= 60 : directionalLayers >= 4;
  const goodCoverage = availableLayers >= 5;
  const counterTrend = evidence.alignment?.is_counter_trend === true;
  const regimeConflict = evidence.alignment?.macro_supports === false;

  const reinforcements: string[] = [];
  if (rrFail) {
    reinforcements.push(`Risk/reward is too low (${rr.toFixed(1)}:1) for this desk's minimum.`);
  }
  if (agreementPct != null && weakAgreement) {
    reinforcements.push(`Only ${agreementPct}% of layers agree on direction.`);
  }
  if (agreementPct == null && directionalLayers < 3) {
    reinforcements.push("Few layers are pointing clearly in one direction.");
  }
  if (availableLayers < 5) {
    reinforcements.push(`Limited layer coverage (${availableLayers}/${totalLayers} available).`);
  }
  if (counterTrend) reinforcements.push("Setup fights the broader market tone.");

  const rationaleCtx = {
    rr,
    rrFail,
    hasInsufficient,
    coverageThin: availableLayers < 4,
    weakAgreement,
    counterTrend,
    regimeConflict
  };

  const alignedForConviction = layersAligned;

  const convictionInput = {
    mode,
    riskReward: rr,
    layersAligned: alignedForConviction,
    layersTotal: totalLayers,
    decisionState: "monitor" as TradeDecisionState,
    counterTrend,
    regimeConflict,
    hasInsufficient
  };

  if (hasInsufficient || (rrFail && weakAgreement && lowReadiness) || availableLayers < 4) {
    return {
      state: "blocked",
      line: "Decision: Blocked — not enough data or key risk checks failed",
      reinforcements,
      rationale: deriveDecisionRationale("blocked", rationaleCtx),
      conviction: resolveTradeConvictionTier({ ...convictionInput, decisionState: "blocked" })
    };
  }
  if (strongReadiness && !rrFail && strongAgreement && goodCoverage && !counterTrend) {
    return {
      state: "actionable",
      line: "Decision: Actionable — layers and risk/reward checks passed",
      reinforcements: [],
      rationale: null,
      conviction: resolveTradeConvictionTier({ ...convictionInput, decisionState: "actionable" })
    };
  }
  return {
    state: "monitor",
    line: "Decision: Monitor — waiting on more confirmation or better risk/reward",
    reinforcements,
    rationale: deriveDecisionRationale("monitor", rationaleCtx),
    conviction: resolveTradeConvictionTier({ ...convictionInput, decisionState: "monitor" })
  };
}

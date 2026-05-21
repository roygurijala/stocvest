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

  // Copy invariants (BRK.B feedback, 2026-05-13):
  //
  // The previous wording threaded "STOCVEST … before granting trade
  // permission" through every rationale variant. Users read that phrase
  // as STOCVEST claiming gatekeeper authority over their trade
  // decisions — which is exactly the implication our legal posture is
  // built to avoid. STOCVEST does not grant or withhold trade
  // permission; we surface signal data and the user decides.
  //
  // Replacement framing throughout this function: describe the gate as
  // an *internal threshold for structured scenario building*. That is:
  // STOCVEST has internal numerical thresholds for when the reference
  // levels it carries form a coherent planning structure, and the
  // current setup hasn't cleared those thresholds. The user is free to
  // proceed however they wish on their own broker — STOCVEST is simply
  // declining to construct a Scenario Builder sheet against
  // structurally degenerate inputs.

  if (ctx.hasInsufficient || ctx.coverageThin) {
    return {
      category: "data_insufficient",
      label,
      text:
        "Layer coverage is too thin to evaluate this setup with conviction. The setup does not meet internal thresholds for structured scenario building until additional layers populate."
    };
  }
  if (ctx.rrFail) {
    const rrStr = Number.isFinite(ctx.rr) ? ctx.rr.toFixed(1) : "—";
    return {
      category: "risk_reward",
      label,
      text: `Risk/reward too low (${rrStr}:1) — below threshold; does not meet internal thresholds for structured scenario building.`
    };
  }
  if (ctx.weakAgreement) {
    return {
      category: "confirmation",
      label,
      text:
        "Layer agreement is mixed across the six signal layers. The setup does not meet internal thresholds for structured scenario building until directional confirmation strengthens."
    };
  }
  if (ctx.counterTrend || ctx.regimeConflict) {
    return {
      category: "regime",
      label,
      text:
        "Macro or regime context conflicts with this direction. The setup does not meet internal thresholds for structured scenario building while regime alignment is opposed."
    };
  }
  return {
    category: "readiness",
    label,
    text:
      "Signal readiness is not yet decisive across the six layers. The setup does not meet internal thresholds for structured scenario building."
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
  const lowReadiness = insight.signal_score < 58;
  const strongReadiness = insight.signal_score >= 68;
  const strongAgreement = agreementPct != null ? agreementPct >= 60 : directionalLayers >= 4;
  const goodCoverage = availableLayers >= 5;
  const counterTrend = evidence.alignment?.is_counter_trend === true;
  const regimeConflict = evidence.alignment?.macro_supports === false;

  const reinforcements: string[] = [];
  if (rrFail) reinforcements.push(`Risk/Reward below minimum threshold (${rr.toFixed(1)} : 1).`);
  if (agreementPct != null && weakAgreement) reinforcements.push(`Mixed layer alignment (${agreementPct}%).`);
  if (agreementPct == null && directionalLayers < 3) reinforcements.push("Limited directional confirmation across layers.");
  if (availableLayers < 5) reinforcements.push(`Limited layer coverage (${availableLayers}/${totalLayers} available).`);
  if (counterTrend) reinforcements.push("Counter-trend versus macro/sector context.");

  const rationaleCtx = {
    rr,
    rrFail,
    hasInsufficient,
    coverageThin: availableLayers < 4,
    weakAgreement,
    counterTrend,
    regimeConflict
  };

  const alignedForConviction =
    agreementPct != null
      ? Math.round(Math.max(0, Math.min(1, insight.alignment_ratio ?? 0)) * totalLayers)
      : directionalLayers;

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
      line: "Decision: 🚫 Blocked — fails minimum synthesis and risk gates",
      reinforcements,
      rationale: deriveDecisionRationale("blocked", rationaleCtx),
      conviction: resolveTradeConvictionTier({ ...convictionInput, decisionState: "blocked" })
    };
  }
  if (strongReadiness && !rrFail && strongAgreement && goodCoverage && !counterTrend) {
    return {
      state: "actionable",
      line: "Decision: ✅ Actionable — passes risk/reward and confirmation thresholds",
      reinforcements: [],
      rationale: null,
      conviction: resolveTradeConvictionTier({ ...convictionInput, decisionState: "actionable" })
    };
  }
  return {
    state: "monitor",
    line: "Decision: ⚠️ Monitor only — confirmation and/or risk gates are not fully cleared",
    reinforcements,
    rationale: deriveDecisionRationale("monitor", rationaleCtx),
    conviction: resolveTradeConvictionTier({ ...convictionInput, decisionState: "monitor" })
  };
}

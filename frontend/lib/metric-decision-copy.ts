/**
 * Plain-English copy for how displayed metrics feed STOCVEST decisions.
 * Keep formulas aligned with `frontend/lib/signal-evidence.ts` (deriveEvidenceInsightFallback, rr_warning at 2:1).
 * Optional future: swap strings for Claude-generated text using the same inputs (symbol, rr, layers).
 */

const RR_GATE = 2.0;

/** Entry risk/reward from reference stop vs first target (swing evidence card). */
export function riskRewardEntryDecisionTooltip(riskReward: number, opts?: { incomplete?: boolean }): string {
  const rr = Number(riskReward);
  if (!Number.isFinite(rr)) {
    return "Risk/reward could not be read from reference levels. Open a fresh composite when levels are complete.";
  }
  const rounded = Math.round(rr * 10) / 10;
  const base =
    `This ${rounded}:1 value compares how far price must move to the first reference target versus how much room there is to the reference stop, using the same geometry as the swing composite evidence. ` +
    `It is a structural quality check on the setup—not a guarantee of outcome. `;
  if (opts?.incomplete) {
    return base + "Levels were incomplete when this card was built; treat the number as provisional until the snapshot fills in.";
  }
  if (rr < RR_GATE) {
    return (
      base +
      `Scores below ${RR_GATE}:1 are flagged because the engine treats them as modest reward for the risk budget implied by those levels; the composite and scanner still weigh all six layers, but a low R/R raises caution in the narrative you see here.`
    );
  }
  return (
    base +
    `At or above ${RR_GATE}:1 the read is that reward reasonably compensates for the reference stop distance, which supports a more constructive interpretation when other layers agree.`
  );
}

export function trendStrengthDecisionTooltip(score: string): string {
  const s = String(score || "").trim();
  return (
    `Trend strength (“${s}”) summarizes how aligned daily-style structure is in the swing composite snapshot. ` +
    "It nudges the evidence narrative when price action is clean versus choppy; the headline composite still blends all six layers."
  );
}

export function marketRegimeDecisionTooltip(regime: string): string {
  const r = String(regime || "Neutral").trim();
  return (
    `Macro regime is shown as “${r}” from the macro layer in this composite. ` +
    "It shifts weighting in the composite engine (for example risk-on vs defensive tilt) and should be read together with sector and internals context, not as a trade trigger by itself."
  );
}

export function compositeSignalScoreTooltip(score: number): string {
  return (
    `Trade readiness at ${score}/100 maps the composite engine’s directional read to a 0–100 display on the card. ` +
    "It reflects alignment and intentional gates, not probability of outcome. " +
    "Use it alongside R/R, regime, and confluence rather than as a single go/no-go number."
  );
}

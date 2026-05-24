/**
 * Scenario Builder — eligibility helper.
 *
 * Pure function. No fetch, no React, no clock dependency except a
 * `now` argument that defaults to `new Date()` so tests can inject a
 * deterministic instant.
 *
 * The helper returns a closed-set list of `ScenarioIneligibilityReason`
 * values; the union is frozen in `types.ts` so the tooltip + tests stay
 * stable. We deliberately do NOT short-circuit on the first failure —
 * if the user has a stale signal AND no stop reference, they get to see
 * BOTH so they can fix either one.
 *
 * Gating philosophy (legally load-bearing):
 *
 *   - We gate on **structural completeness** only: presence of fields
 *     that a planning sheet mechanically needs.
 *   - We do NOT gate on conviction signals (confluence, accuracy, layer
 *     alignment, engine verdict, news sentiment, mode-fit) — gating on
 *     those would imply the button being enabled = "we recommend this
 *     trade." Eligibility is "you have enough data to plan," nothing
 *     more.
 *
 *   Risk/reward sits on the **structural** side of this line by design.
 *   It is pure entry/stop/target arithmetic on the reference levels the
 *   signal already carries — nothing about it depends on confluence
 *   scores, accuracy history, or engine verdicts. A scenario whose
 *   reference levels mechanically yield a 0.5:1 R-multiple does not
 *   form a coherent planning sheet (the user would be planning to lose
 *   more than they stand to gain), so we treat it as a structural
 *   completeness failure with the user-facing copy framed in
 *   internal-thresholds terms — never as "we do not recommend this
 *   trade." The threshold matches `minRiskRewardForVerdict(mode)` on the
 *   same payload so the Build Scenario button stays in lock-step with
 *   the Signals desk verdict (swing 2.0, day 1.3).
 *
 * Freshness windows by mode (these match the freshness windows the
 * signal engines themselves use to mark `signal_valid_until` /
 * `signal_expires`):
 *
 *   - Swing: 7 days from `generated_at`.
 *   - Day:   1 trading day from `generated_at` (rolling 18h since we
 *            don't have an authoritative session-close clock here).
 *
 * If the payload carries an explicit `expires_at` it overrides the
 * mode-derived window — that field is the signal engine's own
 * declaration of "after this, do not trade this."
 */

import {
  MIN_RR_A_TIER
} from "@/lib/trade-conviction-tier";
import {
  SCENARIO_INELIGIBILITY_REASONS,
  type EligibilityReport,
  type ScenarioIneligibilityReason,
  type ScenarioInput
} from "@/lib/scenario/types";

const SWING_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DAY_FRESHNESS_MS = 18 * 60 * 60 * 1000; //   18h rolling

function parseIso(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function hasReferencePrice(reference: ScenarioInput["reference"]): boolean {
  const candidates = [
    reference.entry_low,
    reference.entry_high,
    reference.current_price,
    reference.session_open,
    reference.prev_close
  ];
  return candidates.some((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
}

function hasExplicitStop(reference: ScenarioInput["reference"]): boolean {
  return typeof reference.stop === "number" && Number.isFinite(reference.stop) && reference.stop > 0;
}

function hasExplicitTarget(reference: ScenarioInput["reference"]): boolean {
  const targets = [reference.target_1, reference.target_2, reference.target_3];
  return targets.some((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
}

function hasRiskAnchor(input: ScenarioInput): boolean {
  // A "risk anchor" is anything that lets the modal *seed* a stop
  // suggestion the user can then override. We accept three sources, in
  // order of precision:
  //
  //   1. An explicit reference stop level (signal carried it).
  //   2. ATR (modal suggests entry ± 1.5×ATR).
  //   3. Reference price + known volatility regime (modal suggests a
  //      regime-default % stop: low 1%, normal 2%, elevated 3%, extreme
  //      4%) — least precise, but still mechanical.
  //
  // The user provides the final stop value themselves either way. The
  // gate is "can we scaffold a planning sheet," not "did the signal
  // pre-compute the perfect stop."
  const ref = input.reference;
  const stopValid = typeof ref.stop === "number" && Number.isFinite(ref.stop) && ref.stop > 0;
  if (stopValid) return true;
  const atrValid = typeof ref.atr === "number" && Number.isFinite(ref.atr) && ref.atr > 0;
  if (atrValid) return true;
  const hasPrice = hasReferencePrice(ref);
  const knownVol = input.volatility_regime !== "unknown";
  return hasPrice && knownVol;
}

function freshnessCheck(input: ScenarioInput, now: number): "fresh" | "stale" | "expired" {
  // Explicit expiry always wins — if the signal engine said "do not
  // trade after T," we honor that even if mode-window math disagrees.
  const expiresAt = parseIso(input.expires_at);
  if (expiresAt !== null) {
    return now < expiresAt ? "fresh" : "expired";
  }
  const generatedAt = parseIso(input.generated_at);
  if (generatedAt === null) {
    // No timestamp = we can't reason about freshness. Conservative
    // default: treat as stale rather than silently passing. The user
    // can re-pull the signal from the scanner to get a current row.
    return "stale";
  }
  const window = input.mode === "swing" ? SWING_FRESHNESS_MS : DAY_FRESHNESS_MS;
  return now - generatedAt <= window ? "fresh" : "stale";
}

/**
 * Compute the full eligibility report for a scenario.
 *
 * @param input - The candidate scenario payload.
 * @param now   - Optional clock override (epoch ms). Tests inject a
 *                deterministic value here so freshness assertions are
 *                stable.
 */
export function isEligibleForScenario(
  input: ScenarioInput,
  now: number = Date.now()
): EligibilityReport {
  const reasons: ScenarioIneligibilityReason[] = [];

  const symbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
  if (!symbol) reasons.push("no_symbol");

  if (input.direction == null) {
    reasons.push("no_direction");
  } else if (input.direction === "neutral") {
    // Distinct reason: a neutral signal is "no scenario to build," not
    // "missing data." The UI surfaces a softer copy line in that case.
    reasons.push("neutral_direction");
  } else if (input.direction !== "bullish" && input.direction !== "bearish") {
    reasons.push("no_direction");
  }

  if (!hasReferencePrice(input.reference)) reasons.push("no_reference_price");
  if (!hasExplicitStop(input.reference)) reasons.push("no_stop");
  if (!hasExplicitTarget(input.reference)) reasons.push("no_target");
  if (!hasRiskAnchor(input)) reasons.push("no_risk_anchor");

  if (input.volatility_regime === "unknown") {
    // Without a volatility regime we can't even suggest a sensible
    // position-size *bound* — and showing a totally-unconstrained
    // builder with no guardrails on planning size feels worse than
    // gating until the next snapshot lands.
    reasons.push("unknown_volatility");
  }

  const freshness = freshnessCheck(input, now);
  if (freshness === "expired") {
    reasons.push("signal_expired");
  } else if (freshness === "stale") {
    reasons.push("signal_stale");
  }

  // low_risk_reward is surfaced in the Scenario Builder verdict banner — users may
  // adjust entry to explore geometry even when reference R/R is below desk minimum.
  // gap_intel session limits are execution context (verdict banner / planning banner),
  // not structural completeness — stop + target still open the full sheet.

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Full planning sheet (R/R math) when reference stop + target + direction exist.
 * Does not require freshness, volatility, or desk R/R gates — those surface in the verdict banner.
 */
export function canOpenFullScenarioSheet(input: ScenarioInput): boolean {
  const symbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
  if (!symbol) return false;
  if (input.direction !== "bullish" && input.direction !== "bearish") return false;
  if (!hasReferencePrice(input.reference)) return false;
  if (!hasExplicitStop(input.reference)) return false;
  if (!hasExplicitTarget(input.reference)) return false;
  return true;
}

/**
 * Stable human-readable label for a failure reason. Used by the
 * tooltip rendered when the button is disabled.
 *
 * Copy is deliberately specific ("missing X") and deliberately avoids
 * any softening word like "still" / "pending" / "almost there" — those
 * imply the system is going to validate the trade once the gap is
 * filled, which is the exact implication we're trying to prevent.
 */
export function scenarioIneligibilityLabel(reason: ScenarioIneligibilityReason): string {
  switch (reason) {
    case "no_symbol":
      return "Symbol is missing.";
    case "no_direction":
      return "Directional bias is missing.";
    case "neutral_direction":
      return "Signal is neutral — there is no directional scenario to plan.";
    case "no_reference_price":
      return "No reference price exists (entry zone, snapshot, or session anchor).";
    case "no_stop":
      return "Reference stop level is missing — scenario planning needs a stop from the signal.";
    case "no_target":
      return "Reference target level is missing — scenario planning needs at least one target from the signal.";
    case "no_risk_anchor":
      return "No way to express risk numerically — stop or ATR is required.";
    case "unknown_volatility":
      return "Volatility regime is unknown — refresh the signal data and try again.";
    case "signal_stale":
      return "Signal is outside the freshness window for its mode.";
    case "signal_expired":
      return "Signal carries an explicit expiry that has already passed.";
    case "low_risk_reward":
      return `Risk/reward does not meet internal thresholds for structured scenario building (desk minimum applies; A-tier is ${MIN_RR_A_TIER.toFixed(1)} : 1).`;
    case "gap_intel_blocked":
      return "Scenario drafting is not structurally available for this market phase or data state (Gap Intelligence).";
    default: {
      // Exhaustiveness check — any future reason that doesn't have a
      // copy line trips this branch at compile time.
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * Pre-formatted tooltip body when the button is disabled. Concatenates
 * every failure reason in stable order. Kept as a one-shot helper so
 * the button component stays render-only.
 */
export function buildIneligibilityTooltip(report: EligibilityReport): string {
  if (report.eligible) return "Ready to build scenario.";
  const ordered = SCENARIO_INELIGIBILITY_REASONS.filter((r) => report.reasons.includes(r));
  return ordered.map(scenarioIneligibilityLabel).join(" ");
}

/**
 * Scenario Builder — type surface.
 *
 * Backbone for the "Build scenario" flow. The Scenario Builder is a
 * **planning** tool: it lets a user reason about position-sizing,
 * risk, and R-multiples against the *reference data* a signal carries,
 * but it deliberately does NOT submit anything to a broker, does NOT
 * stage a draft order, and does NOT imply that any particular trade is
 * recommended or approved.
 *
 * The legal posture this surface adopts:
 *
 *   - "Eligible" means **structurally complete** — every mechanical input
 *     a planning sheet needs (symbol, direction, a reference price, a way
 *     to express risk, a volatility regime, and a fresh signal) is
 *     present.
 *   - "Eligible" does NOT mean the trade is a good idea, validated,
 *     approved, qualified, or recommended. The eligibility check
 *     deliberately ignores every quality/conviction signal we compute
 *     (confluence, accuracy, layer alignment, engine verdict, news
 *     sentiment, mode-fit) — gating on those would cross into implicit
 *     recommendation.
 *   - The terminal actions in the modal are "Copy scenario" / "Save
 *     locally" / "Reset" — there is no "Submit," no broker-bound action,
 *     and no STOCVEST-side persistence of trade intent.
 *
 * Every type in this file is a wire-shape: it MUST stay structural and
 * MUST NOT carry any field that names a quality verdict (e.g. no
 * `is_approved`, no `is_high_quality`, no `recommended_size`).
 */

/**
 * Trading direction the scenario is being built for.
 *
 * `"neutral"` is **not** in the union — a neutral-direction signal has
 * no scenario to build (you can't reason about R-multiples without a
 * directional thesis), so the eligibility helper rejects it with a
 * specific reason rather than letting the modal open in a half-state.
 */
export type ScenarioDirection = "bullish" | "bearish";

/**
 * Trading mode label — purely informational on the scenario sheet so
 * the user remembers whether they were planning against the swing or
 * day engine when they exported the scenario.
 */
export type ScenarioMode = "swing" | "day";

/**
 * Reference levels the signal carried into the scenario. Each field is
 * optional because different signal surfaces (gap intelligence, intraday
 * setup, swing composite, signal validation row) populate different
 * subsets. The eligibility helper only requires **one** of
 * `entry_low` / `entry_high` / `current_price` / `session_open` /
 * `prev_close` to be present — anything more is bonus precision.
 */
export interface ReferenceLevels {
  entry_low?: number | null;
  entry_high?: number | null;
  /** Reference stop level if the signal carries one (e.g. ATR-derived). */
  stop?: number | null;
  /** First target level. */
  target_1?: number | null;
  /** Second target level if present. */
  target_2?: number | null;
  /** Optional third target. */
  target_3?: number | null;
  /** Snapshot price at the time the signal was generated. */
  current_price?: number | null;
  /** Today's session open (intraday context). */
  session_open?: number | null;
  /** Previous session's close. */
  prev_close?: number | null;
  /** ATR if the signal payload computed one — used to suggest stop sizing. */
  atr?: number | null;
}

/**
 * Volatility-regime hint. Matches the closed-set vocabulary used by
 * the assistant prompt and the dashboard pulse so eligibility, copy,
 * and downstream UI stay in lockstep.
 *
 * `"unknown"` is a legitimate value — emitted when the snapshot
 * couldn't be parsed. Eligibility treats it as a fail reason rather
 * than silently passing.
 */
export type VolatilityRegime = "low" | "normal" | "elevated" | "extreme" | "unknown";

/**
 * Whole-payload input to the eligibility check + scenario builder.
 *
 * The shape is intentionally generous so every call site (gap card,
 * setup row, evidence modal, signal-validation row, dashboard signal)
 * can build one without round-tripping through the backend.
 */
export interface ScenarioInput {
  symbol: string;
  direction: ScenarioDirection | "neutral" | null | undefined;
  mode: ScenarioMode;
  /** When the underlying signal was generated (ISO). Drives freshness. */
  generated_at?: string | null;
  /**
   * Explicit hard expiry on the signal (ISO). Day signals carry this as
   * `signal_valid_until`; swing signals carry it as `signal_expires`.
   * If both `generated_at` and `expires_at` are present, `expires_at`
   * wins for the freshness gate.
   */
  expires_at?: string | null;
  reference: ReferenceLevels;
  volatility_regime: VolatilityRegime;
  /**
   * Free-form display tags surfaced to the user inside the modal's
   * Reference block so they remember why this row was actionable in
   * planning terms (e.g. "Gap +3.2%", "ORB break", "Earnings reaction").
   * These are display-only — they do NOT influence eligibility.
   */
  tags?: string[];
}

/**
 * Closed-set list of every reason eligibility can fail.
 *
 * The frozen vocabulary keeps the UI's "what's missing" tooltip stable
 * across deploys and gives tests a fingerprint to assert on (vs free
 * text that drifts over time).
 */
export const SCENARIO_INELIGIBILITY_REASONS = [
  "no_symbol",
  "no_direction",
  "neutral_direction",
  "no_reference_price",
  "no_risk_anchor",
  "unknown_volatility",
  "signal_stale",
  "signal_expired"
] as const;

export type ScenarioIneligibilityReason = (typeof SCENARIO_INELIGIBILITY_REASONS)[number];

/**
 * Result of {@link isEligibleForScenario}. `eligible` and `reasons` are
 * mutually consistent: if `eligible === true`, `reasons` is empty.
 *
 * Returning the **full** failure set (not just the first one) keeps the
 * tooltip honest — if both freshness AND risk-anchor are missing, the
 * user sees both, not just the first one the function happened to check.
 */
export interface EligibilityReport {
  eligible: boolean;
  reasons: readonly ScenarioIneligibilityReason[];
}

/**
 * User-provided values inside the scenario builder modal. Every field
 * is editable — none of them have a "recommended" value from STOCVEST.
 * Pre-fill defaults are derived mechanically from `ReferenceLevels`
 * (e.g. mid of entry zone) and are clearly labeled as "Reference" so
 * the user can see they're starting points, not endorsements.
 */
export interface ScenarioUserInputs {
  /** Final entry price the user is planning around. */
  entry: number;
  /** Final stop price. */
  stop: number;
  /** Final target price the user is planning for the R-multiple. */
  target: number;
  /** Shares (positive integer) — primary sizing field. */
  shares: number;
  /** Optional account-size context for "% of portfolio at risk." */
  account_size?: number | null;
  /**
   * Order-type label the user is mentally planning ("market" / "limit"
   * / "stop"). Purely educational — NEVER sent anywhere.
   */
  order_type_label?: "market" | "limit" | "stop";
}

/**
 * Output of {@link computeScenarioResult}. Every field is mechanically
 * derived from `ScenarioUserInputs` + direction; no field carries a
 * verdict.
 */
export interface ScenarioComputedResult {
  /** |entry - stop|. */
  risk_per_share: number;
  /** shares * risk_per_share. */
  total_risk_dollars: number;
  /** Distance to target / distance to stop. NaN if stop == entry. */
  r_multiple_to_target: number;
  /** shares * entry. */
  cost_basis_dollars: number;
  /**
   * If `account_size` is provided and positive, the total $ at risk as a
   * percentage of the account. `null` when account size is missing or
   * non-positive — the modal renders a friendly "—" in that case.
   */
  risk_pct_of_account: number | null;
}

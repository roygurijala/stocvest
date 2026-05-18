/**
 * Scenario Builder — pure compute helpers.
 *
 * Every function is deterministic. Inputs are the user's typed values
 * from the modal; outputs are the cells in the "Computed" block.
 *
 * Mathematical conventions:
 *
 *   - Risk-per-share = `|entry - stop|`. Sign-agnostic — works for both
 *     long (entry > stop) and short (entry < stop) scenarios. The
 *     direction field on the scenario is purely an annotation; the math
 *     never assumes long.
 *   - R-multiple to target = `|target - entry| / |entry - stop|`. NaN
 *     when stop == entry (zero-risk edge case — caller renders "—").
 *   - All money values are in $ — there's no currency conversion in
 *     scope. If we ever ship multi-currency scenarios the modal should
 *     surface the symbol's quote currency explicitly.
 *
 * What's deliberately NOT computed here:
 *
 *   - "Optimal" size — no Kelly fraction, no fixed-fractional sizing
 *     suggestion, no "we recommend X shares." The user is responsible
 *     for sizing; we only show the consequences of their choice.
 *   - Probability of success — we have historical accuracy on
 *     `/dashboard/setup-outcomes`, but using it to qualify a
 *     scenario's R-expectancy crosses into implicit prediction.
 */

import type { ScenarioComputedResult, ScenarioUserInputs } from "@/lib/scenario/types";

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Compute the full Computed block for a scenario.
 *
 * Caller is responsible for sanitizing user input upstream (the modal
 * uses `<input type="number">` with `min="0"` and explicit coerce-to-
 * Number on change), but this helper is **defensive** in case the
 * input slips through with NaN/Infinity/zero: every output that can't
 * be honestly computed returns NaN, and the caller renders "—" for
 * any NaN cell.
 */
export function computeScenarioResult(inputs: ScenarioUserInputs): ScenarioComputedResult {
  const entry = inputs.entry;
  const stop = inputs.stop;
  const target = inputs.target;
  const shares = inputs.shares;

  const risk_per_share =
    Number.isFinite(entry) && Number.isFinite(stop) ? Math.abs(entry - stop) : Number.NaN;

  const total_risk_dollars =
    Number.isFinite(risk_per_share) && isFinitePositive(shares)
      ? risk_per_share * shares
      : Number.NaN;

  // R-multiple: target distance / stop distance. Zero stop distance =
  // undefined R (you cannot have an R-multiple on a zero-risk trade).
  const r_multiple_to_target =
    Number.isFinite(entry) &&
    Number.isFinite(target) &&
    Number.isFinite(risk_per_share) &&
    risk_per_share > 0
      ? Math.abs(target - entry) / risk_per_share
      : Number.NaN;

  const cost_basis_dollars =
    Number.isFinite(entry) && isFinitePositive(shares) ? entry * shares : Number.NaN;

  const acct = inputs.account_size;
  const risk_pct_of_account =
    isFinitePositive(acct) && Number.isFinite(total_risk_dollars)
      ? (total_risk_dollars / acct) * 100
      : null;

  return {
    risk_per_share,
    total_risk_dollars,
    r_multiple_to_target,
    cost_basis_dollars,
    risk_pct_of_account
  };
}

/**
 * Format a number as USD ($1,234.56). Returns "—" for non-finite
 * inputs so cells never render "NaN" or "Infinity" to the user.
 */
export function formatScenarioDollars(value: number, opts: { fractionDigits?: number } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const digits = opts.fractionDigits ?? 2;
  const fixed = value.toFixed(digits);
  // Manual thousands grouping so we don't pull in `Intl.NumberFormat`
  // for a single call site (and to keep snapshot-style tests stable
  // regardless of the test runner's locale).
  const [intPart, fracPart] = fixed.split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const abs = sign ? intPart.slice(1) : intPart;
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${grouped}${fracPart ? "." + fracPart : ""}`;
}

/**
 * Format an R-multiple as "2.50R" / "—" for the Computed block.
 */
export function formatRMultiple(r: number): string {
  if (!Number.isFinite(r)) return "—";
  return `${r.toFixed(2)}R`;
}

/**
 * Format a percentage as "1.23%" / "—" for the risk-of-account row.
 */
export function formatScenarioPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(2)}%`;
}

/**
 * Build a plaintext, copy-friendly summary of the scenario. Used by
 * the modal's "Copy scenario" terminal action — the user pastes this
 * directly into their broker's order ticket (or a journal app) and
 * fills in execution details there. Crucially, this is the only
 * "output" from STOCVEST's side of the planning surface.
 *
 * Deliberately structured as plaintext with explicit "Reference" /
 * "Planning inputs" / "Computed" sections so when the user later
 * re-reads the paste, they can see at a glance which fields they
 * authored and which were derived.
 */
export function formatScenarioForClipboard(
  symbol: string,
  direction: "bullish" | "bearish",
  mode: "swing" | "day",
  inputs: ScenarioUserInputs,
  result: ScenarioComputedResult
): string {
  const lines: string[] = [];
  lines.push(`STOCVEST scenario — ${symbol.toUpperCase()} (${direction}, ${mode})`);
  lines.push("");
  lines.push("Planning inputs:");
  lines.push(`  Entry:  ${formatScenarioDollars(inputs.entry, { fractionDigits: 4 })}`);
  lines.push(`  Stop:   ${formatScenarioDollars(inputs.stop, { fractionDigits: 4 })}`);
  lines.push(`  Target: ${formatScenarioDollars(inputs.target, { fractionDigits: 4 })}`);
  lines.push(`  Shares: ${Number.isFinite(inputs.shares) ? inputs.shares : "—"}`);
  if (inputs.order_type_label) {
    lines.push(`  Order type (educational): ${inputs.order_type_label}`);
  }
  lines.push("");
  lines.push("Computed:");
  lines.push(`  Risk per share: ${formatScenarioDollars(result.risk_per_share, { fractionDigits: 4 })}`);
  lines.push(`  Total $ at risk: ${formatScenarioDollars(result.total_risk_dollars)}`);
  lines.push(`  R-multiple to target: ${formatRMultiple(result.r_multiple_to_target)}`);
  lines.push(`  Cost basis: ${formatScenarioDollars(result.cost_basis_dollars)}`);
  if (inputs.account_size != null && Number.isFinite(inputs.account_size)) {
    lines.push(`  Risk as % of account: ${formatScenarioPercent(result.risk_pct_of_account)}`);
  }
  lines.push("");
  lines.push("This is a planning scenario only. Reference levels are derived from signal data");
  lines.push("and are not entry, stop, or exit endorsements. STOCVEST does not submit, queue,");
  lines.push("or persist this scenario to any broker.");
  return lines.join("\n");
}

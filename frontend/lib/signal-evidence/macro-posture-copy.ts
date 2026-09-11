import type { EvidenceLayer } from "@/lib/signal-evidence";

/**
 * P1-MACRO (safe display slice) — informational pre-event posture copy.
 *
 * Produces a short, NON-DIRECTIONAL heads-up when a high-impact macro event
 * (FOMC / CPI / NFP / PCE / GDP, etc.) is near. It is a volatility/expectation
 * note only — it never asserts a direction and never changes any score. Returns
 * null when there is no relevant near-term event.
 */

// Horizon: from just-released (small negative buffer) out to ~8 days ahead.
const MIN_HOURS = -1;
const MAX_HOURS = 24 * 8;

const MAJOR_EVENT_KEYWORDS = [
  "fomc",
  "federal reserve",
  "powell",
  "rate decision",
  "interest rate",
  "cpi",
  "consumer price",
  "inflation",
  "pce",
  "nfp",
  "nonfarm",
  "non-farm",
  "payroll",
  "jobs report",
  "unemployment",
  "gdp"
];

function isMajorEvent(name: string): boolean {
  const n = name.toLowerCase();
  return MAJOR_EVENT_KEYWORDS.some((k) => n.includes(k));
}

function whenPhrase(hoursUntil: number): string {
  if (hoursUntil < 1) return "imminent";
  if (hoursUntil < 24) return `in ~${Math.round(hoursUntil)}h`;
  return `in ~${Math.round(hoursUntil / 24)}d`;
}

/**
 * Returns a one-line, non-directional posture note for the macro layer, or null.
 * Prefers the nearest MAJOR event; falls back to the nearest event only when macro
 * risk is elevated/critical (so a generic near-term event still warns during risk-on windows).
 */
export function macroPreEventPosture(layer: EvidenceLayer): string | null {
  if (layer.key !== "macro") return null;

  const events = (layer.upcoming_events ?? [])
    .filter((e) => typeof e.hours_until === "number" && e.hours_until >= MIN_HOURS && e.hours_until <= MAX_HOURS)
    .filter((e) => typeof e.name === "string" && e.name.trim().length > 0)
    .slice()
    .sort((a, b) => a.hours_until - b.hours_until);

  if (events.length === 0) return null;

  const riskElevated = layer.macro_risk_level === "elevated" || layer.macro_risk_level === "critical";
  const chosen = events.find((e) => isMajorEvent(e.name)) ?? (riskElevated ? events[0] : null);
  if (!chosen) return null;

  const when = whenPhrase(chosen.hours_until);
  return `${chosen.name.trim()} ${when} — expect wider ranges and gap risk around the print. Volatility heads-up, not a directional call.`;
}

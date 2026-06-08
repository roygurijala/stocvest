/**
 * Plain-English "why this regime?" copy for the Trading Room market pulse.
 *
 * The headline regime comes from the backend macro engine (`market_regime` /
 * weighted macro score), which can diverge from green/red index chips when VIX
 * or event risk dominates.
 */

import { regimeLabelIsDirectional } from "@/lib/market-context/regime";

export type RegimeWhyInput = {
  regimeLabel: string;
  marketRegime?: string | null;
  macroScore?: number | null;
  spyPct?: number | null;
  qqqPct?: number | null;
  vixLevel?: number | null;
  vixPct?: number | null;
};

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function marketRegimePhrase(marketRegime: string | null | undefined): string | null {
  const r = (marketRegime ?? "").trim().toLowerCase();
  if (r === "risk_off") return "risk-off";
  if (r === "avoid") return "high-volatility avoid";
  if (r === "risk_on") return "risk-on";
  if (r === "neutral") return "neutral";
  return null;
}

/** Index tape leans opposite the directional regime headline. */
export function tapeDisagreesWithRegime(
  regimeLabel: string,
  spyPct: number | null | undefined,
  qqqPct: number | null | undefined
): boolean {
  const label = regimeLabel.trim().toLowerCase();
  const spy = typeof spyPct === "number" && Number.isFinite(spyPct) ? spyPct : null;
  const qqq = typeof qqqPct === "number" && Number.isFinite(qqqPct) ? qqqPct : null;
  if (spy == null && qqq == null) return false;

  if (label.includes("bear")) {
    const spyUp = spy != null && spy > 0.05;
    const qqqUp = qqq != null && qqq > 0.05;
    if (spyUp && qqqUp) return true;
    if (spyUp && qqq == null) return true;
    if (qqqUp && spy == null) return true;
    return false;
  }
  if (label.includes("bull")) {
    if (spy != null && spy < -0.2) return true;
    if (qqq != null && qqq < -0.25) return true;
  }
  return false;
}

function vixDriverLine(vixLevel: number | null, vixPct: number | null): string | null {
  if (vixLevel == null) return null;
  const levelStr = vixLevel.toFixed(1);
  if (vixPct != null && Number.isFinite(vixPct) && Math.abs(vixPct) >= 5) {
    return `VIX ${levelStr} (${fmtPct(vixPct)} session)`;
  }
  if (vixLevel >= 20) return `VIX ${levelStr} (elevated)`;
  return null;
}

function indexDriverLine(spyPct: number | null, qqqPct: number | null): string | null {
  const parts: string[] = [];
  if (spyPct != null) parts.push(`SPY ${fmtPct(spyPct)}`);
  if (qqqPct != null) parts.push(`QQQ ${fmtPct(qqqPct)}`);
  return parts.length ? parts.join(", ") : null;
}

/** One-line explainer under the regime headline (null when not useful). */
export function buildRegimeWhyLine(input: RegimeWhyInput): string | null {
  if (!regimeLabelIsDirectional(input.regimeLabel)) return null;

  const label = input.regimeLabel.trim().toLowerCase();
  const spy = typeof input.spyPct === "number" && Number.isFinite(input.spyPct) ? input.spyPct : null;
  const qqq = typeof input.qqqPct === "number" && Number.isFinite(input.qqqPct) ? input.qqqPct : null;
  const vixLevel = typeof input.vixLevel === "number" && Number.isFinite(input.vixLevel) ? input.vixLevel : null;
  const vixPct = typeof input.vixPct === "number" && Number.isFinite(input.vixPct) ? input.vixPct : null;
  const macroScore =
    typeof input.macroScore === "number" && Number.isFinite(input.macroScore) ? input.macroScore : null;
  const regimePhrase = marketRegimePhrase(input.marketRegime);
  const disagree = tapeDisagreesWithRegime(input.regimeLabel, spy, qqq);
  const vixLine = vixDriverLine(vixLevel, vixPct);
  const indexLine = indexDriverLine(spy, qqq);

  if (label.includes("bear")) {
    if (disagree && vixLine && indexLine) {
      return `Risk-off macro read — ${vixLine} outweighs modest index gains (${indexLine}). Tape shows price; regime reflects weighted risk posture.`;
    }
    if (macroScore != null && regimePhrase) {
      const scoreBit = `Macro score ${macroScore}/100 (${regimePhrase})`;
      if (vixLine) return `${scoreBit} — ${vixLine} keeps caution elevated.`;
      return `${scoreBit} — index momentum and event risk did not clear risk-on.`;
    }
    if (vixLine) return `Risk-off read — ${vixLine} and macro inputs outweigh index tape.`;
    return "Risk-off macro read — weighted VIX, momentum, and calendar risk; not the same as a down-day label.";
  }

  if (label.includes("bull")) {
    if (disagree) {
      return "Risk-on macro read while index tape is soft — macro score cleared the risk-on band despite weaker session prints.";
    }
    if (macroScore != null && indexLine) {
      return `Risk-on macro score ${macroScore}/100 with supportive tape (${indexLine}).`;
    }
    return "Risk-on macro read — index momentum and vol backdrop cleared the risk-on band.";
  }

  return null;
}

/** Longer tooltip on the regime badge (Trading Room uses the macro engine). */
export function buildRegimeWhyTooltip(input: RegimeWhyInput): string {
  const line = buildRegimeWhyLine(input);
  const base =
    "Regime on this dashboard comes from the backend macro engine (SPY/QQQ momentum, VIX level and trend, and calendar risk)—not from a single index chip. Bearish means risk-off or high-volatility avoid, not necessarily a red tape day. Bullish means risk-on. Index chips beside this card show current tape; the regime word summarizes weighted posture for desk gating.";
  if (line) return `${base} ${line}`;
  return base;
}

export function regimeWhyEmphasize(input: RegimeWhyInput): boolean {
  return tapeDisagreesWithRegime(input.regimeLabel, input.spyPct, input.qqqPct);
}

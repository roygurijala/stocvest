import type { MacroContextPayload } from "@/lib/api/fetch-macro-context";

/** Same 5d sector buckets as dashboard `classifySectorTapeTone` (ETF % moves). */
export type SectorTapeKind = "defensive" | "risk_on" | "mixed" | "narrow" | "unknown";

export function sectorTapeKindFromPct5d(
  pcts: Array<number | null | undefined>
): SectorTapeKind {
  const vals = pcts.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (vals.length === 0) return "unknown";
  const up = vals.filter((x) => x > 0.2).length;
  const down = vals.filter((x) => x < -0.2).length;
  if (up >= 2 && down >= 2) return "mixed";
  if (down >= 3 && up <= 1) return "defensive";
  if (up >= 3 && down <= 1) return "risk_on";
  return "narrow";
}

export function weeklyIndexAvgPct5d(pcts: Array<number | null | undefined>): number | null {
  const vals = pcts.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Single headline for Market pulse — maps backend `macro_risk_level` (FRED + Polygon pulse). */
export function macroRiskStateHeadline(macro: MacroContextPayload | null): string {
  if (!macro) return "Unavailable";
  const level = String(macro.macro_risk_level ?? macro.macro_risk ?? "low").toLowerCase();
  if (level === "critical" || level === "elevated") return "Elevated";
  if (level === "moderate") return "Upcoming";
  return "Known / absorbed";
}

export function macroRiskStateTip(macro: MacroContextPayload | null): string {
  if (!macro) {
    return "Macro pulse did not load. This is not an all-clear—only that the dashboard could not read FRED/Polygon macro context.";
  }
  const level = String(macro.macro_risk_level ?? macro.macro_risk ?? "low").toLowerCase();
  if (level === "critical") {
    return "Backend marks high-impact macro as imminent. No dates here—open Evidence or macro sources when you need detail.";
  }
  if (level === "elevated") {
    return "High-impact macro sits today in the pulse window. State-only read; not a trade signal.";
  }
  if (level === "moderate") {
    return "High-impact items are queued in the look-ahead stack (FRED + economics overlay). Still state-only—no calendar dump on this row.";
  }
  return "No imminent high-impact stress in the macro pulse window this load—absorbed/quiet, not a promise of calm markets.";
}

/** Watchlist / universe readiness — counts only, no tickers (matches DailyBarScanner + home universe sizing). */
export function watchlistReadinessLine(opts: {
  scannerError?: string;
  swingSetupCount: number;
  swingUniverseSymbolCount: number | null | undefined;
}): string {
  if (opts.scannerError) return "Readiness unknown — scanner did not finish.";
  if (opts.swingSetupCount > 0) {
    return "At least one evaluated symbol met swing readiness (DailyBarScanner gates passed).";
  }
  const n = opts.swingUniverseSymbolCount;
  if (typeof n === "number" && n > 0) {
    return `No symbols met swing readiness across ${n} evaluated names (score ≥ 0.48, ≥205 daily US bars, pattern + liquidity checks).`;
  }
  return "No symbols met swing readiness (score ≥ 0.48, ≥205 daily US bars, pattern + liquidity checks).";
}

/**
 * What would bring swing rows back — tied to shipped thresholds and payloads, not predictions.
 * Regime thresholds mirror `regimeFromSpyQqq` / scanner-load; swing gates mirror `POST /v1/signals/swing/setups` defaults.
 */
export function buildSwingReenableBullets(opts: {
  regimeLabel: string;
  sectorTape: SectorTapeKind;
  weeklyAvgPct5d: number | null;
}): string[] {
  const rl = opts.regimeLabel.trim().toLowerCase();
  const bear = rl.includes("bear");
  const bull = rl.includes("bull");
  const st = opts.sectorTape;
  const wa = opts.weeklyAvgPct5d;

  const b1 = bear
    ? "Regime axis: SPY/QQQ session % leaves Bearish (scanner uses SPY > −0.2% and QQQ > −0.25% to drop the Bearish label — same regime string posted to POST /v1/signals/swing/setups)."
    : bull
      ? "Regime axis already Bullish — swing rows still need each symbol to pass DailyBarScanner (min score 0.48, ≥205 daily bars, liquidity snapshot fields)."
      : "Regime axis: clearer Bullish or Bearish separation on SPY/QQQ session % so the `regime` field sent to swing/setups is not stuck in Neutral chop.";

  let b2: string;
  if (bear && (st === "mixed" || st === "narrow" || st === "risk_on" || st === "unknown")) {
    b2 =
      "Sector / confluence skew: dashboard sector ETF 5d buckets read confirming vs the tape (fewer conflicting up/down buckets) so swing confluence is not fighting leadership.";
  } else if (bear && st === "defensive") {
    b2 =
      "Sector skew is already defensive — gating is mostly per-symbol: DailyBarScanner still needs a passing pattern stack (EMA crosses / weekly RSI recovery / volume expansion) above the 0.48 score floor.";
  } else if (bull && st === "defensive") {
    b2 =
      "Sector skew catches up to the Bullish tape (cyclical 5d confirmation) so macro-style layers are not arguing with price.";
  } else {
    b2 =
      "Sector skew stays coherent with the headline regime so confluence inputs are not cross-current versus indexes.";
  }

  let b3: string;
  if (wa != null && wa <= -0.6) {
    b3 =
      "Weekly structure: SPY/QQQ/IWM 5-session average lifts out of defensive drift (>-0.6% on the weekly panel) so swing context and benchmark trend align.";
  } else if (wa != null && wa >= 0.6) {
    b3 =
      "Weekly structure is already constructive on average — remaining blockers are symbol-local (scanner min_score 0.48, min daily history, liquidity payload completeness).";
  } else {
    b3 =
      "Weekly structure: indexes reclaim a clearer medium-term skew (weekly averages move off mixed drift) while daily bars stay sufficient for EMA200-style gates.";
  }

  return [b1, b2, b3];
}

export type AlignmentLadderRow = { key: string; label: string; state: string };

export function buildAlignmentLadder(opts: {
  macro: MacroContextPayload | null;
  regimeLabel: string;
  regimePriceBreadthOnly: boolean;
  sectorTape: SectorTapeKind;
  sectorChipKind: "confirming" | "nonconfirming" | "mixed" | null;
  weeklyAvgPct5d: number | null;
  swingSetupCount: number;
  scannerError?: string;
}): AlignmentLadderRow[] {
  const macroHead = macroRiskStateHeadline(opts.macro);

  const rl = opts.regimeLabel.trim();
  const regimeState = opts.regimePriceBreadthOnly ? `${rl} (price + breadth)` : rl;

  let sectorState: string;
  if (opts.sectorChipKind === "confirming") sectorState = "Confirming";
  else if (opts.sectorChipKind === "nonconfirming") sectorState = "Non-confirming";
  else if (opts.sectorChipKind === "mixed") sectorState = "Mixed";
  else {
    const st = opts.sectorTape;
    if (st === "unknown") sectorState = "—";
    else sectorState = st === "defensive" ? "Defensive" : st === "risk_on" ? "Risk-on" : st === "mixed" ? "Mixed" : "Narrow";
  }

  const wa = opts.weeklyAvgPct5d;
  let structureState: string;
  if (wa == null) structureState = "—";
  else if (wa >= 0.6) structureState = "Constructive 5d";
  else if (wa <= -0.6) structureState = "Defensive 5d";
  else structureState = "Mixed 5d";

  let setupsState: string;
  if (opts.scannerError) setupsState = "Scanner error";
  else if (opts.swingSetupCount > 0) setupsState = "Active";
  else setupsState = "Suppressed";

  return [
    { key: "macro", label: "Macro pulse", state: macroHead },
    { key: "regime", label: "Regime", state: regimeState },
    { key: "sectors", label: "Sectors (5d)", state: sectorState },
    { key: "structure", label: "Index structure", state: structureState },
    { key: "setups", label: "Swing setups", state: setupsState }
  ];
}

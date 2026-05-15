import type { MacroContextPayload } from "@/lib/api/fetch-macro-context";
import type { MarketStatusPayload } from "@/lib/api/market";

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

/** One-line watchlist row; pair with `watchlistReadinessLine` inside an InfoTip for full thresholds. */
export function watchlistReadinessShortLine(opts: {
  scannerError?: string;
  swingSetupCount: number;
  swingUniverseSymbolCount: number | null | undefined;
}): string {
  if (opts.scannerError) return "Readiness unknown — scanner did not finish.";
  if (opts.swingSetupCount > 0) return "At least one symbol passed swing readiness.";
  const n = opts.swingUniverseSymbolCount;
  if (typeof n === "number" && n > 0) {
    return `No passing rows across ${n} evaluated symbols.`;
  }
  return "No symbols passed swing readiness gates.";
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

/** Short ladder lines for the dashboard; full reasoning stays in `buildSwingReenableBullets` (use in the re-enable InfoTip). */
export function buildSwingReenableBulletsShort(opts: {
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
    ? "Regime: bearish tape — SPY/QQQ must reclaim swing thresholds before the label clears."
    : bull
      ? "Swing: tape can be risk-on; symbols still need DailyBarScanner passes (score, bars, liquidity)."
      : "Regime: neutral chop — swing/setups wants a clearer Bullish or Bearish tape label.";

  let b2: string;
  if (bear && (st === "mixed" || st === "narrow" || st === "risk_on" || st === "unknown")) {
    b2 = "Sectors: leadership is cross-current vs the headline tape — weakens confluence.";
  } else if (bear && st === "defensive") {
    b2 = "Sectors: defensive skew matches the tape — gating is mostly per-symbol.";
  } else if (bull && st === "defensive") {
    b2 = "Sectors: cyclicals lag a Bullish label — watch whether the tape broadens.";
  } else {
    b2 = "Sectors: keep skew coherent with headline regime so rows are not fighting the tape.";
  }

  let b3: string;
  if (wa != null && wa <= -0.6) {
    b3 = "Weekly: indexes need a cleaner constructive 5d skew (off defensive drift) for swing context.";
  } else if (wa != null && wa >= 0.6) {
    b3 = "Weekly: structure looks constructive — remaining gaps are symbol-local gates.";
  } else {
    b3 = "Weekly: mixed 5d drift — clearer medium-term skew helps alongside daily history.";
  }

  return [b1, b2, b3];
}

export function buildSwingReenableBulletsJoined(opts: {
  regimeLabel: string;
  sectorTape: SectorTapeKind;
  weeklyAvgPct5d: number | null;
}): string {
  return buildSwingReenableBullets(opts).join("\n\n");
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

// ──────────────────────────────────────────────────────────────────────────────
// DAY DESK POSTURE — Mode Separation B28 (Phase 1)
//
// The Day Desk is a parallel decision surface on the dashboard. It MUST NOT
// reuse Swing posture / vocabulary / re-enable language. These helpers
// produce the day-side strings the DayDeskPanel renders.
//
// Posture mapping:
//   active                       → real intraday setups cleared the score floor
//   monitor                      → intraday setups present but score below floor
//   suppressed_session_closed    → regular session not open (pre-market /
//                                  after-hours / weekend / holiday)
//   suppressed_no_confirmation   → session open + no intraday setup cleared
//                                  the day scanner's volume / momentum gates
//   suppressed_scanner_error     → upstream scanner failed; posture unknown
//
// The Day-Desk is INDEPENDENT of Swing posture per the assistant prompt's
// Mode-Separation rules: "It is valid for one desk to be Active while the
// other is Suppressed." Nothing in this file references Swing state.
// ──────────────────────────────────────────────────────────────────────────────

export type DayDeskPostureKind =
  | "active"
  | "monitor"
  | "suppressed_session_closed"
  | "suppressed_no_confirmation"
  | "suppressed_scanner_error";

/** Active threshold — matches the scanner's day-side min_score floor (0.55 default).
 *  Below this the desk renders as Monitor-only (the row is real but quality is marginal). */
export const DAY_DESK_ACTIVE_SCORE_FLOOR = 0.55;

/** Returns the dashboard market session bucket. `marketStatus.market` follows Polygon
 *  `/v1/marketstatus/now` semantics: "open" / "closed" / "extended-hours". Anything
 *  other than `"open"` is session-bound suppression for the Day Desk. */
function isRegularSessionOpen(marketStatus: MarketStatusPayload | undefined | null): boolean {
  if (!marketStatus) return false;
  const mkt = (marketStatus.market || "").trim().toLowerCase();
  return mkt === "open";
}

export function dayDeskPostureKind(opts: {
  marketStatus: MarketStatusPayload | undefined | null;
  daySetupCount: number;
  daySetupTopScore: number | null;
  scannerError?: string;
}): DayDeskPostureKind {
  if (opts.scannerError) return "suppressed_scanner_error";
  if (!isRegularSessionOpen(opts.marketStatus)) return "suppressed_session_closed";
  if (opts.daySetupCount <= 0) return "suppressed_no_confirmation";
  const top = opts.daySetupTopScore;
  if (typeof top === "number" && Number.isFinite(top) && top >= DAY_DESK_ACTIVE_SCORE_FLOOR) {
    return "active";
  }
  return "monitor";
}

/** Day-vocabulary headline for the desk's Primary Read block. Must NEVER reuse
 *  swing wording ("regime alignment", "multi-day structure", "sector confirmation") —
 *  those belong to the Swing Desk. */
export function emptyDayPostureHeadline(kind: DayDeskPostureKind): string {
  switch (kind) {
    case "active":
      return "Day Desk: Active";
    case "monitor":
      return "Day Desk: Monitor-only";
    case "suppressed_session_closed":
      return "Day Desk suppressed — session closed";
    case "suppressed_no_confirmation":
      return "Day Desk suppressed — intraday confirmation absent";
    case "suppressed_scanner_error":
      return "Day Desk: scanner did not complete";
  }
}

export function emptyDayOneLiner(
  kind: DayDeskPostureKind,
  marketStatus: MarketStatusPayload | undefined | null
): string {
  const mkt = (marketStatus?.market || "").trim().toLowerCase();
  switch (kind) {
    case "active":
      return "At least one intraday symbol cleared volume / momentum gates this load.";
    case "monitor":
      return "Intraday setups present but scores sit near the floor — confirmation has not strengthened.";
    case "suppressed_session_closed":
      if (mkt === "extended-hours" || mkt === "extendedhours") {
        return "Extended-hours print only — intraday gates require regular-session price action.";
      }
      return "Session closed — intraday setups are session-bound and resume at the next regular open.";
    case "suppressed_no_confirmation":
      return "Session is open, but no intraday symbol cleared volume / momentum / session-structure gates this load.";
    case "suppressed_scanner_error":
      return "Intraday scanner did not finish — Day Desk posture cannot be determined this load.";
  }
}

/** Single suppression-style status line — pairs with the headline above in the empty-state pattern
 *  (mirrors `emptySwingSuppressionStatusLine` on the Swing Desk). Day vocabulary only. */
export function dayDeskSuppressionStatusLine(kind: DayDeskPostureKind): string {
  switch (kind) {
    case "active":
      return "Day signals cleared — confirmation gates passed.";
    case "monitor":
      return "Monitor-only — quality is below the actionable floor.";
    case "suppressed_session_closed":
      return "Signal suppressed — outside regular session.";
    case "suppressed_no_confirmation":
      return "Signal suppressed — intraday confirmation absent.";
    case "suppressed_scanner_error":
      return "Posture unknown — scanner error.";
  }
}

/** What would bring intraday rows back. DAY-VOCABULARY ONLY — the prompt's Mode-Aware
 *  Empty-State Language rule explicitly forbids reusing swing language ("regime / sector
 *  alignment, structure readiness") for day suppression. */
export function buildDayReenableBullets(opts: {
  marketStatus: MarketStatusPayload | undefined | null;
  daySetupCount: number;
}): string[] {
  const open = isRegularSessionOpen(opts.marketStatus);

  const b1 = open
    ? "Intraday volume expansion: a candidate's session volume needs to break above its ADV-relative threshold (POST /v1/signals/day/setups checks RVOL vs prior-day baseline)."
    : "Regular session needs to open — extended-hours and overnight prints do not qualify for intraday gates; first ~30 minutes carry ORB triggers, mid-session carries trend continuation.";

  const b2 = open
    ? "Momentum confirmation: VWAP / EMA9 alignment with the same-direction tape on SPY/QQQ session % so day setups are not fighting the index."
    : "ADV / liquidity baseline: each candidate still needs ≥1M prior-day volume so the day scanner's liquidity gate is ready to clear at the next open.";

  const b3 = open
    ? "Cleaner session structure: ORB qualification before 10:00 ET, no false-breakout invalidation, range expansion vs the prior session."
    : "Session timing: trend-continuation setups want a clean overnight ledger and an open without large gap dislocations.";

  return [b1, b2, b3];
}

/** Short bullets for the inline list under the Day Desk re-enable section. Full reasoning lives in
 *  `buildDayReenableBullets` and feeds the InfoTip. */
export function buildDayReenableBulletsShort(opts: {
  marketStatus: MarketStatusPayload | undefined | null;
  daySetupCount: number;
}): string[] {
  const open = isRegularSessionOpen(opts.marketStatus);

  const b1 = open
    ? "Volume: a symbol's session volume needs to break above its ADV-relative threshold."
    : "Session: regular hours open before intraday gates can fire (extended-hours don't qualify).";

  const b2 = open
    ? "Momentum: VWAP / EMA9 alignment + same-direction tape on SPY/QQQ."
    : "Liquidity: candidates need ≥1M prior-day volume to pass the day liquidity gate at the open.";

  const b3 = open
    ? "Structure: ORB qualification before 10:00 ET, no false-breakout invalidation."
    : "Timing: clean overnight + open without a large gap dislocation.";

  return [b1, b2, b3];
}

/** Single headline for the dashboard system-state banner (both desks summarized). */
export type DashboardSystemStateKind = "actionable" | "monitor" | "suppressed";

export function dashboardSystemStateKind(opts: {
  swingDeskActive: boolean;
  dayDeskPosture: DayDeskPostureKind;
  dayTradingSurfaces: boolean;
}): DashboardSystemStateKind {
  if (opts.swingDeskActive || opts.dayDeskPosture === "active") return "actionable";
  if (opts.dayTradingSurfaces && opts.dayDeskPosture === "monitor") return "monitor";
  return "suppressed";
}

export function dashboardSystemStateLabel(kind: DashboardSystemStateKind): string {
  switch (kind) {
    case "actionable":
      return "ACTIONABLE";
    case "monitor":
      return "MONITOR ONLY";
    default:
      return "SUPPRESSED";
  }
}

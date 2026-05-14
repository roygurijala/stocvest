/**
 * Scanner empty-state context builders — pure helpers.
 *
 * **Why this file exists**
 *
 * When the scanner has zero gap-intelligence rows and zero setups, the
 * default "No swing setups — regime and structure not aligned." line
 * tells the user nothing about WHY. The Scanner is the surface where
 * users come to plan their session; an uninformative empty state makes
 * them assume the system is broken / not running / not for them, and
 * they bounce.
 *
 * This module derives a structured **explanation context** from the
 * scanner overview — the universe scanned, the market regime, the
 * session state, the SPY/QQQ tape — so the empty-state component can
 * render a calm, informative "here's what we scanned and here's what
 * would re-enable signals" panel instead of a bland line of text.
 *
 * **Legal / safety contract**
 *
 * The empty-state surface MUST follow the same Mode Separation rules
 * the rest of the app follows:
 *
 *   - Swing-side copy never mentions day-side vocabulary
 *     ("intraday confirmation", "VWAP", "ORB", "session structure").
 *   - Day-side copy never mentions swing-side vocabulary
 *     ("regime alignment", "multi-day structure", "sector confirmation",
 *     "DailyBarScanner", "weekly RSI").
 *   - Bullets describe **what would re-enable signals** — they do NOT
 *     predict outcomes, do NOT name a "good time to trade," and do NOT
 *     promise that satisfying any single bullet produces a setup.
 *
 * The bullet copy reuses the dashboard's existing
 * `buildSwingReenableBullets` / `buildDayReenableBullets` so the
 * Scanner and Dashboard never disagree about which gates the engines
 * use.
 */

import {
  buildDayReenableBullets,
  buildSwingReenableBullets,
  sectorTapeKindFromPct5d,
  type SectorTapeKind
} from "@/lib/dashboard-posture";
import { isUsRegularSessionOpenEt } from "@/lib/market-hours-et";

/**
 * Narrow input shape — we only read `.market` from the payload (to
 * decide if the regular session is open / closed / extended-hours), so
 * the helper accepts anything carrying that one field. Tests can pass
 * `{ market: "open" }` literally without having to construct the full
 * Polygon-shaped payload (`exchanges`, `currencies`, …). Production
 * callers pass the real `MarketStatusPayload` from `@/lib/api/market`
 * which is structurally a superset.
 */
export interface MarketStatusLite {
  market?: string | null;
}

/**
 * Wire shape for the swing-side empty-state context. The component
 * consumes this directly — every field is renderable on its own without
 * additional fetches.
 */
export interface SwingEmptyStateContext {
  /** Mode this context is for — always `"swing"` here, present as a discriminator. */
  mode: "swing";
  /** Universe size scanned for this load (null when the scanner didn't report it). */
  universeSize: number | null;
  /** Regime label as the scanner reported it (free-form, may be empty). */
  regimeLabel: string;
  /** Session %  on SPY (signed, percent) or null when unavailable. */
  spyPct: number | null;
  /** Session % on QQQ (signed, percent) or null when unavailable. */
  qqqPct: number | null;
  /** Headline status line — short, observational, never evaluative. */
  headline: string;
  /** One-line explanation: what's happening, calm voice. */
  oneLiner: string;
  /** Bullets describing what would re-enable swing rows — borrowed from the dashboard helper. */
  reenableBullets: string[];
  /** Sector tape kind from the dashboard sector-rotation helper. Display-only. */
  sectorTape: SectorTapeKind;
}

/**
 * Wire shape for the day-side empty-state context. Symmetric with
 * `SwingEmptyStateContext` but the bullet copy uses day vocabulary
 * (volume / momentum / session-structure / VWAP / ORB / RVOL).
 */
export interface DayEmptyStateContext {
  mode: "day";
  universeSize: number | null;
  regimeLabel: string;
  spyPct: number | null;
  qqqPct: number | null;
  headline: string;
  oneLiner: string;
  reenableBullets: string[];
  /** Whether the regular session is currently open. Used for copy variants. */
  sessionOpen: boolean;
}

/**
 * Wire shape for the Gap Intelligence empty-state context.
 *
 * Gap Intelligence is structurally a **different surface** than the
 * setups list — it flags overnight close→open dislocations gated on
 * magnitude + volume backing, not regime + per-symbol score. Reusing
 * the swing-setups empty state on this column made both side-by-side
 * panels show the exact same text, which reads as a bug.
 *
 * `surface: "gap"` is the discriminator. The `mode` field still drives
 * the role accent (so on the Swing tab the gap-empty card matches the
 * Swing Desk hue, and on the Day tab it matches the Day Desk hue) but
 * the headline / one-liner / re-enable copy is all about gap-side
 * gates: magnitude threshold, volume confirmation, universe coverage.
 */
export interface GapIntelEmptyStateContext {
  surface: "gap";
  /** Which desk's hue + pill label to render. Inherits from the surrounding scanner tab. */
  mode: "swing" | "day";
  universeSize: number | null;
  regimeLabel: string;
  spyPct: number | null;
  qqqPct: number | null;
  headline: string;
  oneLiner: string;
  reenableBullets: string[];
  /** Day-tab variant carries the session state since intraday gap survival is session-bound. */
  sessionOpen: boolean | null;
}

export type ScannerEmptyStateContext =
  | SwingEmptyStateContext
  | DayEmptyStateContext
  | GapIntelEmptyStateContext;

/**
 * Minimal slice of `ScannerOverview` we actually read. Keeping the
 * input shape narrow makes the helper trivially testable with literal
 * fixtures.
 */
export interface EmptyStateOverviewInput {
  regimeLabel?: string | null;
  spyPct?: number | null;
  qqqPct?: number | null;
  swingUniverseSymbolCount?: number | null;
  /**
   * From gap-intelligence `snapshot_symbol_count`: symbols that passed gap-intel gates
   * (price, volume, prior-day volume, min |gap| %) before the top-N cap — not raw Polygon row count.
   */
  gapIntelligenceSnapshotSymbolCount?: number | null;
  /** Sector ETF 5-day percents for the dashboard sector-rotation helper. */
  sectorPct5d?: Array<number | null | undefined>;
  /** Optional explicit market status; defaults to `isUsRegularSessionOpenEt()`. */
  marketStatus?: MarketStatusLite | null;
}

/** Prefer gap-intel eligible-universe count when the API reports it; else bars/swing universe size. */
export function effectiveScannerUniverseDisplayCount(overview: EmptyStateOverviewInput): number | null {
  const g = overview.gapIntelligenceSnapshotSymbolCount;
  if (typeof g === "number" && g > 0) return g;
  const s = overview.swingUniverseSymbolCount;
  if (typeof s === "number" && s > 0) return s;
  return null;
}

function tapeWord(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Headline copy for the Swing-side empty state. Observational, never
 * evaluative ("the system is in a quiet posture"), and explicitly
 * names the regime so the user can see WHY swing rows are gated.
 */
function swingHeadlineFor(regimeLabel: string): string {
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bear")) {
    return "Swing Desk is quiet — bearish regime gates the watchlist universe.";
  }
  if (r.includes("bull")) {
    return "Swing Desk is quiet — regime is constructive but per-symbol gates have not cleared.";
  }
  if (r.includes("neutral") || r === "") {
    return "Swing Desk is quiet — regime is neutral chop and the universe has not produced a passing row.";
  }
  return "Swing Desk is quiet — no candidate cleared the swing scanner this load.";
}

function swingOneLinerFor(regimeLabel: string, universeSize: number | null): string {
  const ctx =
    typeof universeSize === "number" && universeSize > 0
      ? `Scanned ${universeSize} symbols this load. `
      : "";
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bear")) {
    return `${ctx}Multi-day setups need the headline tape to clear bearish thresholds and a passing daily-bar score (≥ 0.48). The scanner is honest when neither side of those gates is close.`;
  }
  if (r.includes("bull")) {
    return `${ctx}Multi-day setups need each candidate to clear per-symbol gates on DailyBarScanner — EMA crosses / weekly RSI recovery / volume expansion / pattern stack. Regime cooperation alone is not enough.`;
  }
  return `${ctx}Multi-day setups need a clearer headline tape AND a passing per-symbol score. Neither side is producing a candidate this load.`;
}

function dayHeadlineFor(sessionOpen: boolean): string {
  return sessionOpen
    ? "Day Desk is quiet — intraday confirmation has not cleared on any symbol this load."
    : "Day Desk is suppressed — regular session is closed.";
}

function dayOneLinerFor(sessionOpen: boolean, universeSize: number | null): string {
  const ctx =
    typeof universeSize === "number" && universeSize > 0
      ? `Scanned ${universeSize} symbols this load. `
      : "";
  return sessionOpen
    ? `${ctx}Intraday setups need volume / momentum / session-structure gates to clear together — VWAP-aligned momentum, ORB qualification, and RVOL above the ADV-relative threshold. None of those came together this load.`
    : `${ctx}Intraday setups are session-bound — gates resume at the next regular open. Extended-hours and overnight prints do not qualify.`;
}

/**
 * Build the swing-side empty-state context from a thin overview slice.
 * Pure — no fetches, no side effects, deterministic on input.
 */
export function buildSwingEmptyStateContext(
  overview: EmptyStateOverviewInput
): SwingEmptyStateContext {
  const regimeLabel = (overview.regimeLabel ?? "").trim();
  const spyPct = typeof overview.spyPct === "number" ? overview.spyPct : null;
  const qqqPct = typeof overview.qqqPct === "number" ? overview.qqqPct : null;
  const universeSize = effectiveScannerUniverseDisplayCount(overview);
  const sectorTape = sectorTapeKindFromPct5d(overview.sectorPct5d ?? []);
  const r = regimeLabel.toLowerCase();
  const weeklyAvgPctHint: number | null = r.includes("bear") ? -0.8 : r.includes("bull") ? 0.8 : 0;
  const reenableBullets = buildSwingReenableBullets({
    regimeLabel,
    sectorTape,
    weeklyAvgPct5d: weeklyAvgPctHint
  });
  return {
    mode: "swing",
    universeSize,
    regimeLabel,
    spyPct,
    qqqPct,
    headline: swingHeadlineFor(regimeLabel),
    oneLiner: swingOneLinerFor(regimeLabel, universeSize),
    reenableBullets,
    sectorTape
  };
}

/**
 * Build the day-side empty-state context. The bullet copy lifts from
 * `buildDayReenableBullets` so the Scanner and Dashboard never drift
 * on which day-side gates the engine actually evaluates.
 */
export function buildDayEmptyStateContext(
  overview: EmptyStateOverviewInput
): DayEmptyStateContext {
  const regimeLabel = (overview.regimeLabel ?? "").trim();
  const spyPct = typeof overview.spyPct === "number" ? overview.spyPct : null;
  const qqqPct = typeof overview.qqqPct === "number" ? overview.qqqPct : null;
  const universeSize = effectiveScannerUniverseDisplayCount(overview);
  const sessionOpen =
    overview.marketStatus != null
      ? (overview.marketStatus.market || "").trim().toLowerCase() === "open"
      : isUsRegularSessionOpenEt();
  // `buildDayReenableBullets` accepts the wider `MarketStatusPayload`
  // type but internally only reads `.market` (via the same
  // `isRegularSessionOpen` rule we use above). Our `MarketStatusLite`
  // shape carries exactly that field, so the cast is structurally
  // safe — it just sidesteps TypeScript's strict-superset check at
  // the boundary so test fixtures don't have to construct the full
  // Polygon-shaped payload (`exchanges`, `currencies`, etc.) every
  // time they want to exercise the empty-state helper.
  const reenableBullets = buildDayReenableBullets({
    marketStatus: (overview.marketStatus ?? null) as Parameters<typeof buildDayReenableBullets>[0]["marketStatus"],
    daySetupCount: 0
  });
  return {
    mode: "day",
    universeSize,
    regimeLabel,
    spyPct,
    qqqPct,
    headline: dayHeadlineFor(sessionOpen),
    oneLiner: dayOneLinerFor(sessionOpen, universeSize),
    reenableBullets,
    sessionOpen
  };
}

/**
 * Format the SPY/QQQ tape readout as a short, observational line.
 * Returns a string suitable for direct rendering — empty string when
 * both legs are unavailable so the caller can short-circuit cleanly.
 */
export function formatTapeReadout(spyPct: number | null, qqqPct: number | null): string {
  if (spyPct == null && qqqPct == null) return "";
  const spyLeg = spyPct != null ? `SPY ${tapeWord(spyPct)}` : "SPY —";
  const qqqLeg = qqqPct != null ? `QQQ ${tapeWord(qqqPct)}` : "QQQ —";
  return `${spyLeg} · ${qqqLeg}`;
}

/**
 * Forbidden cross-mode vocabulary — used by the lock-in test that asserts
 * a swing-side empty state never accidentally includes day-side wording
 * and vice versa.
 *
 * Exported (not internal) so the test can pin the canonical list rather
 * than re-deriving its own.
 */
export const SWING_VOCABULARY_BAN_FOR_DAY: readonly string[] = [
  "regime alignment",
  "sector confirmation",
  "multi-day structure",
  "weekly RSI",
  "DailyBarScanner",
  "EMA200"
];

export const DAY_VOCABULARY_BAN_FOR_SWING: readonly string[] = [
  "intraday confirmation",
  "VWAP-aligned",
  "ORB qualification",
  "RVOL",
  "session-structure"
];

// ─── Gap Intelligence empty-state ────────────────────────────────────────

/**
 * Headline for the Gap Intelligence column. Calm, observational, names
 * the two universal gap gates (magnitude + volume) without committing
 * to mode-specific framing.
 */
function gapHeadline(): string {
  return "Gap Intelligence is quiet — no overnight prints cleared the gap thresholds.";
}

/**
 * Swing-tab one-liner for Gap Intelligence. Gap survival into the swing
 * window depends on structure holding past the open, not intraday
 * micro-structure — keep day vocabulary out.
 */
function gapOneLinerSwing(universeSize: number | null): string {
  const ctx =
    typeof universeSize === "number" && universeSize > 0
      ? `Scanned ${universeSize} symbols this load. `
      : "";
  return `${ctx}Gap Intelligence flags overnight close→open dislocations large enough to be worth a second look — names need both a meaningful gap size AND volume confirmation. None of the universe met both gates together.`;
}

/**
 * Day-tab one-liner. Same two universal gates, but the framing is
 * intraday-survival: does the gap survive the opening session and
 * confirm with same-direction tape, not whether it holds for days.
 */
function gapOneLinerDay(universeSize: number | null, sessionOpen: boolean): string {
  const ctx =
    typeof universeSize === "number" && universeSize > 0
      ? `Scanned ${universeSize} symbols this load. `
      : "";
  return sessionOpen
    ? `${ctx}Gap Intelligence flags overnight close→open dislocations large enough to consider for intraday play — names need both a meaningful gap size AND opening-session volume confirmation. None of the universe met both gates together.`
    : `${ctx}Gap Intelligence flags overnight close→open dislocations that the next session would have to defend or fade — magnitude + opening volume are the two gates. Outside regular session these are tape observations only; intraday qualification resumes at the next open.`;
}

/**
 * Re-enable bullets for the Swing-tab Gap Intelligence empty state.
 *
 * Vocabulary discipline: these talk about magnitude / volume / universe
 * coverage / structure-not-immediately-faded — the gates the gap
 * scanner actually evaluates against the daily-bar universe. They
 * deliberately avoid day-side vocabulary ("VWAP", "ORB",
 * "session-structure", "RVOL") so a Swing-tab user doesn't get
 * cross-mode language. The day-tab variant below adds those terms
 * where they're appropriate.
 */
function gapReenableBulletsSwing(): string[] {
  return [
    "Magnitude: a candidate's overnight gap (yesterday's close vs. today's open) needs to clear the absolute % threshold the gap scanner uses, so small drifts aren't surfaced as actionable dislocations.",
    "Volume confirmation: the gap needs same-direction premarket volume to flag — pure-news prints without volume conviction are unreliable for either follow-through or mean-reversion reads.",
    "Universe coverage: Gap Intelligence reads from the same daily-bar universe as the swing engine — symbols with stale or missing daily bars (under the scanner's min-history threshold) don't qualify regardless of gap size."
  ];
}

function gapReenableBulletsDay(sessionOpen: boolean): string[] {
  const b1 =
    "Magnitude: a candidate's overnight gap (yesterday's close vs. today's open) needs to clear the absolute % threshold the gap scanner uses, so small drifts aren't surfaced as actionable dislocations.";
  const b2 = sessionOpen
    ? "Volume confirmation: the gap needs same-direction opening-session volume above the gap scanner's ADV-relative floor so the tape is committing to the level, not just printing on thin overnight liquidity."
    : "Volume confirmation: the gap needs same-direction premarket volume building toward the open, so the intraday tape is set up to defend the level — gates resume at the next regular session.";
  const b3 = sessionOpen
    ? "Universe coverage: Gap Intelligence reads from the same daily-bar universe as the day scanner — symbols with stale or missing daily bars don't qualify, and a gap that immediately full-fills inside the opening session is dropped rather than persisted."
    : "Universe coverage: Gap Intelligence reads from the same daily-bar universe the scanner uses — symbols with stale or missing daily bars don't qualify regardless of overnight magnitude.";
  return [b1, b2, b3];
}

/**
 * Build the Gap Intelligence empty-state context. `mode` is the
 * surrounding scanner tab (swing / day) and only drives copy +
 * accent — the gap surface itself is always one column, not two.
 *
 * "Both"-tab callers should pass `"swing"` here since the Gap
 * Intelligence panel is on the swing-rail side of the scanner grid
 * and gaps map most naturally to the multi-day frame; the Day Desk
 * surfaces gap reads through its own setup rows.
 */
export function buildGapIntelEmptyStateContext(
  overview: EmptyStateOverviewInput,
  mode: "swing" | "day"
): GapIntelEmptyStateContext {
  const regimeLabel = (overview.regimeLabel ?? "").trim();
  const spyPct = typeof overview.spyPct === "number" ? overview.spyPct : null;
  const qqqPct = typeof overview.qqqPct === "number" ? overview.qqqPct : null;
  const universeSize = effectiveScannerUniverseDisplayCount(overview);
  const sessionOpen =
    mode === "day"
      ? overview.marketStatus != null
        ? (overview.marketStatus.market || "").trim().toLowerCase() === "open"
        : isUsRegularSessionOpenEt()
      : null;
  const oneLiner =
    mode === "swing"
      ? gapOneLinerSwing(universeSize)
      : gapOneLinerDay(universeSize, sessionOpen === true);
  const reenableBullets =
    mode === "swing"
      ? gapReenableBulletsSwing()
      : gapReenableBulletsDay(sessionOpen === true);
  return {
    surface: "gap",
    mode,
    universeSize,
    regimeLabel,
    spyPct,
    qqqPct,
    headline: gapHeadline(),
    oneLiner,
    reenableBullets,
    sessionOpen
  };
}

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
import type { MarketStatusPayload } from "@/lib/api/macro";

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

export type ScannerEmptyStateContext = SwingEmptyStateContext | DayEmptyStateContext;

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
  /** Sector ETF 5-day percents for the dashboard sector-rotation helper. */
  sectorPct5d?: Array<number | null | undefined>;
  /** Optional explicit market status; defaults to `isUsRegularSessionOpenEt()`. */
  marketStatus?: MarketStatusPayload | null;
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
  const universeSize =
    typeof overview.swingUniverseSymbolCount === "number"
      ? overview.swingUniverseSymbolCount
      : null;
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
  const universeSize =
    typeof overview.swingUniverseSymbolCount === "number"
      ? overview.swingUniverseSymbolCount
      : null;
  const sessionOpen =
    overview.marketStatus != null
      ? (overview.marketStatus.market || "").trim().toLowerCase() === "open"
      : isUsRegularSessionOpenEt();
  const reenableBullets = buildDayReenableBullets({
    marketStatus: overview.marketStatus ?? null,
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

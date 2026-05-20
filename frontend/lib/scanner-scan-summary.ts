/**
 * Scanner scan summary — single presentation contract for the scanner hero,
 * next actions, near-qualification lane, and watchlist progression.
 *
 * Engine truth lives in setups APIs + maturation; this module only shapes
 * what the UI renders (no gating of evaluation).
 */

import type {
  GapIntelligenceItem,
  IntradaySetupPayload,
  ScannerOverview,
  WatchlistDashboardStatus
} from "@/lib/api/scanner";
import { isUsRegularSessionOpenEt, nextRegularSessionOpenLabel } from "@/lib/market-hours-et";
import { isSwingSetupRow } from "@/lib/scanner-setups-response";
import {
  formatWatchlistMaturationDisplayLine,
  layersAwayFromActionable
} from "@/lib/alignment-display-tier";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import {
  buildScannerUnifiedHeadline,
  formatScannerNearAlignmentLine
} from "@/lib/scanner-progress-messaging";
import type { SymbolTrackingMap } from "@/lib/watchlist-tracking-presentation";

export type ScannerAlignmentWire = {
  aligned: number;
  total: number;
  label: string;
};

export type ScannerNearQualificationRow = {
  symbol: string;
  desk: "swing" | "day";
  score: number;
  direction: string;
  alignment: ScannerAlignmentWire | null;
  layers_away?: number;
  company_name?: string;
};

export type ScannerWatchlistProgressionRow = {
  symbol: string;
  desk: "swing" | "day";
  state: string;
  label: string;
  layers_aligned?: number;
  layers_total?: number;
  layers_away?: number;
};

export type ScannerScanSummary = {
  scanned_at_iso: string;
  session: {
    regular_open: boolean;
    last_scan_label: string;
    next_evaluation_label: string;
  };
  universe: {
    symbols_evaluated: number | null;
    gap_snapshot_count: number | null;
  };
  regime: {
    label: string;
    spy_pct: number | null;
    qqq_pct: number | null;
  };
  qualifying: {
    total: number;
    swing: number;
    day: number;
    gap_flags: number;
  };
  watchlist: WatchlistDashboardStatus | null;
  near_qualification: ScannerNearQualificationRow[];
  watchlist_progression: ScannerWatchlistProgressionRow[];
  quiet: {
    unified_headline: string;
    detail_line: string;
  };
};

const PROGRESSION_STATES = new Set(["developing", "re_evaluating"]);

function alignmentFromSetup(row: IntradaySetupPayload): {
  wire: ScannerAlignmentWire;
  layersAway: number;
} | null {
  const wire = (row as { alignment?: ScannerAlignmentWire }).alignment;
  let aligned: number;
  let total: number;
  if (wire && typeof wire.aligned === "number" && typeof wire.total === "number") {
    aligned = wire.aligned;
    total = wire.total;
  } else {
    const triggers = row.triggers?.length ?? 0;
    if (triggers <= 0) return null;
    aligned = triggers;
    total = 6;
  }
  const formatted = formatScannerNearAlignmentLine(aligned, total);
  return {
    wire: {
      aligned,
      total,
      label: formatted.chip
    },
    layersAway: formatted.layersAway
  };
}

export function nearRowsFromSetups(rows: IntradaySetupPayload[]): ScannerNearQualificationRow[] {
  const out: ScannerNearQualificationRow[] = [];
  for (const row of rows) {
    const sym = row.symbol.trim().toUpperCase();
    if (!sym) continue;
    const alignment = alignmentFromSetup(row);
    out.push({
      symbol: sym,
      desk: isSwingSetupRow(row) ? "swing" : "day",
      score: row.score,
      direction: row.direction,
      alignment: alignment?.wire ?? null,
      layers_away: alignment?.layersAway,
      company_name: row.company_name
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 5);
}

export function buildWatchlistProgressionRows(
  symbols: string[],
  trackingMap: SymbolTrackingMap,
  swingBySymbol: Record<string, WatchlistMaturationRow>,
  dayBySymbol: Record<string, WatchlistMaturationRow>,
  dualDesk: boolean,
  limit = 5
): ScannerWatchlistProgressionRow[] {
  const out: ScannerWatchlistProgressionRow[] = [];
  for (const sym of symbols) {
    const t = trackingMap[sym] ?? { swing: true, day: dualDesk };
    const desks: Array<["swing" | "day", WatchlistMaturationRow | undefined]> = [];
    if (t.swing) desks.push(["swing", swingBySymbol[sym]]);
    if (dualDesk && t.day) desks.push(["day", dayBySymbol[sym]]);
    for (const [desk, row] of desks) {
      const st = (row?.state || "").toLowerCase();
      if (!PROGRESSION_STATES.has(st)) continue;
      const total = row?.layers_total ?? 6;
      const aligned =
        typeof row?.layers_aligned === "number" && Number.isFinite(row.layers_aligned)
          ? row.layers_aligned
          : undefined;
      const display =
        formatWatchlistMaturationDisplayLine(row) ??
        (row?.readiness_label || row?.label || st.replace(/_/g, " "));
      out.push({
        symbol: sym,
        desk,
        state: st,
        label: display,
        layers_aligned: aligned,
        layers_total: typeof aligned === "number" ? total : undefined,
        layers_away:
          typeof aligned === "number" ? layersAwayFromActionable(aligned, total) : undefined
      });
    }
  }
  const rank = (st: string) => (st === "re_evaluating" ? 2 : 1);
  out.sort((a, b) => rank(b.state) - rank(a.state) || a.symbol.localeCompare(b.symbol));
  return out.slice(0, limit);
}

export function countQualifyingSetups(setups: IntradaySetupPayload[]): { total: number; swing: number; day: number } {
  let swing = 0;
  let day = 0;
  for (const s of setups) {
    if (isSwingSetupRow(s)) swing += 1;
    else day += 1;
  }
  return { total: setups.length, swing, day };
}

export function buildScannerScanSummary(input: {
  scannedAtIso: string;
  overview: Pick<
    ScannerOverview,
    | "setups"
    | "gapIntelligence"
    | "regimeLabel"
    | "spyPct"
    | "qqqPct"
    | "swingUniverseSymbolCount"
    | "gapIntelligenceSnapshotSymbolCount"
    | "watchlistStatus"
  >;
  nearQualificationSetups: IntradaySetupPayload[];
  watchlistProgression: ScannerWatchlistProgressionRow[];
}): ScannerScanSummary {
  const { overview, nearQualificationSetups, watchlistProgression, scannedAtIso } = input;
  const counts = countQualifyingSetups(overview.setups);
  const gapFlags = overview.gapIntelligence.length;
  const sessionOpen = isUsRegularSessionOpenEt(new Date(scannedAtIso));
  const lastScanLabel = new Date(scannedAtIso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const nearRows = nearRowsFromSetups(nearQualificationSetups);
  const unified_headline = buildScannerUnifiedHeadline({
    qualifyingTotal: counts.total,
    nearCount: nearRows.length,
    progressionCount: watchlistProgression.length,
    watchlist: overview.watchlistStatus
  });

  const detail_line =
    counts.total === 0
      ? "Across all strategies: no setups ready"
      : `Gaps ${gapFlags} · Swing ${counts.swing} · Day ${counts.day}`;

  return {
    scanned_at_iso: scannedAtIso,
    session: {
      regular_open: sessionOpen,
      last_scan_label: lastScanLabel,
      next_evaluation_label: sessionOpen ? "Updates on refresh" : nextRegularSessionOpenLabel(new Date(scannedAtIso))
    },
    universe: {
      symbols_evaluated: overview.swingUniverseSymbolCount ?? null,
      gap_snapshot_count: overview.gapIntelligenceSnapshotSymbolCount ?? null
    },
    regime: {
      label: overview.regimeLabel || "Neutral",
      spy_pct: overview.spyPct ?? null,
      qqq_pct: overview.qqqPct ?? null
    },
    qualifying: {
      total: counts.total,
      swing: counts.swing,
      day: counts.day,
      gap_flags: gapFlags
    },
    watchlist: overview.watchlistStatus ?? null,
    near_qualification: nearRows,
    watchlist_progression: watchlistProgression,
    quiet: { unified_headline, detail_line }
  };
}

export type ScannerNextAction = {
  id: string;
  label: string;
  href: string;
  show: boolean;
};

export function buildScannerNextActions(summary: ScannerScanSummary): ScannerNextAction[] {
  const wl = summary.watchlist;
  return [
    {
      id: "qualifying",
      label: "View qualifying setups",
      href: "#scanner-setups-section",
      show: summary.qualifying.total > 0
    },
    {
      id: "near",
      label: "Review setups approaching threshold",
      href: "#scanner-near-qualification",
      show: summary.near_qualification.length > 0
    },
    {
      id: "watchlist",
      label: "Check watchlist progression",
      href: "/dashboard/watchlists",
      show: Boolean(wl && (wl.developing > 0 || wl.actionable > 0))
    },
    {
      id: "tracking",
      label: "Adjust desk tracking",
      href: "/dashboard/watchlists",
      show: Boolean(wl && wl.monitored > 0)
    },
    {
      id: "why",
      label: "Why nothing passed today",
      href: "#scanner-scan-education",
      show: summary.qualifying.total === 0
    }
  ].filter((a) => a.show);
}

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
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
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
  company_name?: string;
};

export type ScannerWatchlistProgressionRow = {
  symbol: string;
  desk: "swing" | "day";
  state: string;
  label: string;
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

function alignmentFromSetup(row: IntradaySetupPayload): ScannerAlignmentWire | null {
  const wire = (row as { alignment?: ScannerAlignmentWire }).alignment;
  if (wire && typeof wire.aligned === "number" && typeof wire.total === "number") {
    return {
      aligned: wire.aligned,
      total: wire.total,
      label: wire.label || `${wire.aligned}/${wire.total} aligned`
    };
  }
  const triggers = row.triggers?.length ?? 0;
  if (triggers <= 0) return null;
  return { aligned: triggers, total: 6, label: `${triggers}/6 aligned` };
}

export function nearRowsFromSetups(rows: IntradaySetupPayload[]): ScannerNearQualificationRow[] {
  const out: ScannerNearQualificationRow[] = [];
  for (const row of rows) {
    const sym = row.symbol.trim().toUpperCase();
    if (!sym) continue;
    out.push({
      symbol: sym,
      desk: isSwingSetupRow(row) ? "swing" : "day",
      score: row.score,
      direction: row.direction,
      alignment: alignmentFromSetup(row),
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
      out.push({
        symbol: sym,
        desk,
        state: st,
        label: row?.readiness_label || row?.label || st.replace(/_/g, " ")
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
  const anyQualifying = counts.total > 0;
  const anyNear = nearQualificationSetups.length > 0;
  const anyProgression = watchlistProgression.length > 0;

  let unified_headline = "No setups passed filters this scan";
  if (anyQualifying) {
    unified_headline =
      counts.total === 1
        ? "1 qualifying setup"
        : `${counts.total} qualifying setups`;
  } else if (anyNear) {
    unified_headline = "Nothing qualified — symbols are close";
  } else if (anyProgression) {
    unified_headline = "No qualifying setups — watchlist is progressing";
  }

  const detail_line = `Gaps ${gapFlags} · Swing ${counts.swing} · Day ${counts.day}`;

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
    near_qualification: nearRowsFromSetups(nearQualificationSetups),
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
      label: "Review near qualification",
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

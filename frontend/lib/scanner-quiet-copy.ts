/** Interpretation-first copy for quiet scanner days (no engine-debug framing). */

import type { WatchlistDashboardStatus } from "@/lib/api/scanner";
import { isUsRegularSessionOpenEt } from "@/lib/market-hours-et";
import type { EmptyStateOverviewInput } from "@/lib/scanner-empty-state";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";

const MEGA_CAP_LEADERS = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "GOOG", "TSLA"];

export function buildScannerQuietSubline(
  summary: ScannerScanSummary,
  synthesis?: ScannerSynthesis | null
): string {
  if (summary.qualifying.total > 0) {
    return summary.quiet.unified_headline;
  }
  const condition = synthesis?.volume_context?.market_condition?.toLowerCase() ?? "";
  if (condition.includes("low")) return "Market quiet — low participation";
  if (condition.includes("below")) return "Market quiet — below-average participation";
  if (summary.near_qualification.length > 0) {
    return summary.quiet.unified_headline;
  }
  const regime = summary.regime.label.toLowerCase();
  if (regime.includes("bear")) return "Market quiet — risk-off regime";
  return "Market quiet — low participation";
}

/** One decisive sentence per desk empty card on quiet scan days. */
export function buildScannerDeskInterpretiveLine(
  desk: "gap" | "swing" | "day",
  overview: Pick<EmptyStateOverviewInput, "regimeLabel" | "marketStatus">
): string {
  if (desk === "gap") {
    return "No overnight gaps met magnitude and volume thresholds.";
  }
  if (desk === "day") {
    const sessionOpen =
      overview.marketStatus != null
        ? (overview.marketStatus.market || "").trim().toLowerCase() === "open"
        : isUsRegularSessionOpenEt();
    return sessionOpen
      ? "Intraday setups inactive — session gates not cleared."
      : "Intraday setups inactive — session closed.";
  }
  const r = (overview.regimeLabel ?? "").trim().toLowerCase();
  if (r.includes("bear")) return "Bearish regime is preventing multi-day setups.";
  if (r.includes("bull")) return "Multi-day setups inactive — per-symbol gates not cleared.";
  return "Multi-day setups inactive — regime and structure not aligned.";
}

export function buildScannerCauseBullets(
  summary: ScannerScanSummary,
  synthesis?: ScannerSynthesis | null
): string[] {
  const sessionVolCount = synthesis?.rejection_groups.session_volume.length ?? 0;
  const volQuiet =
    synthesis?.volume_context?.market_condition?.toLowerCase().includes("low") ||
    synthesis?.volume_context?.market_condition?.toLowerCase().includes("below");
  const avgBelow = synthesis?.volume_context?.avg_pct_below;

  const participation =
    volQuiet || sessionVolCount >= 2
      ? avgBelow != null && Number.isFinite(avgBelow)
        ? `Market volume far below intraday norms (≈${Math.round(avgBelow)}% under pace)`
        : "Market volume far below intraday norms"
      : "Volume and participation have not reached scanner thresholds";

  const leaders = pickLeaderSymbolsForCause(synthesis, summary);
  const leadersQuiet =
    leaders.length >= 2
      ? `Mega-cap leaders (${leaders.slice(0, 3).join(", ")}) not confirming`
      : summary.regime.spy_pct != null &&
          summary.regime.qqq_pct != null &&
          summary.regime.spy_pct <= 0.15 &&
          summary.regime.qqq_pct <= 0.15
        ? "Index leaders (SPY, QQQ) not confirming moves"
        : "Broad index leadership is not confirming follow-through";

  const regime = summary.regime.label.toLowerCase();
  const regimeLine = regime.includes("bear")
    ? "Bearish regime blocking follow-through"
    : regime.includes("bull")
      ? "Constructive regime — per-symbol gates still blocking entries"
      : "Current regime blocking follow-through";

  return [participation, leadersQuiet, regimeLine];
}

function pickLeaderSymbolsForCause(
  synthesis: ScannerSynthesis | null | undefined,
  summary: ScannerScanSummary
): string[] {
  const fromVol =
    synthesis?.rejection_groups.session_volume
      .map((r) => r.symbol)
      .filter((s) => MEGA_CAP_LEADERS.includes(s)) ?? [];
  if (fromVol.length > 0) return [...new Set(fromVol)];

  const fromNear =
    synthesis?.near_misses
      .filter((n) => MEGA_CAP_LEADERS.includes(n.symbol) && !n.is_market_proxy)
      .map((n) => n.symbol) ?? [];
  if (fromNear.length > 0) return [...new Set(fromNear)];

  const fromNearQual = summary.near_qualification
    .map((r) => r.symbol)
    .filter((s) => MEGA_CAP_LEADERS.includes(s));
  return [...new Set(fromNearQual)].slice(0, 3);
}

export type ClosestToQualifyingLine = {
  symbol: string;
  note: string;
};

export type ClosestQualifyingGroup = {
  label: string;
  items: Array<{ symbol: string; detail: string }>;
};

export function buildClosestToQualifyingGroups(
  synthesis?: ScannerSynthesis | null,
  summary?: ScannerScanSummary | null
): ClosestQualifyingGroup[] {
  const volume: ClosestQualifyingGroup["items"] = [];
  const structure: ClosestQualifyingGroup["items"] = [];

  if (synthesis?.near_misses?.length) {
    for (const nm of synthesis.near_misses) {
      if (nm.is_market_proxy) continue;
      const volRow = synthesis.rejection_groups.session_volume.find((r) => r.symbol === nm.symbol);
      if (volRow) {
        volume.push({
          symbol: nm.symbol,
          detail: `−${Math.round(volRow.pct_below)}% vs expected`
        });
        continue;
      }
      const structRow = synthesis.rejection_groups.structure.find((r) => r.symbol === nm.symbol);
      if (structRow) {
        structure.push({
          symbol: nm.symbol,
          detail: formatStructureBlocker(structRow.reason)
        });
        continue;
      }
      if (/volume|pace|session/i.test(nm.structure_note)) {
        const pct = nm.pct_of_needed > 0 ? Math.max(1, Math.round(100 - nm.pct_of_needed)) : null;
        volume.push({
          symbol: nm.symbol,
          detail: pct != null ? `−${pct}% vs expected` : "volume below pace"
        });
      } else {
        structure.push({
          symbol: nm.symbol,
          detail: formatStructureBlocker(nm.structure_note)
        });
      }
    }
  }

  const near = summary?.near_qualification ?? [];
  if (volume.length + structure.length === 0 && near.length > 0) {
    for (const row of near.slice(0, 4)) {
      const score = Math.round(row.score * 100);
      structure.push({
        symbol: row.symbol,
        detail: `score ${score}/100 — below threshold`
      });
    }
  }

  const groups: ClosestQualifyingGroup[] = [];
  if (volume.length > 0) {
    groups.push({ label: "Volume constrained", items: volume.slice(0, 4) });
  }
  if (structure.length > 0) {
    groups.push({ label: "Structure borderline", items: structure.slice(0, 4) });
  }
  return groups;
}

function formatStructureBlocker(reason: string): string {
  const r = reason.trim();
  if (!r) return "no confirmation";
  if (/follow|confirm/i.test(r)) return "failed confirmation (no follow-through)";
  if (/breakout|level/i.test(r)) return "near breakout level, no confirmation";
  if (/structure|price/i.test(r)) return r.replace(/^Session pace lagging;\s*/i, "").toLowerCase();
  return r.length > 48 ? `${r.slice(0, 45)}…` : r;
}

/** @deprecated Prefer {@link buildClosestToQualifyingGroups} for grouped UI. */
export function buildClosestToQualifyingLines(
  synthesis?: ScannerSynthesis | null,
  summary?: ScannerScanSummary | null
): ClosestToQualifyingLine[] {
  return buildClosestToQualifyingGroups(synthesis, summary).flatMap((g) =>
    g.items.map((item) => ({ symbol: item.symbol, note: `${g.label}: ${item.detail}` }))
  );
}

export function buildWatchlistQuietInsight(
  wl: WatchlistDashboardStatus,
  qualifyingTotal: number
): { headline: string; subline: string } | null {
  if (qualifyingTotal > 0 || wl.monitored <= 0) return null;
  const developing = wl.developing;
  const headline = "Your watchlist is active but not ready";
  const subline =
    developing > 0
      ? `${wl.monitored} monitored · ${developing} developing — none confirmed yet`
      : `${wl.monitored} monitored — none confirmed yet`;
  return { headline, subline };
}

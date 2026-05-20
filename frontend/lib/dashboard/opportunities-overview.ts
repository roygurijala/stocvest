import type { WatchlistDashboardStatus } from "@/lib/api/scanner";
import type { DailyPulseDeskSummary } from "@/lib/dashboard-daily-pulse";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";

export type OpportunityCard = {
  id: "scanner" | "watchlist" | "signals";
  title: string;
  lines: string[];
  ctaLabel: string;
  ctaHref: string;
  emphasize?: boolean;
};

function nearForDesk(summary: ScannerScanSummary | null | undefined, mode: DashboardDeskMode): number {
  if (!summary) return 0;
  return summary.near_qualification.filter((r) => r.desk === mode).length;
}

function readyForDesk(summary: ScannerScanSummary | null | undefined, mode: DashboardDeskMode): number {
  if (!summary) return 0;
  return mode === "swing" ? summary.qualifying.swing : summary.qualifying.day;
}

export function buildOpportunityCards(opts: {
  mode: DashboardDeskMode;
  scanSummary?: ScannerScanSummary | null;
  watchlistStatus?: WatchlistDashboardStatus | null;
  pulseDesk?: DailyPulseDeskSummary | null;
}): OpportunityCard[] {
  const ready = readyForDesk(opts.scanSummary, opts.mode);
  const near = nearForDesk(opts.scanSummary, opts.mode);
  const scannerLines = [
    `${ready} ready`,
    near > 0 ? `${near} near-ready ↑ (in market)` : "0 near-ready (in market)"
  ];

  const wl = opts.watchlistStatus;
  const pulse = opts.pulseDesk;
  const watchlistLines: string[] = [];
  if (wl && wl.monitored > 0) {
    watchlistLines.push(`${wl.monitored} symbol${wl.monitored === 1 ? "" : "s"} tracked`);
    const nearTracked = pulse?.nearReady ?? 0;
    watchlistLines.push(
      nearTracked > 0
        ? `${nearTracked} near-ready (tracked)`
        : "0 near-ready (tracked)"
    );
    const dev = pulse?.developing ?? wl.developing;
    if (dev > 0) watchlistLines.push(`${dev} developing`);
  } else {
    watchlistLines.push("No default watchlist symbols");
    watchlistLines.push("Add symbols to track maturation");
  }

  const signalsLines =
    ready > 0
      ? [`${ready} setup${ready === 1 ? "" : "s"} cleared gates this load`]
      : ["No completed trades today"];

  const scannerHref = opts.mode === "swing" ? "/dashboard/scanner?mode=swing" : "/dashboard/scanner?mode=day";

  return [
    {
      id: "scanner",
      title: "Scanner (live discovery)",
      lines: scannerLines,
      ctaLabel: "View Scanner →",
      ctaHref: scannerHref,
      emphasize: true
    },
    {
      id: "watchlist",
      title: "Watchlist (your tracked symbols)",
      lines: watchlistLines,
      ctaLabel: "View Watchlist →",
      ctaHref: "/dashboard/watchlists"
    },
    {
      id: "signals",
      title: "Signals (execution)",
      lines: signalsLines,
      ctaLabel: "Review Signals →",
      ctaHref: "/dashboard/signals"
    }
  ];
}

export const OPPORTUNITIES_GUIDE_LINE =
  "Choose where to focus: Scanner = discovery · Watchlist = tracking";

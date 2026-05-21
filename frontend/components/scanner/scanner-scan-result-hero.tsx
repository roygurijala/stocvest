"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { ScannerDeskRails } from "@/components/scanner/ScannerDeskRails";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { WatchlistDashboardStatus } from "@/lib/api/scanner";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { buildWatchlistInsightSupplement } from "@/lib/scanner-progress-messaging";
import { buildScannerQuietSubline, buildWatchlistQuietInsight } from "@/lib/scanner-quiet-copy";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: ScannerScanSummary;
  synthesis?: ScannerSynthesis | null;
  isRefreshing?: boolean;
  onRefresh: () => void;
  hideWatchlistStrip?: boolean;
  marketScopeLine?: string | null;
  nextScanLabel?: string | null;
};

/** Unified Scanner header — same chrome for quiet and active scans. */
export function ScannerScanResultHero({
  summary,
  synthesis,
  isRefreshing,
  onRefresh,
  hideWatchlistStrip = false,
  marketScopeLine = null,
  nextScanLabel = null
}: Props) {
  const { colors } = useTheme();
  const wl = summary.watchlist;
  const quietSubline = buildScannerQuietSubline(summary, synthesis);
  const isQuiet = summary.qualifying.total === 0;
  const showDeskBreakdown = summary.qualifying.total > 0;

  const sessionLine = summary.session.regular_open
    ? "Session open"
    : `Closed · Next update: ${summary.session.next_evaluation_label}`;

  const watchlistQuiet = isQuiet && wl ? buildWatchlistQuietInsight(wl, summary.qualifying.total) : null;

  const headline = isQuiet ? (
    quietSubline
  ) : (
    <>
      {summary.qualifying.total} qualifying setup{summary.qualifying.total === 1 ? "" : "s"}
    </>
  );

  return (
    <section
      data-testid="scanner-scan-result-hero"
      className={surfaceGlowClassName}
      style={{
        display: "grid",
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2]
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 12rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Scanner
          </p>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            {sessionLine}
            <span aria-hidden> · </span>
            {summary.session.last_scan_label}
            {nextScanLabel ? (
              <>
                <span aria-hidden> · </span>
                <span data-testid="scanner-next-scan">Next scan {nextScanLabel}</span>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          data-testid="scanner-hero-refresh"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[2],
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: colors.surfaceMuted,
            color: colors.text,
            padding: `${spacing[1]} ${spacing[2]}`,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          <RefreshCw size={13} style={{ animation: isRefreshing ? "spin 1s linear infinite" : undefined }} />
          {isRefreshing ? "…" : "Refresh"}
        </button>
      </div>

      <div
        data-testid={isQuiet ? "scanner-quiet-ribbon" : "scanner-active-ribbon"}
        className="scanner-quiet-ribbon"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: spacing[3]
        }}
      >
        <div style={{ flex: "1 1 10rem", minWidth: 0 }}>
          <p
            data-testid={isQuiet ? "scanner-scan-quiet-subline" : "scanner-scan-qualifying-total"}
            style={{
              margin: 0,
              fontSize: typography.scale.lg,
              fontWeight: 600,
              color: colors.text,
              lineHeight: 1.25
            }}
          >
            {headline}
          </p>
          {!isQuiet ? (
            <p
              data-testid="scanner-scan-quiet-subline"
              style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted }}
            >
              {quietSubline}
            </p>
          ) : null}
        </div>
        <ScannerDeskRails summary={summary} />
      </div>

      {showDeskBreakdown ? (
        <p
          data-testid="scanner-scan-desk-breakdown"
          style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}
        >
          {summary.quiet.detail_line}
        </p>
      ) : null}

      {isQuiet && marketScopeLine ? (
        <p
          data-testid="scanner-market-scope-inline"
          style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.45 }}
        >
          {marketScopeLine}
        </p>
      ) : null}

      {watchlistQuiet ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.45 }}>
          <span style={{ color: colors.text }}>{watchlistQuiet.headline}</span>
          {" — "}
          {watchlistQuiet.subline}
          {" · "}
          <Link href="/dashboard/watchlists" style={{ color: colors.accent, fontWeight: 600, textDecoration: "none" }}>
            Watchlist
          </Link>
        </p>
      ) : null}

      {!isQuiet && wl && !hideWatchlistStrip ? (
        <WatchlistInsightRow colors={colors} wl={wl} qualifyingTotal={summary.qualifying.total} />
      ) : null}
    </section>
  );
}

function WatchlistInsightRow({
  colors,
  wl,
  qualifyingTotal
}: {
  colors: ThemeColors;
  wl: WatchlistDashboardStatus;
  qualifyingTotal: number;
}) {
  const supplement = buildWatchlistInsightSupplement(wl, qualifyingTotal);
  return (
    <div
      data-testid="scanner-watchlist-insight"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[2],
        padding: spacing[2],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
        <span style={{ fontWeight: 600, color: colors.text }}>Watchlist</span>
        {" · "}
        {wl.monitored} monitored · {wl.actionable} actionable · {wl.developing} developing
        {supplement ? ` · ${supplement}` : ""}
      </p>
      <Link
        href="/dashboard/watchlists"
        style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.accent, textDecoration: "none" }}
      >
        Open →
      </Link>
    </div>
  );
}

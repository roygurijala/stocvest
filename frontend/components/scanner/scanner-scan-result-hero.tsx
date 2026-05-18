"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { buildWatchlistInsightSupplement } from "@/lib/scanner-progress-messaging";
import { buildScannerQuietSubline } from "@/lib/scanner-quiet-copy";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: ScannerScanSummary;
  synthesis?: ScannerSynthesis | null;
  isRefreshing?: boolean;
  onRefresh: () => void;
};

export function ScannerScanResultHero({ summary, synthesis, isRefreshing, onRefresh }: Props) {
  const { colors } = useTheme();
  const wl = summary.watchlist;
  const quietSubline = buildScannerQuietSubline(summary, synthesis);
  const showDeskBreakdown = summary.qualifying.total > 0;

  const sessionLine = summary.session.regular_open
    ? "Regular session open"
    : `Market closed — next evaluation ${summary.session.next_evaluation_label}`;

  return (
    <section
      data-testid="scanner-scan-result-hero"
      className={surfaceGlowClassName}
      style={{
        display: "grid",
        gap: spacing[3],
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: spacing[2]
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Scan result
          </p>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            {sessionLine}
          </p>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            Last scan: {summary.session.last_scan_label}
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
            padding: `${spacing[2]} ${spacing[3]}`,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          <RefreshCw size={14} style={{ animation: isRefreshing ? "spin 1s linear infinite" : undefined }} />
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div>
        <p
          data-testid="scanner-scan-qualifying-total"
          style={{
            margin: 0,
            fontSize: typography.scale["2xl"],
            fontWeight: 700,
            color: colors.text,
            lineHeight: 1.15
          }}
        >
          {summary.qualifying.total} qualifying setup{summary.qualifying.total === 1 ? "" : "s"}
        </p>
        <p
          data-testid="scanner-scan-quiet-subline"
          style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted }}
        >
          {quietSubline}
        </p>
        {showDeskBreakdown ? (
          <p
            data-testid="scanner-scan-desk-breakdown"
            style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}
          >
            {summary.quiet.detail_line}
          </p>
        ) : null}
      </div>

      {wl ? (
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
  wl: NonNullable<ScannerScanSummary["watchlist"]>;
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
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.accent} 35%, ${colors.border})`,
        background: `color-mix(in srgb, ${colors.accent} 8%, ${colors.surface})`
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text }}>
          <span style={{ fontWeight: 600 }}>Watchlist</span>
          {" · "}
          {wl.monitored} monitored · {wl.actionable} actionable · {wl.developing} developing
        </p>
        {supplement ? (
          <p
            data-testid="scanner-watchlist-progress-note"
            style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}
          >
            {supplement}
          </p>
        ) : null}
      </div>
      <Link
        href="/dashboard/watchlists"
        style={{
          fontSize: typography.scale.sm,
          fontWeight: 600,
          color: colors.accent,
          textDecoration: "none"
        }}
      >
        View watchlist →
      </Link>
    </div>
  );
}

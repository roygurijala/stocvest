"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { buildScannerNextActions } from "@/lib/scanner-scan-summary";
import { buildWatchlistInsightSupplement } from "@/lib/scanner-progress-messaging";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: ScannerScanSummary;
  isRefreshing?: boolean;
  onRefresh: () => void;
};

export function ScannerScanResultHero({ summary, isRefreshing, onRefresh }: Props) {
  const { colors } = useTheme();
  const actions = buildScannerNextActions(summary);
  const wl = summary.watchlist;
  const tape =
    summary.regime.spy_pct != null && summary.regime.qqq_pct != null
      ? `SPY ${summary.regime.spy_pct >= 0 ? "+" : ""}${summary.regime.spy_pct.toFixed(2)}% · QQQ ${summary.regime.qqq_pct >= 0 ? "+" : ""}${summary.regime.qqq_pct.toFixed(2)}%`
      : null;

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
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted }}>
          {summary.quiet.unified_headline}
        </p>
        <p
          data-testid="scanner-scan-desk-breakdown"
          style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}
        >
          {summary.quiet.detail_line}
          {summary.universe.symbols_evaluated != null
            ? ` · Universe ${summary.universe.symbols_evaluated}`
            : ""}
          {tape ? ` · ${tape}` : ""}
        </p>
      </div>

      {wl ? (
        <WatchlistInsightRow colors={colors} wl={wl} qualifyingTotal={summary.qualifying.total} />
      ) : null}

      {actions.length > 0 ? (
        <div data-testid="scanner-next-actions">
          <p
            style={{
              margin: `0 0 ${spacing[2]}`,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Next actions
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexWrap: "wrap",
              gap: spacing[2]
            }}
          >
            {actions.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.href}
                  data-testid={`scanner-next-action-${a.id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 36,
                    padding: `${spacing[1]} ${spacing[3]}`,
                    borderRadius: borderRadius.md,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceMuted,
                    color: colors.accent,
                    fontSize: typography.scale.sm,
                    fontWeight: 600,
                    textDecoration: "none"
                  }}
                >
                  → {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
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

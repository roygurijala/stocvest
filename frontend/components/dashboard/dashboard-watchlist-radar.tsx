"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SnapshotPayload } from "@/lib/api/market";
import { buildWatchlistRadarRows, type WatchlistRadarRow } from "@/lib/dashboard/watchlist-radar";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  snapshots: SnapshotPayload[];
};

function WatchlistRadarRowItem({ row, mode }: { row: WatchlistRadarRow; mode: DashboardDeskMode }) {
  const { colors } = useTheme();
  const href = `/dashboard/signals?symbol=${encodeURIComponent(row.symbol)}&trading_mode=${mode}&ref=dashboard`;
  const hover = useHoverPrefetch(href);
  const pctColor =
    row.quote?.bullish === true
      ? colors.bullish
      : row.quote?.bullish === false
        ? colors.bearish
        : colors.textMuted;

  return (
    <li
      data-testid={`dashboard-watchlist-radar-${row.symbol}`}
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        borderLeft: row.borderLeft,
        padding: spacing[3],
        background: colors.surfaceMuted
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <strong>{row.symbol}</strong>
          {row.quote?.price ? (
            <span style={{ marginLeft: spacing[2], color: colors.textMuted, fontSize: typography.scale.sm }}>
              {row.quote.price}
              {row.quote.pct ? (
                <span style={{ color: pctColor, marginLeft: 4 }}>{row.quote.pct}</span>
              ) : null}
            </span>
          ) : null}
          <p className="m-0 mt-1" style={{ fontSize: typography.scale.sm, color: colors.text }}>
            {row.attentionReason}
          </p>
          <p className="m-0 mt-0.5" style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {row.alignmentLine}
          </p>
        </div>
        <Link
          href={href}
          prefetch={false}
          {...interactionLevelProps("deep")}
          {...hover}
          style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.accent }}
        >
          Signals →
        </Link>
      </div>
    </li>
  );
}

export function DashboardWatchlistRadar({ mode, snapshots }: Props) {
  const { colors } = useTheme();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [bySymbol, setBySymbol] = useState<Record<string, WatchlistMaturationRow>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const [wlRes, matRes] = await Promise.all([
          fetch("/api/stocvest/watchlists/default/symbols", { cache: "no-store" }),
          fetch(`/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`, {
            cache: "no-store"
          })
        ]);
        if (cancelled) return;
        const wlJson = wlRes.ok ? await wlRes.json().catch(() => ({})) : {};
        const matJson = matRes.ok ? await matRes.json().catch(() => ({})) : {};
        const symList = Array.isArray((wlJson as { symbols?: unknown }).symbols)
          ? ((wlJson as { symbols: string[] }).symbols || [])
              .map((s) => String(s).trim().toUpperCase())
              .filter(Boolean)
          : [];
        const env = parseMaturationSummaryEnvelope(matJson);
        if (!cancelled) {
          setSymbols(symList);
          setBySymbol(env.bySymbol);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const snapBySym = useMemo(
    () => new Map(snapshots.map((s) => [(s.symbol || "").trim().toUpperCase(), s] as const)),
    [snapshots]
  );

  const rows = useMemo(
    () =>
      buildWatchlistRadarRows({
        symbols,
        rowForSymbol: (sym) => bySymbol[sym],
        snapshotForSymbol: (sym) => snapBySym.get(sym),
        colors,
        mode
      }),
    [symbols, bySymbol, snapBySym, colors, mode]
  );

  const watchlistHref = `/dashboard/watchlists?desk=${encodeURIComponent(mode)}`;
  const watchlistHover = useHoverPrefetch(watchlistHref);

  return (
    <section
      role="region"
      aria-label="Watchlist attention"
      data-testid="dashboard-watchlist-radar"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
            Your watchlist
          </h2>
          <p className="m-0 mt-1" style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
            {status === "loading"
              ? "Loading tracked symbols…"
              : rows.length === 0
                ? "Nothing on your list needs attention right now."
                : `${rows.length} symbol${rows.length === 1 ? "" : "s"} need a look`}
          </p>
        </div>
        <Link
          href={watchlistHref}
          prefetch={false}
          data-hover-prefetch="true"
          {...interactionLevelProps("deep")}
          {...watchlistHover}
          data-testid="dashboard-watchlist-radar-link"
          style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.accent }}
        >
          Watchlists →
        </Link>
      </div>

      {rows.length > 0 ? (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0" data-testid="dashboard-watchlist-radar-list">
          {rows.map((row) => (
            <WatchlistRadarRowItem key={row.symbol} row={row} mode={mode} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

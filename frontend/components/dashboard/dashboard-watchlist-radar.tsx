"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SnapshotPayload } from "@/lib/api/market";
import { WatchlistRadarCard } from "@/components/dashboard/watchlist-radar-card";
import { buildWatchlistRadarRows } from "@/lib/dashboard/watchlist-radar";
import {
  buildWatchlistRadarCardModel,
  WATCHLIST_RADAR_DISCLAIMER,
  WATCHLIST_RADAR_TITLE
} from "@/lib/dashboard/watchlist-radar-card-present";
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

  const cardModels = useMemo(
    () =>
      rows.map((row) =>
        buildWatchlistRadarCardModel(row, {
          surface: colors.surface,
          border: colors.border,
          accent: colors.accent,
          bullish: colors.bullish,
          bearish: colors.bearish,
          caution: colors.caution,
          textMuted: colors.textMuted
        })
      ),
    [rows, colors.accent, colors.bullish, colors.bearish, colors.caution, colors.textMuted]
  );

  const watchlistHref = `/dashboard/watchlists?desk=${encodeURIComponent(mode)}`;
  const watchlistHover = useHoverPrefetch(watchlistHref);

  return (
    <section
      role="region"
      aria-label="Watchlist radar"
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
        <div className="min-w-0 flex-1">
          <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
            {WATCHLIST_RADAR_TITLE}
          </h2>
          <p className="m-0 mt-1" style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
            {status === "loading"
              ? "Loading tracked symbols…"
              : cardModels.length === 0
                ? "Nothing on your list needs attention right now."
                : `${cardModels.length} symbol${cardModels.length === 1 ? "" : "s"} need a look`}
          </p>
          <p
            className="m-0 mt-2"
            data-testid="dashboard-watchlist-radar-disclaimer"
            style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45, maxWidth: "52rem" }}
          >
            {WATCHLIST_RADAR_DISCLAIMER}
          </p>
        </div>
        <Link
          href={watchlistHref}
          prefetch={false}
          data-hover-prefetch="true"
          {...interactionLevelProps("deep")}
          {...watchlistHover}
          data-testid="dashboard-watchlist-radar-link"
          style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.accent, whiteSpace: "nowrap" }}
        >
          Full watchlist →
        </Link>
      </div>

      {cardModels.length > 0 ? (
        <ul
          className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="dashboard-watchlist-radar-list"
        >
          {cardModels.map((model) => (
            <WatchlistRadarCard key={model.symbol} model={model} mode={mode} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

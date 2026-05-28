"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SnapshotPayload } from "@/lib/api/market";
import { WatchlistRadarCard } from "@/components/dashboard/watchlist-radar-card";
import { buildWatchlistRadarRows, type WatchlistRadarDeskContext } from "@/lib/dashboard/watchlist-radar";
import {
  buildWatchlistRadarCardModel,
  WATCHLIST_RADAR_SUBTITLE,
  WATCHLIST_RADAR_TITLE
} from "@/lib/dashboard/watchlist-radar-card-present";
import { summarizeWatchlistDailyChanges } from "@/lib/dashboard/watchlist-daily-changes";
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
  desk: WatchlistRadarDeskContext;
  variant?: "standalone" | "pipeline";
  onAttentionCountChange?: (count: number) => void;
};

export function DashboardWatchlistRadar({
  mode,
  snapshots,
  desk,
  variant = "standalone",
  onAttentionCountChange
}: Props) {
  const { colors } = useTheme();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [bySymbol, setBySymbol] = useState<Record<string, WatchlistMaturationRow>>({});
  const [fetchedSnapshots, setFetchedSnapshots] = useState<Map<string, SnapshotPayload>>(new Map());
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

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    const chunk = symbols.slice(0, 40);
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
        const rows = Array.isArray(json.snapshots) ? json.snapshots : [];
        if (cancelled) return;
        const next = new Map<string, SnapshotPayload>();
        for (const row of rows) {
          const sym = (row.symbol || "").trim().toUpperCase();
          if (sym) next.set(sym, row);
        }
        setFetchedSnapshots(next);
      } catch {
        /* best-effort — cards fall back to neutral chrome */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbols]);

  const snapBySym = useMemo(() => {
    const merged = new Map(snapshots.map((s) => [(s.symbol || "").trim().toUpperCase(), s] as const));
    for (const [sym, snap] of fetchedSnapshots) {
      merged.set(sym, snap);
    }
    return merged;
  }, [snapshots, fetchedSnapshots]);

  const rows = useMemo(
    () =>
      buildWatchlistRadarRows({
        symbols,
        rowForSymbol: (sym) => bySymbol[sym],
        snapshotForSymbol: (sym) => snapBySym.get(sym),
        colors,
        mode,
        desk
      }),
    [symbols, bySymbol, snapBySym, colors, mode, desk]
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
    [rows, colors.surface, colors.border, colors.accent, colors.bullish, colors.bearish, colors.caution, colors.textMuted]
  );

  const watchlistHref = `/dashboard/watchlists?desk=${encodeURIComponent(mode)}`;
  const watchlistHover = useHoverPrefetch(watchlistHref);
  const dailyChanges = useMemo(() => summarizeWatchlistDailyChanges(bySymbol), [bySymbol]);
  const embedded = variant === "pipeline";

  useEffect(() => {
    onAttentionCountChange?.(cardModels.length);
  }, [cardModels.length, onAttentionCountChange]);

  const shellStyle = embedded
    ? { padding: 0, border: "none", background: "transparent", borderRadius: 0 }
    : {
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      };

  return (
    <section
      role="region"
      aria-label="Watchlist radar"
      data-testid="dashboard-watchlist-radar"
      className={embedded ? undefined : surfaceGlowClassName}
      style={shellStyle}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {!embedded ? (
            <>
              <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
                {WATCHLIST_RADAR_TITLE}
              </h2>
              <p className="m-0 mt-1" style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
                {status === "loading"
                  ? "Loading tracked symbols…"
                  : cardModels.length === 0
                    ? WATCHLIST_RADAR_SUBTITLE
                    : `${cardModels.length} symbol${cardModels.length === 1 ? "" : "s"} need a look`}
              </p>
            </>
          ) : status === "loading" ? (
            <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
              Loading…
            </p>
          ) : null}
          {dailyChanges ? (
            <p
              className={`m-0 ${embedded ? "" : "mt-2"}`}
              data-testid="dashboard-watchlist-daily-changes"
              style={{ fontSize: typography.scale.xs, color: colors.accent, lineHeight: 1.45 }}
            >
              What changed: {dailyChanges}
            </p>
          ) : null}
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

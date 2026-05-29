"use client";

import Link from "next/link";
import { hotInMarketSignalsHref } from "@/lib/dashboard/hot-in-market-card-present";
import { useEffect, useMemo, useState } from "react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";
import { useTheme } from "@/lib/theme-provider";

type FetchStatus = "idle" | "loading" | "ready" | "error";

type Props = {
  mode: DashboardDeskMode;
};

export function NearReadyEngagementStrip({ mode }: Props) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [nearReadySymbols, setNearReadySymbols] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (!res.ok) {
          setNearReadySymbols([]);
          setStatus("error");
          return;
        }
        const json = await res.json().catch(() => ({}));
        const env = parseMaturationSummaryEnvelope(json);
        if (!cancelled) {
          setNearReadySymbols(env.nearReadySymbols);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setNearReadySymbols([]);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const deskLabel = mode === "swing" ? "Swing" : "Day";
  const watchlistHref = useMemo(
    () => `/dashboard/watchlists?near_ready=1&desk=${encodeURIComponent(mode)}`,
    [mode]
  );
  const watchlistPrefetch = useHoverPrefetch(watchlistHref);

  if (status === "idle" || status === "loading") return null;
  if (status === "error" || nearReadySymbols.length === 0) return null;

  const preview = nearReadySymbols.slice(0, 5);
  const more = nearReadySymbols.length - preview.length;

  return (
    <section
      role="region"
      aria-label="Near-ready watchlist"
      data-testid="dashboard-near-ready-engagement"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.caution} 40%, ${colors.border})`,
        background: `color-mix(in srgb, ${colors.caution} 10%, ${colors.surface})`,
        padding: spacing[4],
        display: "grid",
        gap: spacing[2]
      }}
    >
      <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
        {nearReadySymbols.length} near-ready on your {deskLabel} watchlist
      </p>
      <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
        Four of six layers aligned — one layer from the actionable gate. Review alignment before the desk moves.
      </p>
      <p
        data-testid="dashboard-near-ready-symbols"
        style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text }}
      >
        {preview.map((sym, i) => (
          <span key={sym}>
            {i > 0 ? " · " : null}
            <Link
              href={hotInMarketSignalsHref(sym, mode)}
              style={{ color: colors.accent, fontWeight: 600, textDecoration: "none" }}
            >
              {sym}
            </Link>
          </span>
        ))}
        {more > 0 ? (
          <span style={{ color: colors.textMuted }}>
            {" "}
            · +{more} more
          </span>
        ) : null}
      </p>
      <Link
        href={watchlistHref}
        prefetch={false}
        data-hover-prefetch="true"
        {...interactionLevelProps("medium")}
        onMouseEnter={watchlistPrefetch.onMouseEnter}
        onFocus={watchlistPrefetch.onFocus}
        onPointerDown={watchlistPrefetch.onPointerDown}
        className="inline-flex min-h-10 items-center text-sm font-semibold"
        style={{ color: colors.accent }}
      >
        Open watchlist near-ready →
      </Link>
    </section>
  );
}

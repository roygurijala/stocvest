"use client";

import Link from "next/link";
import { hotInMarketSignalsHref } from "@/lib/dashboard/hot-in-market-card-present";
import { useEffect, useMemo, useState } from "react";
import {
  buildDailyPulseRollup,
  dailyPulseHasContent,
  formatDailyPulseDeskHeadline,
  formatDailyPulseTierCounts,
  type DailyPulseDeskSummary,
  type DailyPulseRollup
} from "@/lib/dashboard-daily-pulse";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { roleAccents } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { dailyPulseFrequencyFootnote } from "@/lib/maturation-expected-frequency";
import { normalizeWatchlistMaturationBySymbol } from "@/lib/watchlist-page-utils";
import { useTheme } from "@/lib/theme-provider";

type FetchStatus = "idle" | "loading" | "ready" | "error";

type Props = {
  dayTradingSurfaces: boolean;
};

export function DashboardDailyPulse({ dayTradingSurfaces }: Props) {
  const { colors, theme } = useTheme();
  const watchlistPrefetch = useHoverPrefetch("/dashboard/watchlists");
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [rollup, setRollup] = useState<DailyPulseRollup>({ swing: null, day: null });

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const fetches = dayTradingSurfaces
          ? [
              fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", { cache: "no-store" }),
              fetch("/api/stocvest/watchlists/maturation-summary?mode=day", { cache: "no-store" })
            ]
          : [fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", { cache: "no-store" })];
        const results = await Promise.all(fetches);
        if (cancelled) return;
        if (!results[0]?.ok) {
          setRollup({ swing: null, day: null });
          setStatus("error");
          return;
        }
        const swingJson = await results[0].json().catch(() => ({}));
        const dayJson = results[1] ? await results[1].json().catch(() => ({})) : {};
        const next = buildDailyPulseRollup({
          swingBySymbol: normalizeWatchlistMaturationBySymbol(swingJson),
          dayBySymbol: dayTradingSurfaces ? normalizeWatchlistMaturationBySymbol(dayJson) : {},
          includeDayDesk: dayTradingSurfaces
        });
        if (!cancelled) {
          setRollup(next);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setRollup({ swing: null, day: null });
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayTradingSurfaces]);

  const show = useMemo(() => dailyPulseHasContent(rollup), [rollup]);
  if (status === "idle" || (status === "ready" && !show)) return null;

  return (
    <section
      role="region"
      aria-label="Daily pulse"
      data-testid="dashboard-daily-pulse"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.accent} 28%, ${colors.border})`,
        background: `color-mix(in srgb, ${colors.accent} 6%, ${colors.surface})`,
        padding: spacing[3],
        display: "grid",
        gap: spacing[3]
      }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p
            style={{
              margin: 0,
              fontSize: typography.scale.xs,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Daily pulse
          </p>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
            Default watchlist maturation by desk — display tiers only, gates unchanged.
          </p>
          <p
            data-testid="dashboard-daily-pulse-frequency-note"
            style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}
          >
            {dayTradingSurfaces
              ? "Swing and day desks use separate maturation rows. "
              : "Swing desk maturation shown. "}
            {dailyPulseFrequencyFootnote("swing")}
          </p>
        </div>
        <Link
          href="/dashboard/watchlists"
          prefetch={false}
          data-hover-prefetch="true"
          {...interactionLevelProps("deep")}
          onMouseEnter={watchlistPrefetch.onMouseEnter}
          onFocus={watchlistPrefetch.onFocus}
          onPointerDown={watchlistPrefetch.onPointerDown}
          className="inline-flex min-h-10 items-center text-sm font-semibold"
          style={{ color: colors.accent }}
        >
          Watchlist →
        </Link>
      </header>

      {status === "loading" ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>Loading maturation…</p>
      ) : null}

      {status === "error" ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution }}>
          Maturation summary unavailable — open Watchlist for per-symbol detail.
        </p>
      ) : null}

      {status === "ready" && show ? (
        <div style={{ display: "grid", gap: spacing[3] }}>
          {rollup.swing ? (
            <DeskPulseBlock summary={rollup.swing} colors={colors} theme={theme} />
          ) : null}
          {rollup.day ? <DeskPulseBlock summary={rollup.day} colors={colors} theme={theme} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function DeskPulseBlock({
  summary,
  colors,
  theme
}: {
  summary: DailyPulseDeskSummary;
  colors: ReturnType<typeof useTheme>["colors"];
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const accent = roleAccents[theme][summary.desk === "swing" ? "swing" : "day"];
  const deskLabel = summary.desk === "swing" ? "Swing" : "Day";

  return (
    <div
      data-testid={`dashboard-daily-pulse-${summary.desk}`}
      style={{
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid color-mix(in srgb, ${accent.borderAccent} 35%, ${colors.border})`,
        background: colors.surface
      }}
    >
      <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
        <span style={{ color: accent.borderAccent }}>{deskLabel}</span>
        {" · "}
        {formatDailyPulseDeskHeadline(summary)}
      </p>
      <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
        {summary.tracked} tracked · {formatDailyPulseTierCounts(summary)}
      </p>

      <p
        className="m-0 mt-2 text-[11px] leading-relaxed"
        style={{ color: colors.textMuted }}
        data-testid={`dashboard-daily-pulse-frequency-${summary.desk}`}
      >
        {dailyPulseFrequencyFootnote(summary.desk)}
      </p>

      {summary.closest.length > 0 ? (
        <ul
          data-testid={`dashboard-daily-pulse-closest-${summary.desk}`}
          style={{ margin: `${spacing[2]} 0 0`, padding: 0, listStyle: "none", display: "grid", gap: spacing[1] }}
        >
          {summary.closest.map((row) => (
            <li key={`${row.desk}-${row.symbol}`}>
              <Link
                href={hotInMarketSignalsHref(row.symbol, row.desk)}
                style={{
                  fontSize: typography.scale.sm,
                  color: colors.accent,
                  textDecoration: "none",
                  fontWeight: 600
                }}
              >
                {row.symbol}
              </Link>
              <span style={{ marginLeft: spacing[2], fontSize: typography.scale.xs, color: colors.textMuted }}>
                {row.label}
                {row.layersAway === 1 ? " · 1 layer from threshold" : ` · ${row.layersAway} layers from threshold`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { DashboardLayerDots } from "@/components/dashboard/dashboard-layer-dots";
import type { WatchlistRadarCardModel } from "@/lib/dashboard/watchlist-radar-card-present";
import { watchlistRadarSignalsHref } from "@/lib/dashboard/watchlist-radar-card-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  model: WatchlistRadarCardModel;
  mode: DashboardDeskMode;
};

function badgeStyle(
  tier: WatchlistRadarCardModel["attentionTier"],
  colors: ReturnType<typeof useTheme>["colors"]
): { background: string; color: string } {
  switch (tier) {
    case "check_now":
      return {
        background: `color-mix(in srgb, ${colors.bullish} 20%, transparent)`,
        color: colors.bullish
      };
    case "getting_close":
      return {
        background: `color-mix(in srgb, ${colors.accent} 16%, transparent)`,
        color: colors.accent
      };
    default:
      return {
        background: `color-mix(in srgb, ${colors.textMuted} 14%, transparent)`,
        color: colors.textMuted
      };
  }
}

export function WatchlistRadarCard({ model, mode }: Props) {
  const { colors } = useTheme();
  const href = watchlistRadarSignalsHref(model.symbol, mode);
  const hover = useHoverPrefetch(href);
  const chrome = model.cardChrome;
  const badge = badgeStyle(model.attentionTier, colors);

  return (
    <li className="list-none" data-testid={`dashboard-watchlist-radar-${model.symbol}`}>
      <Link
        href={href}
        prefetch={false}
        {...interactionLevelProps("deep")}
        {...hover}
        className="group block h-full no-underline"
        aria-label={`Open ${model.symbol} on Signals — ${model.badgeLabel}`}
        title={model.peek ? `Quick peek: ${model.peek}` : undefined}
      >
        <article
          className="relative flex h-full flex-col overflow-hidden rounded-xl transition hover:brightness-[1.04]"
          data-card-tone={model.cardTone}
          style={{
            background: chrome.background,
            border: `1px solid ${chrome.border}`,
            borderLeft: `3px solid ${chrome.borderLeft}`,
            borderBottom: `3px solid ${chrome.borderBottom}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3]
          }}
        >
          <header className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-base font-bold tracking-wide" style={{ color: colors.text }}>
                {model.symbol}
              </span>
              <span
                className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: colors.textMuted }}
              >
                Your list
              </span>
            </div>
            {model.quoteLine ? (
              <span
                className="shrink-0 text-sm font-semibold tabular-nums"
                style={{ color: chrome.accent }}
                data-testid={`watchlist-radar-quote-${model.symbol}`}
              >
                {model.quoteLine}
              </span>
            ) : null}
          </header>

          <p className="m-0 mt-2 text-sm font-medium leading-snug" style={{ color: colors.text }}>
            {model.attentionLine}
          </p>

          <div
            className="my-2 h-px w-full"
            style={{ background: `color-mix(in srgb, ${chrome.border} 80%, transparent)` }}
            aria-hidden
          />

          <div className="flex flex-wrap items-center gap-2">
            <DashboardLayerDots filled={model.layerDots} total={model.layerTotal} accent={chrome.accent} />
            <span className="text-xs" style={{ color: colors.textMuted }}>
              {model.alignmentLine}
            </span>
          </div>

          <footer className="mt-auto pt-2">
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={badge}
              data-testid={`watchlist-radar-badge-${model.symbol}`}
            >
              {model.badgeLabel}
            </span>
          </footer>
        </article>
      </Link>
    </li>
  );
}

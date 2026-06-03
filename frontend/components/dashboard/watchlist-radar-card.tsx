"use client";

import Link from "next/link";
import { DashboardLayerDots } from "@/components/dashboard/dashboard-layer-dots";
import { SymbolName } from "@/components/symbol-name";
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

export function WatchlistRadarCard({ model, mode }: Props) {
  const { colors } = useTheme();
  const href = watchlistRadarSignalsHref(model.symbol, mode);
  const hover = useHoverPrefetch(href);
  const quoteColor =
    model.quoteTone === "bullish"
      ? colors.bullish
      : model.quoteTone === "bearish"
        ? colors.bearish
        : colors.textMuted;

  return (
    <li className="list-none" data-testid={`dashboard-watchlist-radar-${model.symbol}`}>
      <Link
        href={href}
        prefetch={false}
        {...interactionLevelProps("deep")}
        {...hover}
        className="group block h-full no-underline"
        aria-label={`Open ${model.symbol} on Signals — ${model.chromeBadgeLabel}`}
        title={model.peek ? `Quick peek: ${model.peek}` : undefined}
      >
        <article
          className="relative flex h-full flex-col overflow-hidden rounded-xl transition hover:brightness-[1.04]"
          data-card-tone={model.cardTone}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${model.borderLeft}`,
            borderBottom: `3px solid ${model.borderBottom}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3]
          }}
        >
          <header className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <SymbolName
                  symbol={model.symbol}
                  layout="stacked"
                  className="text-base font-bold tracking-wide"
                  symbolStyle={{ color: colors.text, fontWeight: "inherit" }}
                  nameStyle={{ fontWeight: 400 }}
                  maxNameChars={26}
                />
                {model.directionChip ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
                    style={{
                      color: model.directionChip.color,
                      background: model.directionChip.background
                    }}
                    data-testid={`watchlist-radar-direction-${model.symbol}`}
                  >
                    {model.directionChip.label}
                  </span>
                ) : null}
              </div>
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
                style={{ color: quoteColor }}
                data-testid={`watchlist-radar-quote-${model.symbol}`}
              >
                {model.quoteLine}
              </span>
            ) : null}
          </header>

          <p className="m-0 mt-2 text-sm font-medium leading-snug" style={{ color: colors.text }}>
            {model.attentionLine}
          </p>

          {model.statusBanner ? (
            <p
              className="m-0 mt-1.5 text-xs font-medium leading-snug"
              style={{ color: colors.bearish }}
              data-testid={`watchlist-radar-status-banner-${model.symbol}`}
            >
              {model.statusBanner}
            </p>
          ) : null}

          <div
            className="my-2 h-px w-full"
            style={{ background: `color-mix(in srgb, ${colors.border} 80%, transparent)` }}
            aria-hidden
          />

          <div className="flex flex-wrap items-center gap-2">
            <DashboardLayerDots filled={model.layerDots} total={model.layerTotal} accent={model.dotAccent} />
            <span className="text-xs" style={{ color: colors.textMuted }}>
              {model.alignmentLine}
            </span>
          </div>

          <footer className="mt-auto pt-2">
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                color: model.chromeBadgeColor,
                background: model.chromeBadgeBackground
              }}
              data-testid={`watchlist-radar-badge-${model.symbol}`}
            >
              {model.chromeBadgeLabel}
            </span>
          </footer>
        </article>
      </Link>
    </li>
  );
}

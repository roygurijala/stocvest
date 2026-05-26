"use client";

import Link from "next/link";
import { DashboardLayerDots } from "@/components/dashboard/dashboard-layer-dots";
import type { HotInMarketCardModel } from "@/lib/dashboard/hot-in-market-card-present";
import { hotInMarketSignalsHref } from "@/lib/dashboard/hot-in-market-card-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  model: HotInMarketCardModel;
  mode: DashboardDeskMode;
};

function badgeStyle(
  badge: HotInMarketCardModel["setupBadge"],
  colors: ReturnType<typeof useTheme>["colors"]
): { background: string; color: string } {
  switch (badge) {
    case "actionable":
      return {
        background: `color-mix(in srgb, ${colors.bullish} 20%, transparent)`,
        color: colors.bullish
      };
    case "blocked":
      return {
        background: `color-mix(in srgb, ${colors.caution} 18%, transparent)`,
        color: colors.caution
      };
    case "weak":
      return {
        background: `color-mix(in srgb, ${colors.bearish} 16%, transparent)`,
        color: colors.bearish
      };
    case "review":
      return {
        background: `color-mix(in srgb, ${colors.accent} 16%, transparent)`,
        color: colors.accent
      };
    case "pending":
      return {
        background: `color-mix(in srgb, ${colors.caution} 14%, transparent)`,
        color: colors.caution
      };
    default:
      return {
        background: `color-mix(in srgb, ${colors.textMuted} 14%, transparent)`,
        color: colors.textMuted
      };
  }
}

export function HotInMarketCard({ model, mode }: Props) {
  const { colors } = useTheme();
  const href = hotInMarketSignalsHref(model.symbol, mode);
  const hover = useHoverPrefetch(href);
  const chrome = model.cardChrome;
  const gapColor = chrome.accent;
  const badge = model.setupBadgeLabel ? badgeStyle(model.setupBadge, colors) : null;

  return (
    <li className="list-none" data-testid={`dashboard-hot-in-market-card-${model.symbol}`}>
      <Link
        href={href}
        prefetch={false}
        {...interactionLevelProps("deep")}
        {...hover}
        className="group block h-full no-underline"
        aria-label={`Open ${model.symbol} on Signals${
          model.setupBadgeLabel ? ` — ${model.setupBadgeLabel}` : ""
        }`}
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
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-base font-bold tracking-wide" style={{ color: colors.text }}>
                  {model.symbol}
                </span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                  style={{
                    background: `color-mix(in srgb, ${chrome.accent} 18%, transparent)`,
                    color: chrome.accent
                  }}
                >
                  #{model.rank}
                </span>
              </div>
              <span
                className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: colors.textMuted }}
              >
                {model.deskLabel}
              </span>
            </div>
            {model.priceLine ? (
              <span className="shrink-0 text-sm tabular-nums" style={{ color: colors.text }}>
                {model.priceLine}
              </span>
            ) : null}
          </header>

          <p
            className="m-0 mt-2 text-lg font-bold tabular-nums leading-none"
            style={{ color: gapColor }}
            data-testid={`hot-in-market-gap-${model.symbol}`}
          >
            {model.gapLine}
          </p>

          <div
            className="my-2 h-px w-full"
            style={{ background: `color-mix(in srgb, ${chrome.border} 80%, transparent)` }}
            aria-hidden
          />

          {model.alignmentLine ? (
            <div className="flex flex-wrap items-center gap-2">
              <DashboardLayerDots filled={model.layerDots} total={model.layerTotal} accent={chrome.accent} />
              <span className="text-xs" style={{ color: colors.textMuted }}>
                {model.alignmentLine}
              </span>
            </div>
          ) : model.detailLine ? (
            <p className="m-0 text-xs leading-snug" style={{ color: colors.textMuted }}>
              {model.detailLine}
            </p>
          ) : null}

          {model.verdictLine ? (
            <p className="m-0 mt-1.5 line-clamp-2 text-xs leading-snug" style={{ color: colors.text }}>
              {model.verdictLine}
            </p>
          ) : null}

          {badge && model.setupBadgeLabel ? (
            <footer className="mt-auto pt-2">
              <span
                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={badge}
                data-testid={`hot-in-market-badge-${model.symbol}`}
              >
                {model.setupBadgeLabel}
              </span>
            </footer>
          ) : (
            <div className="mt-auto pt-2" aria-hidden />
          )}
        </article>
      </Link>
    </li>
  );
}

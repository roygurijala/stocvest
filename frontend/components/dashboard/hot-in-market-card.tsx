"use client";

import Link from "next/link";
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

function LayerDots({
  filled,
  total,
  accent
}: {
  filled: boolean[];
  total: number;
  accent: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {filled.map((on, i) => (
        <span
          key={i}
          className="text-xs leading-none"
          style={{ color: on ? accent : "color-mix(in srgb, currentColor 35%, transparent)" }}
        >
          {on ? "●" : "○"}
        </span>
      ))}
      <span className="ml-1 text-[10px] font-medium opacity-80">
        ({filled.filter(Boolean).length}/{total})
      </span>
    </span>
  );
}

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
  }
  return {
    background: `color-mix(in srgb, ${colors.accent} 12%, transparent)`,
    color: colors.textMuted
  };
}

export function HotInMarketCard({ model, mode }: Props) {
  const { colors } = useTheme();
  const href = hotInMarketSignalsHref(model.symbol, mode);
  const hover = useHoverPrefetch(href);
  const gapColor =
    model.gapTone === "bullish"
      ? colors.bullish
      : model.gapTone === "bearish"
        ? colors.bearish
        : colors.textMuted;
  const badge = badgeStyle(model.setupBadge, colors);

  return (
    <li className="list-none" data-testid={`dashboard-hot-in-market-card-${model.symbol}`}>
      <Link
        href={href}
        prefetch={false}
        {...interactionLevelProps("deep")}
        {...hover}
        className="group block h-full no-underline"
        aria-label={`Open ${model.symbol} on Signals — ${model.setupBadgeLabel}`}
        title={model.peek ? `Quick peek: ${model.peek}` : undefined}
      >
        <article
          className="relative flex h-full flex-col overflow-hidden rounded-xl transition hover:brightness-[1.04]"
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
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-base font-bold tracking-wide" style={{ color: colors.text }}>
                  {model.symbol}
                </span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                  style={{
                    background: colors.surfaceMuted,
                    color: colors.textMuted
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
            style={{ background: `color-mix(in srgb, ${colors.border} 80%, transparent)` }}
            aria-hidden
          />

          {model.alignmentLine ? (
            <div className="flex flex-wrap items-center gap-2">
              <LayerDots filled={model.layerDots} total={model.layerTotal} accent={colors.accent} />
            </div>
          ) : null}

          {model.verdictLine ? (
            <p className="m-0 mt-1.5 line-clamp-2 text-xs leading-snug" style={{ color: colors.text }}>
              {model.verdictLine}
            </p>
          ) : null}

          <footer className="mt-auto pt-2">
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={badge}
              data-testid={`hot-in-market-badge-${model.symbol}`}
            >
              {model.setupBadgeLabel}
            </span>
          </footer>
        </article>
      </Link>
    </li>
  );
}

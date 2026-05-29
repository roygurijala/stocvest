"use client";

import Link from "next/link";
import { DashboardLayerDots } from "@/components/dashboard/dashboard-layer-dots";
import type { OpportunityRowModel } from "@/lib/dashboard/opportunity-row-present";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  model: OpportunityRowModel;
  /** When true, session % is de-emphasized (post-close / context-only). */
  demoteGap?: boolean;
};

function gapColor(tone: OpportunityRowModel["gapTone"], colors: ReturnType<typeof useTheme>["colors"], demote: boolean) {
  if (demote) return colors.textMuted;
  if (tone === "bullish") return colors.bullish;
  if (tone === "bearish") return colors.bearish;
  return colors.textMuted;
}

function badgeStyle(colors: ReturnType<typeof useTheme>["colors"]) {
  return {
    background: `color-mix(in srgb, ${colors.caution} 14%, transparent)`,
    color: colors.caution
  };
}

export function DashboardOpportunityRow({ model, demoteGap = false }: Props) {
  const { colors } = useTheme();
  const hover = useHoverPrefetch(model.href);
  const filled = model.layerDots.filter(Boolean).length;
  const accent = colors.accent;

  return (
    <li className="list-none" data-testid={`dashboard-opportunity-row-${model.symbol}`}>
      <Link
        href={model.href}
        prefetch={false}
        {...interactionLevelProps("deep")}
        {...hover}
        className="group block no-underline"
        aria-label={`Open ${model.symbol} on Signals`}
        title={model.peek ? `Quick peek: ${model.peek}` : undefined}
      >
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 transition hover:brightness-[1.03]"
          style={{
            border: `1px solid ${colors.border}`,
            background: `color-mix(in srgb, ${colors.surfaceMuted} 88%, transparent)`
          }}
        >
          <span
            className="min-w-[3.25rem] text-sm font-bold tracking-wide"
            style={{ color: colors.text }}
          >
            {model.symbol}
          </span>

          {filled > 0 ? (
            <DashboardLayerDots filled={model.layerDots} total={model.layerTotal} accent={accent} />
          ) : null}

          {model.sourceLabel ? (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: `color-mix(in srgb, ${colors.accent} 12%, transparent)`,
                color: colors.textMuted
              }}
            >
              {model.sourceLabel}
            </span>
          ) : null}

          <span
            className="min-w-0 flex-1 text-sm leading-snug"
            style={{ color: colors.text }}
            data-testid={`opportunity-row-primary-${model.symbol}`}
          >
            {model.primaryLine}
          </span>

          {model.rrLine ? (
            <span
              className="shrink-0 text-xs font-semibold tabular-nums"
              style={{ color: colors.textMuted }}
              data-testid={`opportunity-row-rr-${model.symbol}`}
            >
              {model.rrLine}
            </span>
          ) : null}

          {model.detailLine ? (
            <span className="shrink-0 text-xs" style={{ color: colors.accent }}>
              {model.detailLine}
            </span>
          ) : null}

          {model.badgeLabel ? (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={badgeStyle(colors)}
              data-testid={`opportunity-row-badge-${model.symbol}`}
            >
              {model.badgeLabel}
            </span>
          ) : null}

          {model.gapLine ? (
            <span
              className={`ml-auto shrink-0 tabular-nums ${demoteGap ? "text-xs font-medium" : "text-sm font-semibold"}`}
              style={{ color: gapColor(model.gapTone, colors, demoteGap) }}
              data-testid={`opportunity-row-gap-${model.symbol}`}
            >
              {demoteGap ? model.gapLine.replace(" today", "") : model.gapLine}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export function DashboardOpportunityRowList({
  rows,
  demoteGap = false,
  testId = "dashboard-opportunity-list"
}: {
  rows: OpportunityRowModel[];
  demoteGap?: boolean;
  testId?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="m-0 list-none space-y-1 p-0" data-testid={testId}>
      {rows.map((model) => (
        <DashboardOpportunityRow key={model.symbol} model={model} demoteGap={demoteGap} />
      ))}
    </ul>
  );
}

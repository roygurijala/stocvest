"use client";

import Link from "next/link";
import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import {
  buildMissedTodayCardModels,
  MISSED_TODAY_INTRO,
  MISSED_TODAY_TITLE
} from "@/lib/dashboard/missed-today-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  deskData: DeskTodayData | null | undefined;
  gapFallback?: GapIntelligenceItem[];
};

export function DashboardMissedTodayStrip({ mode, deskData, gapFallback = [] }: Props) {
  const { colors } = useTheme();
  const rows = Array.isArray(deskData?.recently_hot) ? deskData!.recently_hot! : [];
  const models = buildMissedTodayCardModels(rows, { mode, deskData, gapFallback, max: 5 });

  if (models.length === 0) return null;

  return (
    <div
      className="mt-3"
      data-testid="dashboard-missed-today"
      role="region"
      aria-label="Missed today educational"
      style={{
        borderRadius: borderRadius.md,
        border: `1px dashed color-mix(in srgb, ${colors.caution} 35%, ${colors.border})`,
        background: `color-mix(in srgb, ${colors.caution} 6%, ${colors.surface})`,
        padding: spacing[3]
      }}
    >
      <p
        className="m-0"
        style={{
          fontSize: typography.scale.xs,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: colors.caution
        }}
      >
        {MISSED_TODAY_TITLE}
      </p>
      <p className="m-0 mt-1" style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
        {MISSED_TODAY_INTRO}
      </p>

      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {models.map((model) => (
          <MissedTodayRow key={model.symbol} model={model} />
        ))}
      </ul>
    </div>
  );
}

function MissedTodayRow({
  model
}: {
  model: ReturnType<typeof buildMissedTodayCardModels>[number];
}) {
  const { colors } = useTheme();
  const hover = useHoverPrefetch(model.signalsHref);

  return (
    <li
      className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
      data-testid={`dashboard-missed-today-${model.symbol}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-bold" style={{ color: colors.text }}>
            {model.symbol}
          </span>
          {model.moveLine ? (
            <span className="text-xs tabular-nums" style={{ color: colors.textMuted }}>
              {model.moveLine}
            </span>
          ) : null}
        </div>
        <p className="m-0 mt-0.5 text-xs leading-snug" style={{ color: colors.text }}>
          {model.lessonLine}
        </p>
        {model.detailLine ? (
          <p className="m-0 mt-0.5 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
            {model.detailLine}
          </p>
        ) : null}
      </div>
      <Link
        href={model.signalsHref}
        prefetch={false}
        {...interactionLevelProps("deep")}
        {...hover}
        className="shrink-0 text-xs font-semibold"
        style={{ color: colors.accent }}
        data-testid={`dashboard-missed-today-link-${model.symbol}`}
      >
        Open Signals →
      </Link>
    </li>
  );
}

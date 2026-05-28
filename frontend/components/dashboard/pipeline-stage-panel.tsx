"use client";

import type { ReactNode } from "react";
import type { PipelineStageId } from "@/lib/dashboard/dashboard-opportunity-pipeline-present";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  stageId: PipelineStageId;
  stageNumber: number;
  label: string;
  hint: string;
  children: ReactNode;
  headerAside?: ReactNode;
};

const STAGE_ACCENT: Record<PipelineStageId, string> = {
  watchlist: "accent",
  quiet: "bullish",
  market: "caution"
};

export function PipelineStagePanel({
  stageId,
  stageNumber,
  label,
  hint,
  children,
  headerAside
}: Props) {
  const { colors } = useTheme();
  const accentKey = STAGE_ACCENT[stageId];
  const accent =
    accentKey === "bullish" ? colors.bullish : accentKey === "caution" ? colors.caution : colors.accent;

  return (
    <article
      data-testid={`pipeline-stage-panel-${stageId}`}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${accent} 28%, ${colors.border})`,
        borderLeft: `4px solid ${accent}`,
        background: `color-mix(in srgb, ${accent} 5%, ${colors.surface})`,
        padding: spacing[4]
      }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums uppercase tracking-wider"
              style={{
                background: `color-mix(in srgb, ${accent} 18%, transparent)`,
                color: accent
              }}
            >
              {stageNumber}
            </span>
            <h3 className="m-0 text-base font-bold tracking-tight" style={{ color: colors.text }}>
              {label}
            </h3>
          </div>
          <p className="m-0 mt-1 text-sm leading-snug" style={{ color: colors.textMuted }}>
            {hint}
          </p>
        </div>
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </header>
      <div className="mt-3">{children}</div>
    </article>
  );
}

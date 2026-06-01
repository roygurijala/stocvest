"use client";

import type { SetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import { formatLayerProgressDots } from "@/lib/signal-evidence/setup-judgment";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  judgment: SetupJudgment;
  /** When set, shown as authoritative execution read (decision state). */
  executionLabel?: string | null;
  executionTone?: "bullish" | "bearish" | "caution" | "muted";
};

function bandColor(band: SetupJudgment["tradeability"]["band"], colors: ReturnType<typeof useTheme>["colors"]) {
  if (band === "strong") return colors.bullish;
  if (band === "weak") return colors.bearish;
  return colors.caution;
}

export function SetupJudgmentSummary({ judgment, executionLabel, executionTone }: Props) {
  const { colors } = useTheme();
  const { process, setupPhase, tradeability, primaryBlocker, watchFor } = judgment;
  const dots = formatLayerProgressDots(process.layersAligned, process.layersTotal);

  return (
    <section
      data-testid="setup-judgment-summary"
      className="grid gap-3"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: `color-mix(in srgb, ${colors.surfaceMuted} 88%, ${colors.surface})`,
        padding: spacing[3]
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Setup progress
          </p>
          <p className="m-0 mt-1 text-lg font-semibold tabular-nums" style={{ color: colors.text }} data-testid="setup-judgment-process">
            {dots} {process.layersAligned}/{process.layersTotal}
          </p>
          <p className="m-0 mt-0.5 text-sm font-medium" style={{ color: colors.accent }}>
            {process.label}
          </p>
        </div>
        {setupPhase ? (
          <div>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
              Phase
            </p>
            <p className="m-0 mt-1 text-lg font-semibold" style={{ color: colors.text }} data-testid="setup-judgment-phase">
              {setupPhase.label}
            </p>
            <p className="m-0 mt-0.5 text-xs" style={{ color: colors.textMuted }}>
              Momentum stage — not a trade signal
            </p>
          </div>
        ) : null}
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Entry timing
          </p>
          <p
            className="m-0 mt-1 text-lg font-semibold"
            style={{ color: bandColor(tradeability.band, colors) }}
            data-testid="setup-judgment-tradeability"
          >
            {tradeability.label}
          </p>
          {executionLabel ? (
            <p
              className="m-0 mt-0.5 text-sm font-medium"
              style={{
                color:
                  executionTone === "bullish"
                    ? colors.bullish
                    : executionTone === "bearish"
                      ? colors.bearish
                      : executionTone === "caution"
                        ? colors.caution
                        : colors.textMuted
              }}
              data-testid="setup-judgment-execution"
            >
              Execution: {executionLabel}
            </p>
          ) : null}
        </div>
      </div>

      {primaryBlocker ? (
        <p className="m-0 text-sm leading-snug" style={{ color: colors.text }} data-testid="setup-judgment-blocker">
          <span style={{ color: colors.textMuted, fontWeight: 600 }}>What is blocking this trade: </span>
          {primaryBlocker}
        </p>
      ) : null}

      {watchFor ? (
        <p className="m-0 text-sm leading-snug" style={{ color: colors.textMuted }} data-testid="setup-judgment-watch-for">
          <span style={{ fontWeight: 600, color: colors.accent }}>What must change: </span>
          {watchFor}
        </p>
      ) : null}

      {tradeability.flags.length > 0 ? (
        <ul
          className="m-0 flex flex-wrap gap-1.5 p-0 list-none"
          data-testid="setup-judgment-flags"
          style={{ fontSize: typography.scale.xs }}
        >
          {tradeability.flags.map((f) => (
            <li
              key={f.id}
              style={{
                borderRadius: borderRadius.full,
                padding: "2px 8px",
                fontWeight: 600,
                background:
                  f.severity === "block" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
                color: f.severity === "block" ? colors.bearish : colors.caution,
                border: `1px solid ${f.severity === "block" ? "rgba(239,68,68,0.35)" : "rgba(245,158,11,0.35)"}`
              }}
            >
              {f.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

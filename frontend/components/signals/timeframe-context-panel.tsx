"use client";

import { InfoTip } from "@/components/info-tip";
import type { TimeframeContext } from "@/lib/signal-evidence/timeframe-context";
import { timeframeStrengthTone } from "@/lib/signal-evidence/timeframe-context";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const TIMEFRAME_TIP =
  "Weekly context uses the last five daily sessions on the symbol. The desk compares that weekly bias to the short-horizon technical read. A counter-trend label means intraday (day desk) or daily structure (swing desk) disagrees with the weekly window — informational only; it nudges composite scoring, not the Decision line by itself.";

type Props = {
  context: TimeframeContext;
  tradingMode: "swing" | "day";
  compact?: boolean;
};

export function TimeframeContextPanel({ context, tradingMode, compact = false }: Props) {
  const { colors } = useTheme();
  const tone = timeframeStrengthTone(context.alignment.strength);
  const accent =
    tone === "aligned" ? colors.bullish : tone === "caution" ? colors.caution : colors.textMuted;

  return (
    <article
      className={surfaceGlowClassName}
      data-testid="timeframe-context-panel"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: compact ? spacing[3] : spacing[4]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-base font-semibold" style={{ color: colors.text }}>
          Timeframe alignment
        </h3>
        <InfoTip text={TIMEFRAME_TIP} label="Timeframe alignment" maxWidth={340} />
        <span
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: colors.textMuted }}
        >
          {tradingMode === "day" ? "Day desk" : "Swing desk"}
        </span>
      </div>
      <p
        className="m-0 mt-2 text-sm font-medium leading-snug"
        style={{ color: accent }}
        data-testid="timeframe-alignment-label"
      >
        {context.alignment.label}
      </p>
      <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: colors.text }}>
        <span className="font-semibold">{context.shortHorizonLabel}</span> vs{" "}
        <span className="font-semibold">Weekly</span> ({context.weekly.weekly_bias}) —{" "}
        {context.weekly.weekly_note}
      </p>
      <p className="m-0 mt-2 text-xs" style={{ color: colors.textMuted }}>
        Weekly change {formatPct(context.weekly.weekly_change_pct)} · RSI {context.weekly.weekly_rsi.toFixed(0)}
        {context.alignment.composite_score_modifier !== 0
          ? ` · Composite nudge ${context.alignment.composite_score_modifier > 0 ? "+" : ""}${context.alignment.composite_score_modifier}`
          : ""}
      </p>
    </article>
  );
}

function formatPct(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

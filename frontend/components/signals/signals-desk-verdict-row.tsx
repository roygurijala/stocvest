"use client";

import type { SignalsDeskKpiItem } from "@/lib/signals-desk-kpi-present";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import type { SignalsDeskTab, SignalsKpiTarget } from "@/lib/signals-page-tabs";
import { deskTabHighlightsKpi } from "@/lib/signals-page-tabs";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  items: SignalsDeskKpiItem[];
  activeTab: SignalsDeskTab;
  biasProof: string | null;
  executionHint: string | null;
  decisionState: TradeDecisionState;
  onSelectTarget: (target: SignalsKpiTarget) => void;
};

function toneColor(
  tone: SignalsDeskKpiItem["headlineTone"],
  colors: ReturnType<typeof useTheme>["colors"]
): string {
  if (tone === "bullish") return colors.bullish;
  if (tone === "bearish") return colors.bearish;
  if (tone === "caution") return colors.caution;
  if (tone === "accent") return colors.accent;
  return colors.text;
}

function MetricChip({
  item,
  activeTab,
  detail,
  onSelect
}: {
  item: SignalsDeskKpiItem;
  activeTab: SignalsDeskTab;
  detail?: string | null;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  const highlighted = deskTabHighlightsKpi(activeTab, item.target);
  const accent = toneColor(item.headlineTone, colors);

  return (
    <button
      type="button"
      className="inline-flex max-w-full flex-col rounded-lg border px-2.5 py-1.5 text-left transition-colors"
      style={{
        borderColor: highlighted ? colors.accent : colors.border,
        background: highlighted
          ? `color-mix(in srgb, ${colors.accent} 10%, ${colors.surfaceMuted})`
          : colors.surfaceMuted,
        cursor: "pointer"
      }}
      data-testid={`signals-desk-kpi-${item.target}`}
      aria-label={`${item.label}: ${item.headline}${detail ? `. ${detail}` : ""}`}
      onClick={onSelect}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: colors.textMuted }}>
        {item.label}
      </span>
      <span className="text-sm font-semibold leading-tight" style={{ color: accent }}>
        {item.headline}
      </span>
      {detail ? (
        <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
          {detail}
        </span>
      ) : null}
    </button>
  );
}

export function SignalsDeskVerdictRow({
  items,
  activeTab,
  biasProof,
  executionHint,
  decisionState,
  onSelectTarget
}: Props) {
  const { colors } = useTheme();
  const biasItem = items.find((i) => i.target === "bias");
  const alignmentItem = items.find((i) => i.target === "alignment");
  const executionItem = items.find((i) => i.target === "execution");
  if (!biasItem || !alignmentItem || !executionItem) return null;

  const executionHighlighted = deskTabHighlightsKpi(activeTab, "execution");
  const isActionable = decisionState === "actionable";
  const executionAccent = isActionable ? colors.bullish : colors.bearish;

  return (
    <div
      className="mt-3 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-stretch"
      data-testid="signals-desk-verdict-row"
      role="group"
      aria-label="Desk verdict summary"
    >
      <div className="flex min-w-0 flex-wrap items-stretch gap-2">
        <MetricChip
          item={biasItem}
          activeTab={activeTab}
          detail={biasProof}
          onSelect={() => onSelectTarget("bias")}
        />
        <MetricChip
          item={alignmentItem}
          activeTab={activeTab}
          detail={alignmentItem.subline}
          onSelect={() => onSelectTarget("alignment")}
        />
      </div>
      <button
        type="button"
        className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-colors lg:min-w-[220px]"
        style={{
          borderColor: executionHighlighted
            ? colors.accent
            : isActionable
              ? `color-mix(in srgb, ${colors.bullish} 45%, ${colors.border})`
              : `color-mix(in srgb, ${colors.bearish} 45%, ${colors.border})`,
          borderLeftWidth: isActionable ? undefined : 4,
          background: isActionable
            ? `color-mix(in srgb, ${colors.bullish} 12%, ${colors.surfaceMuted})`
            : `color-mix(in srgb, ${colors.bearish} 10%, ${colors.surfaceMuted})`,
          cursor: "pointer"
        }}
        data-testid="signals-desk-verdict-execution"
        aria-label={`Execution: ${executionItem.headline}${executionHint ? `. ${executionHint}` : ""}`}
        onClick={() => onSelectTarget("execution")}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: colors.textMuted }}>
          Execution
        </span>
        <span
          className="mt-0.5 block text-base font-bold leading-tight sm:text-lg"
          style={{ color: executionAccent }}
          data-testid="signals-setup-execution"
        >
          {executionItem.headline}
        </span>
        {executionHint ? (
          <span className="mt-1 line-clamp-2 block text-xs leading-snug" style={{ color: colors.textMuted }}>
            {executionHint}
          </span>
        ) : null}
      </button>
    </div>
  );
}

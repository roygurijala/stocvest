"use client";

import type { SignalsDeskKpiItem } from "@/lib/signals-desk-kpi-present";
import type { SignalsDeskTab, SignalsKpiTarget } from "@/lib/signals-page-tabs";
import { deskTabHighlightsKpi, kpiTargetToDeskTab } from "@/lib/signals-page-tabs";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  items: SignalsDeskKpiItem[];
  activeTab: SignalsDeskTab;
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

export function SignalsDeskKpiStrip({ items, activeTab, onSelectTarget }: Props) {
  const { colors } = useTheme();

  return (
    <div
      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
      data-testid="signals-desk-kpi-strip"
      role="group"
      aria-label="Setup desk summary"
    >
      {items.map((item) => {
        const tabForTarget = kpiTargetToDeskTab(item.target);
        const highlighted = deskTabHighlightsKpi(activeTab, item.target);
        return (
          <button
            key={item.target}
            type="button"
            className="min-h-11 rounded-lg border px-3 py-2.5 text-left transition-colors"
            style={{
              borderColor: highlighted ? colors.accent : colors.border,
              background: highlighted
                ? `color-mix(in srgb, ${colors.accent} 12%, ${colors.surfaceMuted})`
                : colors.surfaceMuted,
              cursor: "pointer"
            }}
            data-testid={`signals-desk-kpi-${item.target}`}
            aria-current={highlighted ? "true" : undefined}
            aria-label={`${item.label}: ${item.headline}. Opens ${tabForTarget} tab.`}
            onClick={() => onSelectTarget(item.target)}
          >
            <p
              className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: colors.textMuted }}
            >
              {item.label}
            </p>
            <p
              className="m-0 mt-0.5 text-base font-semibold leading-tight sm:text-lg"
              style={{ color: toneColor(item.headlineTone, colors) }}
              data-testid={
                item.target === "bias"
                  ? "signals-setup-bias"
                  : item.target === "alignment"
                    ? "signals-setup-alignment"
                    : "signals-setup-execution"
              }
            >
              {item.headline}
            </p>
            {item.subline ? (
              <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
                {item.subline}
              </p>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

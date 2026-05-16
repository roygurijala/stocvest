"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { CuteLoader } from "@/components/cute-loader";
import { InfoTip } from "@/components/info-tip";
import { LAYER_NAME_HINTS } from "@/lib/ui-tooltips";
import {
  buildLayerInsightLine,
  countLayerAlignment,
  layerPolarity,
  layerPolarityDotColor,
  layerPolarityLabel,
  pickCollapsedLayerPreview,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  tradingMode: "day" | "swing";
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  loading: boolean;
  insufficient: boolean;
  insufficientMessage?: ReactNode;
};

export function SignalsLayerBreakdown({
  symbol,
  tradingMode,
  bias,
  rows,
  loading,
  insufficient,
  insufficientMessage
}: Props) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const alignment = countLayerAlignment(rows, bias);
  const preview = pickCollapsedLayerPreview(rows, bias, 2, 2);
  const visible = expanded ? rows : preview.length > 0 ? preview : rows.slice(0, 3);

  return (
    <section
      className={surfaceGlowClassName}
      data-testid="signals-layer-breakdown"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0" style={{ fontSize: typography.scale.lg }}>
          6-Layer Breakdown
        </h3>
        <span className="text-xs" style={{ color: colors.textMuted }}>
          as of latest close · Alignment {alignment.aligned}/{alignment.total}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: `${spacing[6]} ${spacing[2]}` }} data-testid="signals-layers-loader">
          <CuteLoader
            label={`Loading ${tradingMode === "swing" ? "swing" : "day"} signal`}
            sublabel={`Refreshing layers for ${symbol.trim().toUpperCase()}.`}
            compact
          />
        </div>
      ) : insufficient ? (
        insufficientMessage
      ) : (
        <>
          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {visible.map((row) => (
              <LayerRow key={row.key} row={row} bias={bias} colors={colors} />
            ))}
          </ul>
          {rows.length > preview.length ? (
            <button
              type="button"
              className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium"
              style={{ border: `1px solid ${colors.border}`, color: colors.textMuted, background: colors.surfaceMuted }}
              aria-expanded={expanded}
              onClick={() => setExpanded((e) => !e)}
              data-testid="signals-layers-expand"
            >
              {expanded ? (
                <>
                  <ChevronUp size={14} aria-hidden />
                  Show fewer layers
                </>
              ) : (
                <>
                  <ChevronDown size={14} aria-hidden />
                  View all layers
                </>
              )}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function LayerRow({
  row,
  bias,
  colors
}: {
  row: SignalsLayerRowInput;
  bias: SignalsSetupBias;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const polarity = layerPolarity(row, bias);
  const dot = layerPolarityDotColor(polarity);
  const insight = buildLayerInsightLine(row, bias);
  const hint = LAYER_NAME_HINTS[row.key as keyof typeof LAYER_NAME_HINTS];

  return (
    <li
      className="flex items-start gap-3 rounded-lg px-2 py-2"
      style={{ background: colors.surfaceMuted, border: `1px solid ${colors.border}` }}
      data-testid={`signals-layer-row-${row.key}`}
      data-layer-polarity={polarity}
    >
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: dot }}
        aria-hidden
        title={layerPolarityLabel(polarity)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: colors.text }}>
            {row.name}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: colors.textMuted }}>
            {layerPolarityLabel(polarity)}
          </span>
          {hint ? <InfoTip text={hint} label={row.name} /> : null}
        </div>
        <p className="m-0 mt-0.5 text-sm leading-snug" style={{ color: colors.textMuted }}>
          {insight}
        </p>
      </div>
    </li>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { CuteLoader } from "@/components/cute-loader";
import { InfoTip } from "@/components/info-tip";
import { LAYER_NAME_HINTS, SIGNAL_LAYER_LEVEL_VS_DELTA_TIP } from "@/lib/ui-tooltips";
import { SignalsLayerForceSummary } from "@/components/signals/signals-layer-force-summary";
import {
  buildLayerInsightLine,
  buildLayerRoleHeadline,
  layerHasCustomInsight,
  formatDeltaVsBaselineShort,
  formatLayerScoreLabel,
  formatSignalsAlignmentDisplayLine,
  resolveSignalsLayerAlignment,
  layerPolarity,
  layerPolarityDotColor,
  layerRoleLabel,
  pickCollapsedLayerPreview,
  SIGNAL_LAYER_LEVEL_BASELINE,
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
  maturationState?: string | null;
  alignmentRatio?: number | null;
  /** Layers tab: show all rows without collapse affordance. */
  defaultExpanded?: boolean;
};

export function SignalsLayerBreakdown({
  symbol,
  tradingMode,
  bias,
  rows,
  loading,
  insufficient,
  insufficientMessage,
  maturationState,
  alignmentRatio,
  defaultExpanded = false
}: Props) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const alignment = resolveSignalsLayerAlignment({ rows, bias, alignmentRatio });
  const preview = pickCollapsedLayerPreview(rows, bias, 2, 2);
  const visible = expanded ? rows : preview.length > 0 ? preview : rows.slice(0, 3);

  return (
    <section
      id="signals-layers"
      className={`signals-snap-section scroll-mt-4 ${surfaceGlowClassName}`}
      data-testid="signals-layer-breakdown"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0" style={{ fontSize: typography.scale.lg }}>
            6-Layer Breakdown
          </h3>
          <span className="inline-flex items-center gap-1 text-xs" style={{ color: colors.textMuted }}>
            Level 0–100 per layer
            <InfoTip text={SIGNAL_LAYER_LEVEL_VS_DELTA_TIP} label="Level vs Δ" maxWidth={320} />
          </span>
        </div>
        <span className="mt-1 block text-xs" style={{ color: colors.textMuted }}>
          as of latest close ·{" "}
          {formatSignalsAlignmentDisplayLine(alignment, bias, maturationState)}
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
          <SignalsLayerForceSummary rows={rows} bias={bias} />
          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {visible.map((row) => (
              <LayerRow key={row.key} row={row} bias={bias} colors={colors} />
            ))}
          </ul>
          {!defaultExpanded && rows.length > preview.length ? (
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
  const roleHeadline = buildLayerRoleHeadline(row, bias);
  const insight = buildLayerInsightLine(row, bias);
  const showInsight = layerHasCustomInsight(row);
  const hint = LAYER_NAME_HINTS[row.key as keyof typeof LAYER_NAME_HINTS];
  const levelLabel = formatLayerScoreLabel(row.score, row.status);
  const showLevel = row.score != null && levelLabel !== "N/A" && levelLabel !== "—";
  const levelPct = showLevel ? Math.max(0, Math.min(100, Number(levelLabel))) : 0;
  const delta =
    typeof row.deltaVsBaseline === "number" && Number.isFinite(row.deltaVsBaseline)
      ? row.deltaVsBaseline
      : null;

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
        title={layerRoleLabel(polarity, bias)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: colors.text }}>
            {row.name}
          </span>
          {hint ? <InfoTip text={hint} label={row.name} /> : null}
        </div>
        <p className="m-0 mt-0.5 text-xs font-medium leading-snug" style={{ color: colors.text }}>
          {roleHeadline}
        </p>
        {showLevel ? (
          <div className="mt-1.5" data-testid={`signals-layer-level-${row.key}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium" style={{ color: colors.text }}>
                Level {levelLabel}/100
              </span>
              {delta != null ? (
                <span
                  className="text-xs tabular-nums"
                  style={{ color: colors.textMuted }}
                  data-testid={`signals-layer-delta-${row.key}`}
                >
                  {formatDeltaVsBaselineShort(delta)} vs {SIGNAL_LAYER_LEVEL_BASELINE}
                </span>
              ) : null}
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full"
              style={{ background: colors.border }}
              role="progressbar"
              aria-valuenow={levelPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${row.name} level ${levelPct} out of 100`}
            >
              <div
                data-testid={`signals-layer-level-bar-${row.key}`}
                style={{
                  width: `${levelPct}%`,
                  height: "100%",
                  background: colors.accent,
                  opacity: 0.85
                }}
              />
            </div>
          </div>
        ) : (
          <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
            {row.status === "Unavailable" ? "No live level score" : "Level unavailable"}
          </p>
        )}
        {showInsight ? (
          <p className="m-0 mt-1.5 text-sm leading-snug" style={{ color: colors.textMuted }}>
            {insight}
          </p>
        ) : null}
      </div>
    </li>
  );
}

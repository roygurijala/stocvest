"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { SignalLayerDivergenceChart } from "@/components/signal-layer-divergence-chart";
import { SIGNAL_LAYER_LEVEL_BASELINE } from "@/lib/signals-page-present";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export type SignalsRadarDatum = {
  layer: string;
  score: number;
  hist: number;
  delta?: number;
};

type Props = {
  data: SignalsRadarDatum[];
  isMobileLayout: boolean;
};

export function SignalsRadarPanel({ data, isMobileLayout }: Props) {
  const { colors } = useTheme();
  const chartHeight = isMobileLayout ? 280 : 320;

  return (
    <section
      id="signals-section-radar"
      className={`min-w-0 scroll-mt-4 ${surfaceGlowClassName}`}
      data-testid="signals-radar-panel"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <h3 className="m-0 text-base font-semibold sm:text-lg" style={{ color: colors.text }}>
        Signal radar
      </h3>
      <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
        Level 0–100 vs baseline ({SIGNAL_LAYER_LEVEL_BASELINE}). Bars = Δ per layer.
      </p>
      <div
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
        style={{ color: colors.textMuted }}
        aria-label="Radar chart legend"
      >
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-sm"
            style={{ background: "#0ea5e9", opacity: 0.85, border: "1px solid #38bdf8" }}
            aria-hidden
          />
          Current
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-sm border-2 border-dashed"
            style={{ borderColor: colors.text, background: "transparent", opacity: 0.85 }}
            aria-hidden
          />
          Baseline
        </span>
      </div>
      <div
        className="mx-auto mt-2 w-full min-w-0 max-w-full overflow-hidden"
        style={{ height: chartHeight }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={data}
            margin={
              isMobileLayout
                ? { top: 20, right: 28, bottom: 28, left: 28 }
                : { top: 22, right: 32, bottom: 30, left: 32 }
            }
          >
            <PolarGrid stroke={colors.border} />
            <PolarAngleAxis
              dataKey="layer"
              tick={{ fill: colors.textMuted, fontSize: isMobileLayout ? 9 : 10 }}
              tickLine={false}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fill: colors.textMuted, fontSize: 9 }}
            />
            <Radar
              name="Typical baseline"
              dataKey="hist"
              stroke={colors.text}
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
              dot={false}
              isAnimationActive={false}
            />
            <Radar
              name="Current"
              dataKey="score"
              stroke="#38bdf8"
              strokeWidth={2}
              fill="#0ea5e9"
              fillOpacity={0.38}
              dot={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <h4 className="m-0 mt-4 text-sm font-semibold" style={{ color: colors.text }}>
        Notable moves (Δ)
      </h4>
      <SignalLayerDivergenceChart
        data={data}
        colors={colors}
        height={isMobileLayout ? 300 : 280}
      />
    </section>
  );
}

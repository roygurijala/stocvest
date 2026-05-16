"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { pickPrimaryLayerDrivers } from "@/lib/signal-evidence/evidence-card-present";
import type { EvidenceLayer, EvidenceStatus } from "@/lib/signal-evidence";
import type { SignalsSetupBias } from "@/lib/signals-page-present";

function statusColor(status: EvidenceStatus, colors: ThemeColors): string {
  if (status === "Bullish") return colors.bullish;
  if (status === "Bearish") return colors.bearish;
  if (status === "Neutral") return colors.caution;
  if (status === "As of close") return colors.text;
  return colors.textMuted;
}

function elevatedCardStyle(colors: ThemeColors) {
  return {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    boxShadow: "0 1px 0 rgba(255,255,255,0.04)"
  };
}

type Props = {
  layers: EvidenceLayer[];
  bias: SignalsSetupBias;
};

export function EvidenceLayerContribution({ layers, bias }: Props) {
  const { colors } = useTheme();
  const primary = pickPrimaryLayerDrivers(layers, bias);
  const axisHint =
    bias === "Bearish"
      ? "← Bearish pressure · Neutral · Bullish →"
      : bias === "Bullish"
        ? "← Bearish · Neutral · Bullish pressure →"
        : "← Bearish · Neutral · Bullish →";

  return (
    <section
      data-testid="evidence-layer-contribution"
      style={{
        borderRadius: borderRadius.lg,
        padding: spacing[3],
        display: "grid",
        gap: spacing[2],
        ...elevatedCardStyle(colors)
      }}
    >
      <div>
        <h3 className="m-0" style={{ fontSize: typography.scale.lg }}>
          Layer contribution (directional pressure)
        </h3>
        <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
          Bar length = how much each layer weighs in the composite; color = layer verdict (bullish / bearish / neutral).
          Not trade readiness or probability.
        </p>
      </div>
      <p className="m-0 text-[11px] tracking-wide" style={{ color: colors.textMuted }}>
        {axisHint}
      </p>
      <div className="h-[208px] w-full max-w-full min-w-0 lg:h-[236px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={layers.map((l) => ({
              layer: l.name,
              score: Math.round(l.contributionScore),
              status: l.status
            }))}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 2, bottom: 6 }}
            barCategoryGap="15%"
          >
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: colors.textMuted }}
              axisLine={{ stroke: colors.border }}
              tickLine={{ stroke: colors.border }}
            />
            <YAxis
              type="category"
              dataKey="layer"
              width={116}
              interval={0}
              tick={{ fontSize: 10, fill: colors.textMuted }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(148,163,184,0.07)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const row = payload[0].payload as { layer: string; score: number; status: EvidenceStatus };
                return (
                  <div
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      color: colors.text
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{row.layer}</div>
                    <div style={{ color: colors.textMuted, marginTop: 4 }}>
                      {row.status === "Unavailable"
                        ? "Unavailable"
                        : row.status === "As of close"
                          ? `As of close · weight ${row.score}`
                          : `${row.status} · weight ${row.score}`}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="score" radius={[0, 6, 6, 0]} maxBarSize={19} isAnimationActive={false}>
              {layers.map((l) => (
                <Cell key={l.key} fill={statusColor(l.status, colors)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {primary.length > 0 ? (
        <p className="m-0 text-sm" style={{ color: colors.text }} data-testid="evidence-primary-drivers">
          <span style={{ fontWeight: 600 }}>Primary drivers: </span>
          {primary.join(", ")}
        </p>
      ) : null}
    </section>
  );
}


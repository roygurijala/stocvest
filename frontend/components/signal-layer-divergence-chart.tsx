"use client";

import type { ThemeColors } from "@/lib/design-system";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type LayerRadarDatum = { layer: string; score: number; hist: number };

function deltaFill(delta: number): string {
  if (delta > 0.5) return "#22c55e";
  if (delta < -0.5) return "#f43f5e";
  return "#64748b";
}

type Row = LayerRadarDatum & { delta: number };

export function SignalLayerDivergenceChart({
  data,
  colors,
  height = 200
}: {
  data: LayerRadarDatum[];
  colors: ThemeColors;
  height?: number;
}) {
  const rows: Row[] = data.map((d) => ({
    ...d,
    delta: Math.round((d.score - d.hist) * 10) / 10
  }));
  const maxAbs = Math.max(6, ...rows.map((r) => Math.abs(r.delta)));

  return (
    <div className="w-full max-w-full overflow-hidden" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 10, left: 2, bottom: 4 }}
          barCategoryGap="18%"
        >
          <XAxis
            type="number"
            domain={[-maxAbs, maxAbs]}
            tick={{ fontSize: 10, fill: colors.textMuted }}
            axisLine={{ stroke: colors.border }}
            tickLine={{ stroke: colors.border }}
          />
          <YAxis
            type="category"
            dataKey="layer"
            width={88}
            tick={{ fontSize: 10, fill: colors.textMuted }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <ReferenceLine x={0} stroke={colors.textMuted} strokeOpacity={0.4} />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.07)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const p = payload[0].payload as Row;
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
                  <div style={{ fontWeight: 600 }}>{p.layer}</div>
                  <div style={{ color: colors.textMuted, marginTop: 4 }}>
                    Today: {p.score} · Typical: ~{p.hist}
                  </div>
                  <div style={{ marginTop: 4, color: p.delta >= 0 ? "#86efac" : "#fda4af" }}>
                    Δ {p.delta > 0 ? "+" : ""}
                    {p.delta}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="delta" radius={[0, 2, 2, 0]} maxBarSize={16} isAnimationActive={false}>
            {rows.map((entry, i) => (
              <Cell key={`d-${entry.layer}-${i}`} fill={deltaFill(entry.delta)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

interface MiniSparklineProps {
  closes: number[];
  upColor: string;
  downColor: string;
  height?: number;
}

/** Tiny direction sparkline: no axes, last N closes. */
export function MiniSparkline({ closes, upColor, downColor, height = 36 }: MiniSparklineProps) {
  const clean = closes.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (clean.length < 2) {
    return <div style={{ height, opacity: 0.35 }} aria-hidden />;
  }
  const up = clean[clean.length - 1] >= clean[0];
  const data = clean.map((c, i) => ({ i, c }));
  return (
    <div style={{ height, width: "100%" }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey="c" stroke={up ? upColor : downColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import { useId, useMemo } from "react";
import { useTheme } from "@/lib/theme-provider";
import { getChangeColor } from "@/components/market-sentiment-score-widget";

export type IndexReturnsHistogramProps = {
  /**
   * Daily closes oldest → newest. The component derives per-day returns from
   * consecutive pairs, so `N` closes render `N − 1` bars. At least 2 closes
   * required; renders nothing if fewer than 2 are provided. The dashboard
   * feed currently passes 6 closes so the chart renders 5 bars — one per
   * regular trading session over the trailing week.
   */
  closes: number[];
  /**
   * CSS pixel height of the SVG (width always stretches to the container).
   * Default scales slightly with the number of return bars so five sessions
   * stay legible inside the index tiles.
   */
  height?: number;
  /** Optional accessible label override. Defaults to "5-session daily returns histogram". */
  ariaLabel?: string;
};

const VIEW_W = 100;

/**
 * Daily-returns histogram for the SPY / QQQ / IWM tiles in the Shared Context
 * master card. Horizontal layout: each row is one session’s close-to-close
 * return; bars extend left/right from a central zero line so polarity is
 * visible without wasting horizontal space in wide tiles.
 *
 * Encoding rules (locked in by tests/index-returns-histogram.test.tsx):
 *   1. One bar per *daily return*, oldest at the top, newest at the bottom.
 *   2. Color follows the same `getChangeColor` neutral-band as the % label
 *      (±0.1%): up → bullish, down → bearish, in-band → muted.
 *   3. Bar length encodes |return %| scaled per-card (max abs uses ~92% of
 *      the half-width budget). Cross-tile magnitude comparison stays on the
 *      % label.
 *   4. Polarity also lives in position — positive bars extend right from the
 *      vertical zero line, negative bars extend left. Colorblind-safe.
 *   5. Neutral sessions render a 1px-wide stub on the zero line.
 */
export function IndexReturnsHistogram({ closes, height: heightProp, ariaLabel }: IndexReturnsHistogramProps) {
  const { colors } = useTheme();
  const reactId = useId();

  const layout = useMemo(() => {
    if (!Array.isArray(closes) || closes.length < 2) return null;
    const clean = closes.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
    );
    if (clean.length < 2) return null;

    const returns: number[] = [];
    for (let i = 1; i < clean.length; i++) {
      returns.push((clean[i] / clean[i - 1] - 1) * 100);
    }
    if (returns.length === 0) return null;

    const maxAbs = Math.max(...returns.map((r) => Math.abs(r)), 0.05);

    const topPad = 3;
    const rowPitch = 14;
    const barH = 9;
    const viewH = topPad + returns.length * rowPitch + 3;
    const centerX = VIEW_W / 2;
    const maxHalfW = (VIEW_W / 2 - 4) * 0.92;

    const bars = returns.map((r, i) => {
      const magnitude = Math.min(1, Math.abs(r) / maxAbs);
      const inNeutralBand = Math.abs(r) <= 0.1;
      const sign: "up" | "down" | "flat" = inNeutralBand ? "flat" : r > 0 ? "up" : "down";
      const rowTop = topPad + i * rowPitch;
      const y = rowTop + (rowPitch - barH) / 2;

      if (sign === "flat") {
        return {
          x: centerX - 0.5,
          y,
          w: 1,
          h: barH,
          returnPct: r,
          sign
        };
      }

      const len = Math.max(0.4, magnitude * maxHalfW);
      if (sign === "up") {
        return { x: centerX, y, w: len, h: barH, returnPct: r, sign };
      }
      return { x: centerX - len, y, w: len, h: barH, returnPct: r, sign };
    });

    return {
      viewH,
      centerX,
      zeroY1: topPad - 1,
      zeroY2: viewH - 2,
      bars
    };
  }, [closes]);

  const pixelHeight =
    heightProp ??
    (layout ? Math.round(20 + (layout.bars.length > 0 ? layout.bars.length : 1) * 10) : 22);

  if (!layout) return null;

  const label = ariaLabel ?? "5-session daily returns histogram";

  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="index-returns-histogram"
      data-orientation="horizontal"
      width="100%"
      height={pixelHeight}
      viewBox={`0 0 ${VIEW_W} ${layout.viewH}`}
      preserveAspectRatio="none"
      style={{ display: "block", minHeight: pixelHeight }}
    >
      <title id={`hist-title-${reactId}`}>{label}</title>
      <line
        x1={layout.centerX}
        x2={layout.centerX}
        y1={layout.zeroY1}
        y2={layout.zeroY2}
        stroke={`color-mix(in srgb, ${colors.textMuted} 40%, transparent)`}
        strokeWidth={0.55}
        data-testid="histogram-zero-line"
      />
      {layout.bars.map((b, i) => (
        <rect
          key={i}
          data-testid={`histogram-bar-${i}`}
          data-sign={b.sign}
          data-return-pct={b.returnPct.toFixed(4)}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill={getChangeColor(b.returnPct, colors)}
          rx={0.5}
        >
          <title>{`Session ${i + 1}: ${b.returnPct >= 0 ? "+" : ""}${b.returnPct.toFixed(2)}%`}</title>
        </rect>
      ))}
    </svg>
  );
}

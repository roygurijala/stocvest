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
  /** Pixel width. Default 80px — matches the small sub-card density inside Shared Context. */
  width?: number;
  /** Pixel height. Default 22px. */
  height?: number;
  /** Optional accessible label override. Defaults to "5-session daily returns histogram". */
  ariaLabel?: string;
};

/**
 * Daily-returns histogram for the SPY / QQQ / IWM tiles in the Shared Context
 * master card. Replaces the line sparkline that previously sat in the same
 * pixel budget.
 *
 * Why bars, not a line, at this size:
 *   The card is ~120px wide. A line sparkline at that resolution is
 *   decorative — you can tell direction but not how the week unfolded.
 *   The headline % number already conveys the net result. Per-day signed
 *   bars convey the *shape* of the move (steady grind vs choppy reversal
 *   vs one-day spike) that the line cannot at this size.
 *
 * Encoding rules (locked in by tests/index-returns-histogram.test.tsx):
 *   1. One bar per *daily return*, oldest-leftmost / today-rightmost.
 *   2. Color follows the same `getChangeColor` neutral-band as the % label
 *      beside it (±0.1%): up → bullish, down → bearish, in-band → muted.
 *      The bar viz inherits the dashboard's role-color vocabulary; we do
 *      NOT invent new palette entries.
 *   3. Height encodes |return %| scaled per-card (max abs hits ~80% of the
 *      vertical budget). Per-card scaling so the *shape of the week* is
 *      legible on each tile; cross-card magnitude comparison lives in the
 *      % label, not in the bars.
 *   4. Polarity also lives in position — positive bars grow up from the
 *      baseline, negative bars hang down. Position carries the signal for
 *      colorblind users even if color is suppressed.
 *   5. Neutral / near-flat sessions render a thin 1px-tall stub on the
 *      zero baseline so the bar is visible and counts toward the day
 *      tally; we never silently drop a session.
 */
export function IndexReturnsHistogram({
  closes,
  width = 80,
  height = 22,
  ariaLabel
}: IndexReturnsHistogramProps) {
  const { colors } = useTheme();
  const reactId = useId();

  const layout = useMemo(() => {
    if (!Array.isArray(closes) || closes.length < 2) return null;
    const clean = closes.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
    );
    if (clean.length < 2) return null;

    // Daily returns in PERCENT. `returns[i]` is the close-to-close % move
    // between session i and session i+1, so newer at the end.
    const returns: number[] = [];
    for (let i = 1; i < clean.length; i++) {
      returns.push((clean[i] / clean[i - 1] - 1) * 100);
    }
    if (returns.length === 0) return null;

    // Per-card scaling — tallest bar reaches ~80% of the half-canvas height.
    // The floor (0.05%) prevents a degenerate "all five days were flat"
    // session from blowing magnitudes up to fill the canvas.
    const maxAbs = Math.max(...returns.map((r) => Math.abs(r)), 0.05);

    // Reserve 1px top/bottom padding so the strokes don't clip on devices
    // that anti-alias to subpixel boundaries.
    const usableH = height - 2;
    const halfH = usableH / 2;
    const zeroY = 1 + halfH;

    // Bar widths from the canvas: divide usable width into N equal slots
    // and gap them by 2px. Minimum 2px bar so single-session histograms
    // (early-week, post-holiday) still render visibly.
    const gap = 2;
    const slotW = (width - (returns.length - 1) * gap) / returns.length;
    const barW = Math.max(2, slotW - 1);

    return {
      zeroY,
      halfH,
      bars: returns.map((r, i) => {
        const magnitude = Math.min(1, Math.abs(r) / maxAbs);
        const inNeutralBand = Math.abs(r) <= 0.1;
        const sign: "up" | "down" | "flat" = inNeutralBand ? "flat" : r > 0 ? "up" : "down";

        // Flat sessions: a 1px stub straddling the baseline. NOT zero
        // height — bars need to be visible so the user can still count
        // five days.
        if (sign === "flat") {
          return {
            x: i * (slotW + gap) + (slotW - barW) / 2,
            y: zeroY - 0.5,
            w: barW,
            h: 1,
            returnPct: r,
            sign
          };
        }

        const barH = Math.max(1, magnitude * (halfH - 1));
        return {
          x: i * (slotW + gap) + (slotW - barW) / 2,
          y: sign === "up" ? zeroY - barH : zeroY,
          w: barW,
          h: barH,
          returnPct: r,
          sign
        };
      })
    };
  }, [closes, width, height]);

  if (!layout) return null;

  const label = ariaLabel ?? "5-session daily returns histogram";

  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="index-returns-histogram"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      <title id={`hist-title-${reactId}`}>{label}</title>
      {/* Faint zero-line so the polarity of each bar is also positional. */}
      <line
        x1={0}
        x2={width}
        y1={layout.zeroY}
        y2={layout.zeroY}
        stroke={`color-mix(in srgb, ${colors.textMuted} 40%, transparent)`}
        strokeWidth={0.5}
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

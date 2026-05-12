"use client";

import { useId, useMemo } from "react";
import { useTheme } from "@/lib/theme-provider";

export type IndexSparklineProps = {
  /** Daily closes oldest → newest. 2-5 points expected; renders nothing if <2. */
  closes: number[];
  /** Pixel width. Default 80px — matches the small sub-card density inside Shared Context. */
  width?: number;
  /** Pixel height. Default 22px. */
  height?: number;
  /** Optional accessible label override (defaults to "5-session close trajectory"). */
  ariaLabel?: string;
};

/**
 * Inline SPY/QQQ/IWM sparkline — Shared Context master card, Section A.
 *
 * Per the user's Phase 2b directive: "5-day horizontal sparkline (daily closes) ·
 * Neutral stroke (light slate) · No axes, no labels, no indicators". Green/red is
 * RESERVED for price-outcome semantics (the % change number rendered separately);
 * the sparkline stroke is intentionally neutral so the path conveys shape and
 * smoothness, not direction.
 *
 * Implementation notes:
 *   - Single SVG polyline normalized to the [0, 1] range of (min, max) closes.
 *   - When all points are identical (flat session), we render a single horizontal
 *     line midway down the canvas — never a divide-by-zero or empty path.
 *   - The component is purely presentational. The widget that places it owns the
 *     pct5d label rendered alongside; the sparkline shows PATH, not magnitude.
 */
export function IndexSparkline({ closes, width = 80, height = 22, ariaLabel }: IndexSparklineProps) {
  const { colors } = useTheme();
  const reactId = useId();
  const points = useMemo(() => {
    if (!Array.isArray(closes) || closes.length < 2) return null;
    const clean = closes.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (clean.length < 2) return null;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min;
    const xStep = (width - 2) / (clean.length - 1);
    return clean
      .map((v, i) => {
        const x = 1 + i * xStep;
        // Flat session edge case: keep the y in the middle so the line is visible.
        const yNorm = range === 0 ? 0.5 : (v - min) / range;
        // Invert y so newer-higher renders upward (SVG y is top-down).
        const y = height - 1 - yNorm * (height - 2);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [closes, width, height]);

  if (!points) return null;

  const label = ariaLabel ?? "5-session close trajectory";
  // Neutral, desaturated stroke — explicitly NOT bullish/bearish. We blend the
  // text-muted slate into the foreground text color slightly so the path stays
  // legible on both dark and light surfaces.
  const stroke = `color-mix(in srgb, ${colors.textMuted} 70%, ${colors.text})`;

  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="index-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      <title id={`spark-title-${reactId}`}>{label}</title>
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

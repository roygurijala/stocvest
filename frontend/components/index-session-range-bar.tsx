"use client";

import type { ThemeColors } from "@/lib/design-system";

export type IndexSessionRangeBarProps = {
  low: number;
  high: number;
  last: number;
  open?: number | null;
  prevClose?: number | null;
  colors: ThemeColors;
};

/**
 * One-row viz: cash-session high–low as a track with last price as a dot.
 * Descriptive only (Shared Context); not entry/stop language.
 */
export function IndexSessionRangeBar({ low, high, last, open, prevClose, colors }: IndexSessionRangeBarProps) {
  if (!(high > low) || !Number.isFinite(last)) return null;

  const span = high - low;
  const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
  const lastT = clamp01((last - low) / span);
  const openT =
    typeof open === "number" && Number.isFinite(open) ? clamp01((open - low) / span) : null;
  const prevT =
    typeof prevClose === "number" && Number.isFinite(prevClose)
      ? clamp01((prevClose - low) / span)
      : null;

  const W = 100;
  const H = 10;
  const pad = 1;
  const trackY = H / 2;
  const trackH = 3;
  const dotR = 2.25;

  return (
    <svg
      role="img"
      aria-label="Session high-low range with last price marker"
      data-testid="index-session-range-bar"
      width="100%"
      height={14}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <title>{`Session range ${low.toFixed(2)}–${high.toFixed(2)}, last ${last.toFixed(2)}`}</title>
      <rect
        x={pad}
        y={trackY - trackH / 2}
        width={W - pad * 2}
        height={trackH}
        rx={1}
        fill={`color-mix(in srgb, ${colors.textMuted} 22%, transparent)`}
      />
      {prevT != null ? (
        <line
          x1={pad + prevT * (W - pad * 2)}
          x2={pad + prevT * (W - pad * 2)}
          y1={1}
          y2={H - 1}
          stroke={`color-mix(in srgb, ${colors.textMuted} 65%, transparent)`}
          strokeWidth={0.75}
          strokeDasharray="2 1"
        />
      ) : null}
      {openT != null ? (
        <line
          x1={pad + openT * (W - pad * 2)}
          x2={pad + openT * (W - pad * 2)}
          y1={1}
          y2={H - 1}
          stroke={`color-mix(in srgb, ${colors.text} 35%, transparent)`}
          strokeWidth={0.85}
        />
      ) : null}
      <circle
        cx={pad + lastT * (W - pad * 2)}
        cy={trackY}
        r={dotR}
        fill={colors.text}
        stroke={colors.surface}
        strokeWidth={0.5}
      />
    </svg>
  );
}

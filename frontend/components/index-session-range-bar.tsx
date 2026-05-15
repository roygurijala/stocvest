"use client";

import { useId } from "react";
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
  const uid = useId().replace(/:/g, "");
  const gradId = `sr-grad-${uid}`;
  const glowId = `sr-glow-${uid}`;

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
  const H = 18;
  const padX = 2;
  const trackY = H / 2 + 0.5;
  const trackH = 6;
  const innerW = W - padX * 2;
  const dotR = 3.15;

  const trackLeft = padX;
  const trackRight = padX + innerW;

  return (
    <svg
      role="img"
      aria-label="Session high-low range with last price marker"
      data-testid="index-session-range-bar"
      width="100%"
      height={22}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <title>{`Intraday range ${low.toFixed(2)}–${high.toFixed(2)} (cash); last ${last.toFixed(2)} — dot is position inside today high–low, not the 5-session net above.`}</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse">
          <stop
            offset="0%"
            stopColor={`color-mix(in srgb, ${colors.bearish} 38%, ${colors.surfaceMuted})`}
          />
          <stop
            offset="50%"
            stopColor={`color-mix(in srgb, ${colors.textMuted} 35%, ${colors.border})`}
          />
          <stop
            offset="100%"
            stopColor={`color-mix(in srgb, ${colors.bullish} 34%, ${colors.surfaceMuted})`}
          />
        </linearGradient>
        <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* End caps */}
      <line
        x1={trackLeft}
        x2={trackLeft}
        y1={trackY - 5}
        y2={trackY + 5}
        stroke={`color-mix(in srgb, ${colors.textMuted} 55%, transparent)`}
        strokeWidth={0.9}
        strokeLinecap="round"
      />
      <line
        x1={trackRight}
        x2={trackRight}
        y1={trackY - 5}
        y2={trackY + 5}
        stroke={`color-mix(in srgb, ${colors.textMuted} 55%, transparent)`}
        strokeWidth={0.9}
        strokeLinecap="round"
      />
      <line
        x1={trackLeft + innerW * 0.5}
        x2={trackLeft + innerW * 0.5}
        y1={trackY - 3.5}
        y2={trackY + 3.5}
        stroke={`color-mix(in srgb, ${colors.textMuted} 28%, transparent)`}
        strokeWidth={0.55}
      />

      <rect
        x={trackLeft}
        y={trackY - trackH / 2}
        width={innerW}
        height={trackH}
        rx={trackH / 2}
        fill={`url(#${gradId})`}
        stroke={`color-mix(in srgb, ${colors.text} 22%, ${colors.border})`}
        strokeWidth={0.5}
      />

      {prevT != null ? (
        <line
          x1={trackLeft + prevT * innerW}
          x2={trackLeft + prevT * innerW}
          y1={2.5}
          y2={H - 2.5}
          stroke={`color-mix(in srgb, ${colors.textMuted} 70%, transparent)`}
          strokeWidth={0.75}
          strokeDasharray="2.5 1.5"
        />
      ) : null}
      {openT != null ? (
        <line
          x1={trackLeft + openT * innerW}
          x2={trackLeft + openT * innerW}
          y1={2.5}
          y2={H - 2.5}
          stroke={`color-mix(in srgb, ${colors.text} 42%, transparent)`}
          strokeWidth={0.85}
        />
      ) : null}

      <circle
        cx={trackLeft + lastT * innerW}
        cy={trackY}
        r={dotR + 1.1}
        fill={colors.surface}
        opacity={0.92}
      />
      <circle
        cx={trackLeft + lastT * innerW}
        cy={trackY}
        r={dotR + 0.55}
        fill="none"
        stroke={`color-mix(in srgb, ${colors.bullish} 65%, ${colors.border})`}
        strokeWidth={0.55}
      />
      <circle
        cx={trackLeft + lastT * innerW}
        cy={trackY}
        r={dotR}
        fill={colors.text}
        filter={`url(#${glowId})`}
      />
    </svg>
  );
}

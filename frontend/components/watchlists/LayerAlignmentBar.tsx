"use client";

import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  fillPct: number;
  aligned: number;
  total: number;
  fillColor: string;
  testId?: string;
  /** When true, bar spans full row width (no symbol column). */
  fullWidth?: boolean;
};

export function LayerAlignmentBar({
  fillPct,
  aligned,
  total,
  fillColor,
  testId = "watchlist-layer-bar",
  fullWidth = true
}: Props) {
  const { colors } = useTheme();
  const fill = Math.max(0, Math.min(100, Math.round(fillPct)));

  return (
    <div
      className="watchlist-layer-bar"
      data-testid={testId}
      style={
        fullWidth
          ? { width: "100%" }
          : {
              display: "grid",
              gridTemplateColumns: "3.25rem minmax(0, 1fr)",
              alignItems: "center",
              gap: spacing[2],
              width: "100%"
            }
      }
    >
      <div
        role="progressbar"
        aria-valuenow={fill}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${aligned} of ${total} confirmation layers aligned`}
        data-testid={`${testId}-track`}
        style={{
          gridColumn: fullWidth ? "1 / -1" : "2",
          height: 5,
          borderRadius: borderRadius.sm,
          background: colors.border,
          overflow: "hidden"
        }}
      >
        <div
          data-testid={`${testId}-fill`}
          style={{
            width: `${fill}%`,
            height: "100%",
            background: fillColor,
            minWidth: fill > 0 ? 2 : 0,
            transition: "width 0.2s ease"
          }}
        />
      </div>
      <span className="sr-only">
        {aligned}/{total} layers
      </span>
    </div>
  );
}

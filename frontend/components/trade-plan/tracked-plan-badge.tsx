"use client";

import type { CSSProperties } from "react";
import { borderRadius, typography } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

export function TrackedPlanBadge({ colors, compact = false }: { colors: Colors; compact?: boolean }) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: compact ? 9 : typography.scale.xs,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: colors.accent,
    background: `${colors.accent}18`,
    border: `1px solid ${colors.accent}44`,
    borderRadius: borderRadius.full,
    padding: compact ? "1px 6px" : "2px 8px",
    lineHeight: 1.2,
    whiteSpace: "nowrap"
  };
  return (
    <span data-testid="tracked-plan-badge" style={style}>
      Plan
    </span>
  );
}

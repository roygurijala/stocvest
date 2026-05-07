"use client";

import type { ThemeColors } from "@/lib/design-system";
import { typography } from "@/lib/design-system";

export interface AIExplanationDisplayProps {
  text: string;
  source: "ai" | "deterministic";
  cached: boolean;
  colors: ThemeColors;
}

export function AIExplanationDisplay({ text, source, cached, colors }: AIExplanationDisplayProps) {
  return (
    <div className="flex flex-col gap-1">
      <p style={{ margin: 0, fontStyle: "italic", color: colors.text }}>&ldquo;{text}&rdquo;</p>
      {source === "ai" ? (
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
          AI explanation{cached ? " · cached for today" : ""}
        </span>
      ) : null}
    </div>
  );
}

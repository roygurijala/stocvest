"use client";

import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary?: string;
  children: string;
  testId?: string;
};

/** Collapsible legal/context copy — keeps pipeline stages scannable. */
export function PipelineSectionNote({ summary = "About this section", children, testId }: Props) {
  const { colors } = useTheme();
  return (
    <details
      className="mt-2"
      data-testid={testId}
      style={{
        fontSize: "0.6875rem",
        color: colors.textMuted,
        lineHeight: 1.45
      }}
    >
      <summary
        className="cursor-pointer select-none"
        style={{ color: colors.textMuted, fontWeight: 600 }}
      >
        {summary}
      </summary>
      <p
        className="m-0 mt-1.5"
        style={{
          padding: spacing[2],
          borderRadius: borderRadius.md,
          background: `color-mix(in srgb, ${colors.surfaceMuted} 60%, transparent)`,
          maxWidth: "40rem"
        }}
      >
        {children}
      </p>
    </details>
  );
}

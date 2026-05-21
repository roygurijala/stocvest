"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { WhatWouldChangeContent } from "@/lib/scanner/scanner-quiet-desk";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  text?: string;
  content?: WhatWouldChangeContent | null;
};

export function WhatWouldChangeFooter({ text, content }: Props) {
  const { colors } = useTheme();
  const structured = content && (content.watchItems.length > 0 || content.outcome);
  const plain = text?.trim();

  if (!structured && !plain) return null;

  return (
    <aside
      data-testid="scanner-what-would-change"
      style={{
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <p
        style={{
          margin: `0 0 ${spacing[2]}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        What would change this
      </p>
      {structured ? (
        <>
          <ul
            style={{
              margin: 0,
              paddingLeft: spacing[4],
              fontSize: typography.scale.sm,
              color: colors.text,
              lineHeight: 1.55
            }}
          >
            {content!.watchItems.map((item) => (
              <li key={item} style={{ marginBottom: spacing[1] }}>
                {item}
              </li>
            ))}
          </ul>
          {content!.outcome ? (
            <p
              style={{
                margin: `${spacing[2]} 0 0`,
                fontSize: typography.scale.sm,
                fontWeight: 600,
                color: colors.textMuted,
                lineHeight: 1.55
              }}
            >
              {content!.outcome}
            </p>
          ) : null}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.55 }}>
          {plain}
        </p>
      )}
    </aside>
  );
}

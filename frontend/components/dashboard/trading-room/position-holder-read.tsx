"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { PositionHolderRead } from "@/lib/dashboard/trading-room/position-fundamentals-present";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

type Props = {
  read: PositionHolderRead;
  colors: Colors;
};

function stanceColor(stance: PositionHolderRead["stance"], colors: Colors): string {
  if (stance === "defensive") return colors.bearish;
  if (stance === "constructive") return colors.bullish;
  return colors.caution;
}

function stanceLabel(stance: PositionHolderRead["stance"]): string {
  if (stance === "defensive") return "Defensive";
  if (stance === "constructive") return "Constructive";
  return "Caution";
}

/**
 * Owner-oriented "if you already hold this" read. Renders only when the backend ships the
 * ship-dark `position_holder_read` payload (flag OFF by default). Intentionally action-oriented
 * (tighten stop / reduce / add), so it carries a prominent not-advice disclaimer.
 */
export function PositionHolderRead({ read, colors }: Props) {
  const accent = stanceColor(read.stance, colors);

  return (
    <article
      data-testid="position-holder-read"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: borderRadius.lg,
        padding: spacing[4],
        display: "flex",
        flexDirection: "column",
        gap: spacing[3]
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Position management · if you own it
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: spacing[2], marginTop: spacing[2] }}>
          <span
            data-testid="position-holder-stance"
            style={{ fontSize: typography.scale.base, fontWeight: 700, color: accent }}
          >
            {stanceLabel(read.stance)}
          </span>
          {read.headline ? (
            <span style={{ fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>
              {read.headline}
            </span>
          ) : null}
        </div>
      </div>

      {read.actions.length ? (
        <ul style={{ margin: 0, paddingLeft: spacing[4], display: "flex", flexDirection: "column", gap: spacing[1] }}>
          {read.actions.map((a, i) => (
            <li key={i} style={{ fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>
              {a}
            </li>
          ))}
        </ul>
      ) : null}

      {read.context.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
          {read.context.map((c, i) => (
            <p key={i} style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
              {c}
            </p>
          ))}
        </div>
      ) : null}

      {read.disclaimer ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45, fontStyle: "italic" }}>
          {read.disclaimer}
        </p>
      ) : null}
    </article>
  );
}

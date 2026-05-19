"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  bullets: string[];
  marketScopeLine?: string | null;
  /** Collapse macro “why” behind a disclosure on quiet scans. */
  collapsible?: boolean;
};

function CauseBody({
  bullets,
  marketScopeLine,
  colors
}: {
  bullets: string[];
  marketScopeLine?: string | null;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <>
      <ul
        style={{
          margin: 0,
          padding: `0 0 0 ${spacing[3]}`,
          display: "grid",
          gap: 2,
          fontSize: typography.scale.xs,
          color: colors.textMuted,
          lineHeight: 1.45
        }}
      >
        {bullets.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {marketScopeLine ? (
        <p
          data-testid="scanner-market-scope"
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: typography.scale.xs,
            color: colors.text,
            lineHeight: 1.45,
            fontWeight: 500
          }}
        >
          {marketScopeLine}
        </p>
      ) : null}
    </>
  );
}

export function ScannerCauseSection({ bullets, marketScopeLine, collapsible = false }: Props) {
  if (bullets.length === 0) return null;
  const { colors } = useTheme();

  const shellStyle = {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    border: `1px solid color-mix(in srgb, ${colors.border} 85%, transparent)`,
    background: colors.surfaceMuted
  } as const;

  const summaryStyle = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: colors.textMuted,
    cursor: "pointer",
    listStyle: "none"
  };

  if (collapsible) {
    return (
      <details data-testid="scanner-cause-section" className="scanner-cause-details" style={shellStyle}>
        <summary className="scanner-cause-details__summary" style={summaryStyle}>
          Why nothing passed
        </summary>
        <div style={{ marginTop: spacing[2] }}>
          <CauseBody bullets={bullets} marketScopeLine={marketScopeLine} colors={colors} />
        </div>
      </details>
    );
  }

  return (
    <section data-testid="scanner-cause-section" style={shellStyle}>
      <p style={{ margin: `0 0 ${spacing[1]}`, ...summaryStyle, cursor: "default" }}>Why nothing passed</p>
      <CauseBody bullets={bullets} marketScopeLine={marketScopeLine} colors={colors} />
    </section>
  );
}

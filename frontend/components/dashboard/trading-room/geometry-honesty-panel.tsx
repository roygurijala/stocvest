"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { GeometryHonestyPresent, GeometryHonestyRow } from "@/lib/dashboard/geometry-honesty-present";

function rowColor(row: GeometryHonestyRow, colors: ThemeColors): string {
  if (row.tone === "caution") return colors.caution;
  if (row.tone === "muted") return colors.textMuted;
  return colors.text;
}

export function GeometryHonestyPanel({
  present,
  colors
}: {
  present: GeometryHonestyPresent;
  colors: ThemeColors;
}) {
  if (!present.showPanel) return null;

  return (
    <article
      data-testid="geometry-honesty-panel"
      style={{
        background: colors.surface,
        border: `1px solid ${present.headline ? colors.caution : colors.border}`,
        borderRadius: borderRadius.md,
        padding: `${spacing[3]} ${spacing[4]}`
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Geometry honesty
      </p>
      {present.headline ? (
        <p
          data-testid="geometry-honesty-headline"
          style={{
            margin: "8px 0 0",
            fontSize: typography.scale.sm,
            lineHeight: 1.5,
            fontWeight: 600,
            color: colors.caution
          }}
        >
          {present.headline}
        </p>
      ) : null}
      <dl
        style={{
          margin: `${spacing[3]} 0 0`,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
          gap: `${spacing[2]} ${spacing[4]}`
        }}
      >
        {present.rows.map((row) => (
          <div key={row.label} style={{ display: "contents" }}>
            <dt
              data-testid={`geometry-honesty-label-${row.label.replace(/\s+/g, "-").toLowerCase()}`}
              style={{
                margin: 0,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.5
              }}
            >
              {row.label}
            </dt>
            <dd
              data-testid={`geometry-honesty-value-${row.label.replace(/\s+/g, "-").toLowerCase()}`}
              style={{
                margin: 0,
                fontSize: typography.scale.sm,
                fontWeight: 600,
                color: rowColor(row, colors),
                lineHeight: 1.5
              }}
            >
              {row.value}
              {row.note ? (
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    fontSize: typography.scale.xs,
                    fontWeight: 500,
                    color: colors.textMuted,
                    lineHeight: 1.45
                  }}
                >
                  {row.note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ScannerSynthesisNearMiss } from "@/lib/scanner-synthesis";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  nearMisses: ScannerSynthesisNearMiss[];
};

export function NearMissSection({ nearMisses }: Props) {
  if (nearMisses.length === 0) return null;
  const { colors } = useTheme();

  return (
    <section
      data-testid="scanner-near-miss-section"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <p
        style={{
          margin: `0 0 ${spacing[1]}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Closest to qualifying
      </p>
      <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        Blocked by session volume · structure intact
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[3] }}>
        {nearMisses.map((row) => (
          <NearMissRow key={row.symbol} row={row} colors={colors} />
        ))}
      </ul>
    </section>
  );
}

function NearMissRow({
  row,
  colors
}: {
  row: ScannerSynthesisNearMiss;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const pct = Math.max(0, Math.min(100, row.pct_of_needed));
  return (
    <li data-testid={`scanner-near-miss-${row.symbol}`}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: spacing[2] }}>
        <span className="font-mono font-bold" style={{ color: colors.text }}>
          {row.symbol}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Watch
        </span>
      </div>
      {row.structure_note ? (
        <p style={{ margin: `${spacing[1]} 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
          {row.structure_note}
        </p>
      ) : null}
      <div style={{ marginTop: spacing[2] }}>
          <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid={`scanner-near-miss-bar-${row.symbol}`}
          style={{
            height: 6,
            borderRadius: borderRadius.sm,
            background: colors.border,
            overflow: "hidden"
          }}
        >
          <div
            data-testid={`scanner-near-miss-bar-fill-${row.symbol}`}
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "#d97706"
            }}
          />
        </div>
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {pct}% of needed volume
        </p>
        {row.is_market_proxy ? (
          <p
            data-testid="scanner-near-miss-proxy-note"
            style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.accent, lineHeight: 1.5 }}
          >
            Recovery here signals broader pickup
          </p>
        ) : null}
      </div>
    </li>
  );
}

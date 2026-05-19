"use client";

import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { roleAccents } from "@/lib/design-system";
import { buildScannerQuietSubline } from "@/lib/scanner-quiet-copy";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: ScannerScanSummary;
  synthesis?: ScannerSynthesis | null;
};

const DESKS = [
  { key: "gap", label: "Gaps", role: "shared" as const, count: (s: ScannerScanSummary) => s.qualifying.gap_flags },
  { key: "swing", label: "Swing", role: "swing" as const, count: (s: ScannerScanSummary) => s.qualifying.swing },
  { key: "day", label: "Day", role: "day" as const, count: (s: ScannerScanSummary) => s.qualifying.day }
];

/** Quiet scan: one strip — market status + color-rail desk counts (replaces hero subline + outcome cards). */
export function ScannerQuietRibbon({ summary, synthesis }: Props) {
  const { colors, theme } = useTheme();
  const quietSubline = buildScannerQuietSubline(summary, synthesis);

  return (
    <section
      data-testid="scanner-quiet-ribbon"
      className={`scanner-quiet-ribbon ${surfaceGlowClassName}`}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[3],
        padding: `${spacing[3]} ${spacing[4]}`,
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <p
        data-testid="scanner-scan-quiet-subline"
        className="scanner-quiet-ribbon__status"
        style={{
          margin: 0,
          flex: "1 1 10rem",
          minWidth: 0,
          fontSize: typography.scale.lg,
          fontWeight: 600,
          color: colors.text,
          lineHeight: 1.25
        }}
      >
        {quietSubline}
      </p>
      <div
        className="scanner-quiet-ribbon__counts"
        data-testid="scanner-quiet-ribbon-counts"
        style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], flex: "0 0 auto" }}
        aria-label="Qualifying counts by desk"
      >
        {DESKS.map((desk) => {
          const accent = roleAccents[theme][desk.role];
          const n = desk.count(summary);
          return (
            <div
              key={desk.key}
              data-testid={`scanner-quiet-rail-${desk.key}`}
              style={{
                minWidth: 52,
                paddingTop: 6,
                borderTop: `3px solid ${accent.borderAccent}`,
                textAlign: "center"
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: colors.textMuted
                }}
              >
                {desk.label}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  fontSize: typography.scale.xl,
                  fontWeight: 700,
                  color: colors.text,
                  lineHeight: 1
                }}
              >
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { typography } from "@/lib/design-system";
import { roleAccents } from "@/lib/design-system";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { useTheme } from "@/lib/theme-provider";

const DESKS = [
  { key: "gap", label: "Gaps", role: "shared" as const, count: (s: ScannerScanSummary) => s.qualifying.gap_flags },
  { key: "swing", label: "Swing", role: "swing" as const, count: (s: ScannerScanSummary) => s.qualifying.swing },
  { key: "day", label: "Day", role: "day" as const, count: (s: ScannerScanSummary) => s.qualifying.day }
];

/** Desk counts in hero — narrative when quiet instead of three zeroes. */
export function ScannerDeskRails({ summary }: { summary: ScannerScanSummary }) {
  const { colors, theme } = useTheme();
  const isQuiet = summary.qualifying.total === 0;

  if (isQuiet) {
    return (
      <div
        className="scanner-quiet-ribbon__counts"
        data-testid="scanner-quiet-ribbon-summary"
        style={{ flex: "0 0 auto", maxWidth: "14rem", textAlign: "right" }}
      >
        <span
          style={{
            display: "block",
            fontSize: typography.scale.sm,
            fontWeight: 600,
            color: colors.textMuted,
            lineHeight: 1.4
          }}
        >
          {summary.quiet.detail_line}
        </span>
      </div>
    );
  }

  return (
    <div
      className="scanner-quiet-ribbon__counts"
      data-testid="scanner-quiet-ribbon-counts"
      style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: "0 0 auto" }}
      aria-label="Qualifying counts by desk"
    >
      {DESKS.map((desk) => {
        const accent = roleAccents[theme][desk.role];
        return (
          <div
            key={desk.key}
            data-testid={`scanner-quiet-rail-${desk.key}`}
            style={{
              minWidth: 48,
              paddingTop: 5,
              borderTop: `3px solid ${accent.borderAccent}`,
              textAlign: "center"
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.08em",
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
                fontSize: typography.scale.lg,
                fontWeight: 700,
                color: colors.text,
                lineHeight: 1
              }}
            >
              {desk.count(summary)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

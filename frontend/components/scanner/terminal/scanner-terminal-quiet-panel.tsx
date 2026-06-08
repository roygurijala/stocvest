"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { buildScannerQuietSubline } from "@/lib/scanner-quiet-copy";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { ScannerTerminalSignalRow } from "@/lib/scanner/terminal/scanner-terminal-model";

type Props = {
  scanSummary: ScannerScanSummary | null;
  synthesis: ScannerSynthesis | null;
  swingDesk: DeskTodayData | null;
  dayDesk: DeskTodayData | null;
  developingClosest: ScannerTerminalSignalRow[];
  colors: ThemeColors;
  onSelectSymbol: (symbol: string, lane: "day" | "swing") => void;
};

function moverLine(desk: DeskTodayData | null, limit = 5): string | null {
  const rows = desk?.movers_radar ?? [];
  if (rows.length === 0) return null;
  return rows
    .slice(0, limit)
    .map((r) => `${r.symbol} ${r.gap_percent >= 0 ? "+" : ""}${r.gap_percent.toFixed(1)}%`)
    .join(" · ");
}

export function ScannerTerminalQuietPanel({
  scanSummary,
  synthesis,
  swingDesk,
  dayDesk,
  developingClosest,
  colors,
  onSelectSymbol
}: Props) {
  if (!scanSummary) return null;

  const headline = buildScannerQuietSubline(scanSummary, synthesis);
  const sessionMovers = moverLine(swingDesk) ?? moverLine(dayDesk);

  return (
    <section
      data-testid="scanner-terminal-quiet-panel"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: "rgba(46,139,255,.06)"
      }}
    >
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: colors.textMuted }}>
        Quiet session — what we are still watching
      </p>
      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>
        {headline}
      </p>
      {scanSummary.quiet.detail_line ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {scanSummary.quiet.detail_line}
        </p>
      ) : null}

      {sessionMovers ? (
        <div style={{ marginTop: spacing[3] }}>
          <p style={{ margin: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: colors.textMuted }}>
            Session activity
          </p>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.5 }}>
            {sessionMovers}
          </p>
        </div>
      ) : null}

      {developingClosest.length > 0 ? (
        <div style={{ marginTop: spacing[3] }}>
          <p style={{ margin: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: colors.textMuted }}>
            Building structure
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[2] }}>
            {developingClosest.slice(0, 6).map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelectSymbol(row.symbol, row.lane)}
                style={{
                  padding: `${spacing[1]} ${spacing[2]}`,
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  color: colors.text,
                  fontSize: typography.scale.xs,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                {row.symbol}
                {row.alignment ? ` · ${row.alignment.aligned}/${row.alignment.total}` : ""}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

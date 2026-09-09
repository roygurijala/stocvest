"use client";

/**
 * PositionCompareTable — ADR-004 POS-AI-6 visual head-to-head on `/dashboard/invest`.
 *
 * Renders the deterministic pillar diff matrix built by `buildPositionCompareMatrix` for the
 * 2–4 names the user selected. Glass box: every cell is the fixed gate/pillar output — no LLM,
 * no blended number. Per the locked compare contract it presents pillar-by-pillar differences
 * and NEVER crowns a single "best"/"winner". Informational screening only.
 */

import Link from "next/link";
import type { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import type { PositionCompareMatrix } from "@/lib/dashboard/position-ranked-home-present";

type Colors = ReturnType<typeof useTheme>["colors"];

type Props = {
  matrix: PositionCompareMatrix;
  colors: Colors;
  accentColor: string;
  onRemove?: (symbol: string) => void;
  onClear?: () => void;
};

function verdictColor(colors: Colors, verdict: string): string {
  const v = (verdict || "").trim().toLowerCase();
  if (v === "bullish") return colors.bullish;
  if (v === "bearish") return colors.bearish;
  return colors.textMuted;
}

function scoreText(score: number | null): string {
  return score != null ? `${score}` : "—";
}

export function PositionCompareTable({ matrix, colors, accentColor, onRemove, onClear }: Props) {
  if (matrix.status !== "ok" || matrix.columns.length < 2) return null;

  const cellPad = `${spacing[2]} ${spacing[2]}`;

  return (
    <section
      data-testid="position-compare-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[2],
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        padding: spacing[3],
        background: colors.surface
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2], flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
          Compare · {matrix.columns.length} names
        </h2>
        {onClear ? (
          <button
            type="button"
            data-testid="position-compare-clear"
            onClick={onClear}
            style={{
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              padding: `${spacing[1]} ${spacing[2]}`,
              cursor: "pointer"
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
          <caption style={{ captionSide: "bottom", textAlign: "left", padding: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            {matrix.note}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left", padding: cellPad, color: colors.textMuted, fontSize: typography.scale.xs, fontWeight: 600 }}>
                Pillar
              </th>
              {matrix.columns.map((col) => (
                <th key={col.symbol} scope="col" style={{ textAlign: "left", padding: cellPad, verticalAlign: "top" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: spacing[1] }}>
                    <Link href={col.href} style={{ color: accentColor, textDecoration: "none", fontWeight: 700 }}>
                      {col.symbol}
                    </Link>
                    {onRemove ? (
                      <button
                        type="button"
                        aria-label={`Remove ${col.symbol} from compare`}
                        data-testid={`position-compare-remove-${col.symbol}`}
                        onClick={() => onRemove(col.symbol)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: colors.textMuted,
                          cursor: "pointer",
                          fontSize: typography.scale.sm,
                          lineHeight: 1,
                          padding: 0
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, marginTop: 2 }}>{col.tierLabel}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: `1px solid ${colors.border}` }}>
              <th scope="row" style={{ textAlign: "left", padding: cellPad, color: colors.textMuted, fontSize: typography.scale.xs, fontWeight: 600 }}>
                Fundamentals
              </th>
              {matrix.columns.map((col) => (
                <td key={col.symbol} style={{ padding: cellPad, color: colors.text }}>
                  {scoreText(col.fundamentalsScore)}
                </td>
              ))}
            </tr>
            <tr style={{ borderTop: `1px solid ${colors.border}` }}>
              <th scope="row" style={{ textAlign: "left", padding: cellPad, color: colors.textMuted, fontSize: typography.scale.xs, fontWeight: 600 }}>
                Trend
              </th>
              {matrix.columns.map((col) => (
                <td key={col.symbol} style={{ padding: cellPad, color: colors.text }}>
                  {scoreText(col.technicalScore)}
                </td>
              ))}
            </tr>

            {matrix.pillarRows.map((row) => (
              <tr key={row.pillarId} data-testid={`position-compare-row-${row.pillarId}`} style={{ borderTop: `1px solid ${colors.border}` }}>
                <th scope="row" style={{ textAlign: "left", padding: cellPad, color: colors.textMuted, fontSize: typography.scale.xs, fontWeight: 600 }}>
                  <span style={{ color: colors.text }}>{row.pillarId}</span> · {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={matrix.columns[i]?.symbol ?? i} style={{ padding: cellPad }}>
                    {cell ? (
                      <span style={{ color: colors.text }}>
                        {scoreText(cell.score)}{" "}
                        <span style={{ color: verdictColor(colors, cell.verdict), fontSize: typography.scale.xs }}>
                          · {cell.verdictLabel}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: colors.textMuted }}>—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}

            <tr style={{ borderTop: `1px solid ${colors.border}` }}>
              <th scope="row" style={{ textAlign: "left", padding: cellPad, color: colors.textMuted, fontSize: typography.scale.xs, fontWeight: 600 }}>
                Weakest pillar
              </th>
              {matrix.columns.map((col) => (
                <td key={col.symbol} style={{ padding: cellPad, color: colors.caution }}>
                  {col.weakestLabel}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <SignalDisclaimerChip />
    </section>
  );
}

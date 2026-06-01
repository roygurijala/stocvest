"use client";

import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { GapIntelligenceItem, IntradaySetupPayload } from "@/lib/api/scanner";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";
import { useTheme } from "@/lib/theme-provider";

type LaneRow = {
  symbol: string;
  detail?: string;
  href: string;
};

type Props = {
  gapItems: GapIntelligenceItem[];
  setups: IntradaySetupPayload[];
  nearQualification: ScannerNearQualificationRow[];
  evaluationTrace: ScannerEvaluationTraceRow[];
  onExplainMissingSymbol?: (symbol: string) => void;
};

const PER_LANE_LIMIT = 6;

function uniqueRows(rows: LaneRow[], limit = PER_LANE_LIMIT): LaneRow[] {
  const seen = new Set<string>();
  const out: LaneRow[] = [];
  for (const row of rows) {
    const sym = row.symbol.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push({ ...row, symbol: sym });
    if (out.length >= limit) break;
  }
  return out;
}

function laneHref(symbol: string): string {
  return `/dashboard/signals?symbol=${encodeURIComponent(symbol.trim().toUpperCase())}`;
}

function actionableRows(setups: IntradaySetupPayload[]): LaneRow[] {
  const ranked = [...setups].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return uniqueRows(
    ranked.map((row) => ({
      symbol: row.symbol,
      detail: `${Math.round((Number(row.score) || 0) * 100)}% score`,
      href: laneHref(row.symbol)
    }))
  );
}

function nearRows(rows: ScannerNearQualificationRow[]): LaneRow[] {
  return uniqueRows(
    rows.map((row) => ({
      symbol: row.symbol,
      detail: row.alignment?.label ?? "Near threshold",
      href: laneHref(row.symbol)
    }))
  );
}

function potentialRows(
  gapItems: GapIntelligenceItem[],
  hidden: Set<string>
): LaneRow[] {
  const ranked = [...gapItems].sort(
    (a, b) => Math.abs(Number(b.gap_quality_score) || 0) - Math.abs(Number(a.gap_quality_score) || 0)
  );
  return uniqueRows(
    ranked
      .filter((row) => !hidden.has(row.symbol.trim().toUpperCase()))
      .map((row) => ({
        symbol: row.symbol,
        detail: `${row.gap_pct >= 0 ? "+" : ""}${row.gap_pct.toFixed(1)}% gap`,
        href: laneHref(row.symbol)
      }))
  );
}

function coolingRows(
  traceRows: ScannerEvaluationTraceRow[],
  hidden: Set<string>
): LaneRow[] {
  return uniqueRows(
    traceRows
      .filter((row) => row.gate === "score_floor" && !hidden.has(row.symbol.trim().toUpperCase()))
      .map((row) => ({
        symbol: row.symbol,
        detail: row.detail || "Lost score floor",
        href: laneHref(row.symbol)
      }))
  );
}

export function ScannerMoverLanes({
  gapItems,
  setups,
  nearQualification,
  evaluationTrace,
  onExplainMissingSymbol
}: Props) {
  const { colors } = useTheme();
  const actionable = actionableRows(setups);
  const near = nearRows(nearQualification);
  const hiddenForPotential = new Set([...actionable, ...near].map((r) => r.symbol));
  const potential = potentialRows(gapItems, hiddenForPotential);
  const hiddenForCooling = new Set([...hiddenForPotential, ...potential.map((r) => r.symbol)]);
  const cooling = coolingRows(evaluationTrace, hiddenForCooling);

  if (actionable.length + near.length + potential.length + cooling.length === 0) return null;

  return (
    <section
      data-testid="scanner-mover-lanes"
      style={{ display: "grid", gap: spacing[3] }}
    >
      <div
        style={{
          padding: spacing[4],
          borderRadius: borderRadius.xl,
          border: `1px solid ${colors.border}`,
          background: colors.surface
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
          Mover lanes
        </p>
        <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          Potential is watch-only. Actionable is the only trade-ready lane.
        </p>
        <div style={{ display: "grid", gap: spacing[3], gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <LaneCard
            title="Potential movers"
            subtitle="Watchlist candidates, not entries"
            tone="muted"
            rows={potential}
            onExplainMissingSymbol={onExplainMissingSymbol}
          />
          <LaneCard
            title="Near qualification"
            subtitle="Close, but still blocked"
            tone="warning"
            rows={near}
          />
          <LaneCard
            title="Actionable setups"
            subtitle="Meets qualification gates now"
            tone="active"
            rows={actionable}
          />
          <LaneCard
            title="Cooling"
            subtitle="Was close, then lost quality"
            tone="cooling"
            rows={cooling}
          />
        </div>
      </div>
    </section>
  );
}

function LaneCard({
  title,
  subtitle,
  tone,
  rows,
  onExplainMissingSymbol
}: {
  title: string;
  subtitle: string;
  tone: "muted" | "warning" | "active" | "cooling";
  rows: LaneRow[];
  onExplainMissingSymbol?: (symbol: string) => void;
}) {
  const { colors } = useTheme();
  const palette =
    tone === "active"
      ? { border: colors.bullish, bg: `color-mix(in srgb, ${colors.bullish} 10%, ${colors.surface})` }
      : tone === "warning"
        ? { border: colors.caution, bg: `color-mix(in srgb, ${colors.caution} 10%, ${colors.surface})` }
        : tone === "cooling"
          ? { border: colors.bearish, bg: `color-mix(in srgb, ${colors.bearish} 9%, ${colors.surface})` }
          : { border: colors.border, bg: colors.surfaceMuted };

  return (
    <article
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        padding: spacing[3],
        display: "grid",
        gap: spacing[2],
        minHeight: 140
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>{title}</p>
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>None this scan.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[1] }}>
          {rows.map((row) => (
            <li key={`${title}-${row.symbol}`} style={{ display: "flex", justifyContent: "space-between", gap: spacing[2] }}>
              <div style={{ display: "grid", gap: spacing[1], minWidth: 0 }}>
                <Link href={row.href} style={{ fontSize: typography.scale.xs, fontWeight: 700, color: colors.accent, textDecoration: "none" }}>
                  {row.symbol}
                </Link>
                {tone === "muted" && onExplainMissingSymbol ? (
                  <button
                    type="button"
                    data-testid={`scanner-potential-why-missing-${row.symbol}`}
                    onClick={() => onExplainMissingSymbol(row.symbol)}
                    style={{
                      justifySelf: "start",
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.sm,
                      background: colors.surface,
                      color: colors.textMuted,
                      padding: `2px ${spacing[1]}`,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    Why missing?
                  </button>
                ) : null}
              </div>
              <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{row.detail ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

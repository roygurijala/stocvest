"use client";

import type { ReactNode } from "react";
import { spacing, typography } from "@/lib/design-system";
import { borderRadius } from "@/lib/design-system";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { useTheme } from "@/lib/theme-provider";
import { ScannerCollapsible } from "@/components/scanner/ScannerCollapsible";

const CHIP_PREVIEW_LIMIT = 5;

type Props = {
  synthesis?: ScannerSynthesis | null;
  traceRows?: ScannerEvaluationTraceRow[];
  deskFilter?: "swing" | "day" | "all";
  /**
   * Render inline under Scan insight — no second toggle; typography + divider only.
   */
  flat?: boolean;
};

function gateLabel(gate: string): string {
  switch (gate) {
    case "session_rvol":
    case "session_volume":
      return "Session volume";
    case "liquidity":
      return "Liquidity";
    case "score_floor":
      return "Score floor";
    default:
      return gate.replace(/_/g, " ");
  }
}

export function ScannerEvaluationDetails({
  synthesis,
  traceRows = [],
  deskFilter = "day",
  flat = false
}: Props) {
  const { colors } = useTheme();

  const filteredTrace =
    deskFilter === "all" ? traceRows : traceRows.filter((r) => r.desk === deskFilter);

  const sessionVol = synthesis?.rejection_groups.session_volume ?? [];
  const liquidity = synthesis?.rejection_groups.liquidity ?? [];
  const structure = synthesis?.rejection_groups.structure ?? [];
  const hasSynthesis = sessionVol.length + liquidity.length + structure.length > 0;
  const hasTrace = filteredTrace.length > 0;

  if (!hasSynthesis && !hasTrace) return null;

  const broadMarketInsight =
    sessionVol.length >= 3 ? "This is a broad market condition — not symbol-specific." : null;

  const gateCount = sessionVol.length + liquidity.length + structure.length;
  const summaryHint = hasSynthesis
    ? `${gateCount} gate group${gateCount === 1 ? "" : "s"}`
    : `${filteredTrace.length} trace row${filteredTrace.length === 1 ? "" : "s"}`;

  const body = (
    <div data-testid="scanner-evaluation-details-body" style={{ display: "grid", gap: spacing[3] }}>
      {hasSynthesis ? (
        <>
          {sessionVol.length > 0 ? (
            <GroupBlock
              title="Low participation (market-wide)"
              hint={`${sessionVol.length} symbol${sessionVol.length === 1 ? "" : "s"} affected`}
              colors={colors}
            >
              <LimitedChipRow
                rows={sessionVol}
                colors={colors}
                renderChip={(r) => (
                  <>
                    {r.symbol}
                    <span style={{ color: "#d97706", fontWeight: 600 }}> −{Math.round(r.pct_below)}%</span>
                  </>
                )}
              />
            </GroupBlock>
          ) : null}
          {liquidity.length > 0 ? (
            <GroupBlock
              title={`Permanent liquidity filter · ${liquidity.length} symbol${liquidity.length === 1 ? "" : "s"}`}
              colors={colors}
            >
              <LimitedChipRow rows={liquidity} colors={colors} renderChip={(r) => r.symbol} />
            </GroupBlock>
          ) : null}
          {structure.length > 0 ? (
            <GroupBlock
              title={`Structure gates · ${structure.length} symbol${structure.length === 1 ? "" : "s"}`}
              colors={colors}
            >
              <LimitedChipRow
                rows={structure}
                colors={colors}
                renderChip={(r) => (
                  <>
                    {r.symbol}
                    <span style={{ color: colors.accent }}> · {r.reason}</span>
                  </>
                )}
              />
            </GroupBlock>
          ) : null}
          {broadMarketInsight ? (
            <p
              data-testid="scanner-evaluation-broad-market-insight"
              style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}
            >
              {broadMarketInsight}
            </p>
          ) : null}
        </>
      ) : (
        <LimitedChipRow
          rows={filteredTrace}
          colors={colors}
          renderChip={(row) => (
            <>
              {row.symbol}
              <span style={{ color: colors.textMuted }}> · {gateLabel(row.gate)}</span>
            </>
          )}
        />
      )}
    </div>
  );

  if (flat) {
    return (
      <section data-testid="scanner-evaluation-details" className="scanner-insight-details">
        <p className="scanner-insight-details__label">Details</p>
        {summaryHint ? <p className="scanner-insight-details__summary">{summaryHint}</p> : null}
        {body}
      </section>
    );
  }

  return (
    <ScannerCollapsible
      testId="scanner-evaluation-details"
      title="Evaluation details"
      hint={summaryHint}
      defaultOpen={false}
    >
      {body}
    </ScannerCollapsible>
  );
}

function GroupBlock({
  title,
  hint,
  colors,
  children
}: {
  title: string;
  hint?: string;
  colors: ReturnType<typeof useTheme>["colors"];
  children: ReactNode;
}) {
  return (
    <div>
      <p style={{ margin: `0 0 ${spacing[1]}`, fontSize: typography.scale.xs, fontWeight: 600, color: colors.text }}>
        {title}
      </p>
      {hint ? (
        <p style={{ margin: `0 0 ${spacing[2]}`, fontSize: typography.scale.xs, color: colors.textMuted }}>{hint}</p>
      ) : null}
      {children}
    </div>
  );
}

function LimitedChipRow<T extends { symbol: string }>({
  rows,
  colors,
  renderChip
}: {
  rows: T[];
  colors: ReturnType<typeof useTheme>["colors"];
  renderChip: (row: T) => ReactNode;
}) {
  const preview = rows.slice(0, CHIP_PREVIEW_LIMIT);
  const overflow = rows.length - preview.length;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
        {preview.map((row, i) => (
          <Chip key={`${row.symbol}-${i}`} colors={colors}>
            {renderChip(row)}
          </Chip>
        ))}
        {overflow > 0 ? (
          <span
            data-testid="scanner-evaluation-chip-overflow"
            style={{ alignSelf: "center", fontSize: typography.scale.xs, color: colors.textMuted }}
          >
            + {overflow} more
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Chip({ children, colors }: { children: ReactNode; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <span
      className="font-mono"
      style={{
        display: "inline-flex",
        padding: `${spacing[1]} ${spacing[2]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        fontSize: typography.scale.xs,
        color: colors.text
      }}
    >
      {children}
    </span>
  );
}

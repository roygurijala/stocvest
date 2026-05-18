"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { useTheme } from "@/lib/theme-provider";

const CHIP_PREVIEW_LIMIT = 5;

type Props = {
  synthesis?: ScannerSynthesis | null;
  traceRows?: ScannerEvaluationTraceRow[];
  deskFilter?: "swing" | "day" | "all";
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

export function ScannerEvaluationDetails({ synthesis, traceRows = [], deskFilter = "day" }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const filteredTrace =
    deskFilter === "all" ? traceRows : traceRows.filter((r) => r.desk === deskFilter);

  const sessionVol = synthesis?.rejection_groups.session_volume ?? [];
  const liquidity = synthesis?.rejection_groups.liquidity ?? [];
  const structure = synthesis?.rejection_groups.structure ?? [];
  const hasSynthesis = sessionVol.length + liquidity.length + structure.length > 0;
  const hasTrace = filteredTrace.length > 0;

  if (!hasSynthesis && !hasTrace) return null;

  const broadMarketInsight =
    sessionVol.length >= 3
      ? "This is a broad market condition — not symbol-specific."
      : null;

  return (
    <section
      data-testid="scanner-evaluation-details"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <button
        type="button"
        data-testid="scanner-evaluation-details-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2],
          padding: spacing[3],
          border: "none",
          background: "transparent",
          color: colors.text,
          cursor: "pointer",
          textAlign: "left"
        }}
      >
        <span>
          <span
            style={{
              display: "block",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Evaluation details
          </span>
          <span
            style={{
              display: "block",
              marginTop: spacing[1],
              fontSize: typography.scale.xs,
              color: colors.textMuted
            }}
          >
            Grouped gate results
          </span>
        </span>
        <ChevronDown
          size={16}
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s ease" }}
        />
      </button>

      {open ? (
        <div
          data-testid="scanner-evaluation-details-body"
          style={{ padding: `0 ${spacing[3]} ${spacing[3]}`, display: "grid", gap: spacing[3] }}
        >
          {hasSynthesis ? (
            <>
              {sessionVol.length > 0 ? (
                <GroupBlock
                  title="Low participation (market-wide)"
                  hint={`${sessionVol.length} symbol${sessionVol.length === 1 ? "" : "s"} affected`}
                  colors={colors}
                >
                  <LimitedChipRow rows={sessionVol} colors={colors} renderChip={(r) => (
                    <>
                      {r.symbol}
                      <span style={{ color: "#d97706", fontWeight: 600 }}> −{Math.round(r.pct_below)}%</span>
                    </>
                  )} />
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
      ) : null}
    </section>
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


"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { useTheme } from "@/lib/theme-provider";

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

  const evaluatedCount =
    sessionVol.length + liquidity.length + structure.length || filteredTrace.length;

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
            {evaluatedCount} symbol{evaluatedCount === 1 ? "" : "s"} · grouped gate results
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
                  title={`Session volume · ${sessionVol.length}`}
                  hint="Same market-wide condition"
                  colors={colors}
                >
                  <ChipRow>
                    {sessionVol.map((r) => (
                      <Chip key={r.symbol} colors={colors}>
                        {r.symbol}
                        <span style={{ color: "#d97706", fontWeight: 600 }}> −{Math.round(r.pct_below)}%</span>
                      </Chip>
                    ))}
                  </ChipRow>
                </GroupBlock>
              ) : null}
              {liquidity.length > 0 ? (
                <GroupBlock title={`Permanent liquidity filter · ${liquidity.length}`} colors={colors}>
                  <ChipRow>
                    {liquidity.map((r) => (
                      <Chip key={r.symbol} colors={colors}>
                        {r.symbol}
                      </Chip>
                    ))}
                  </ChipRow>
                  <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                    Not related to today&apos;s session — structural universe minimum.
                  </p>
                </GroupBlock>
              ) : null}
              {structure.length > 0 ? (
                <GroupBlock title={`Structure gates · ${structure.length}`} colors={colors}>
                  <ChipRow>
                    {structure.map((r) => (
                      <Chip key={`${r.symbol}-${r.reason}`} colors={colors}>
                        {r.symbol}
                        <span style={{ color: colors.accent }}> · {r.reason}</span>
                      </Chip>
                    ))}
                  </ChipRow>
                </GroupBlock>
              ) : null}
            </>
          ) : (
            <ChipRow>
              {filteredTrace.map((row) => (
                <Chip key={`${row.symbol}-${row.gate}`} colors={colors}>
                  {row.symbol}
                  <span style={{ color: colors.textMuted }}> · {gateLabel(row.gate)}</span>
                </Chip>
              ))}
            </ChipRow>
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

function ChipRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>{children}</div>;
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

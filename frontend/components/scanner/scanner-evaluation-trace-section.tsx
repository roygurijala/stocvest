"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  rows: ScannerEvaluationTraceRow[];
  deskFilter?: "swing" | "day" | "all";
};

function gateLabel(gate: string): string {
  switch (gate) {
    case "session_rvol":
      return "Session volume";
    case "session_volume":
      return "Session volume";
    case "score_floor":
      return "Score floor";
    case "liquidity":
      return "Liquidity";
    case "min_price":
      return "Price floor";
    case "insufficient_bars":
      return "Bar history";
    case "insufficient_history":
      return "Daily history";
    case "no_triggers":
      return "No triggers";
    default:
      return gate.replace(/_/g, " ");
  }
}

export function ScannerEvaluationTraceSection({ rows, deskFilter = "all" }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const filtered =
    deskFilter === "all" ? rows : rows.filter((r) => r.desk === deskFilter);
  if (filtered.length === 0) return null;

  return (
    <section
      data-testid="scanner-evaluation-trace"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <button
        type="button"
        data-testid="scanner-evaluation-trace-toggle"
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
            Symbols evaluated · did not qualify
          </span>
          <span
            style={{
              display: "block",
              marginTop: spacing[1],
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              lineHeight: 1.5
            }}
          >
            Engine evaluation detail for this scan — not a watchlist and not a trade recommendation.
          </span>
        </span>
        <ChevronDown
          size={16}
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 0.15s ease"
          }}
        />
      </button>
      {open ? (
        <ul
          data-testid="scanner-evaluation-trace-list"
          style={{
            margin: 0,
            padding: `0 ${spacing[3]} ${spacing[3]}`,
            listStyle: "none",
            display: "grid",
            gap: spacing[2]
          }}
        >
          {filtered.map((row) => (
            <li
              key={`${row.symbol}-${row.desk}-${row.gate}`}
              style={{
                padding: spacing[2],
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`,
                background: colors.surface
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: spacing[2]
                }}
              >
                <span className="font-mono font-bold" style={{ color: colors.text }}>
                  {row.symbol}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: colors.textMuted
                  }}
                >
                  {row.desk}
                </span>
                <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.accent }}>
                  {gateLabel(row.gate)}
                </span>
              </div>
              <p
                style={{
                  margin: `${spacing[1]} 0 0`,
                  fontSize: typography.scale.xs,
                  color: colors.textMuted,
                  lineHeight: 1.5
                }}
              >
                {row.detail}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

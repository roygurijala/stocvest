"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ScannerSynthesisRejectionGroups } from "@/lib/scanner-synthesis";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  groups: ScannerSynthesisRejectionGroups;
  qualifiedCount?: number;
  evaluatedCount?: number;
};

function CollapsibleGroup({
  testId,
  title,
  tag,
  tagColor,
  contextLine,
  defaultOpen,
  children
}: {
  testId: string;
  title: string;
  tag: string;
  tagColor: string;
  contextLine?: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      data-testid={testId}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <button
        type="button"
        data-testid={`${testId}-toggle`}
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
          <span style={{ display: "block", fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
            {title}
          </span>
          <span style={{ display: "inline-block", marginTop: spacing[1], fontSize: 10, fontWeight: 700, color: tagColor }}>
            {tag}
          </span>
          {contextLine ? (
            <span
              style={{
                display: "block",
                marginTop: spacing[1],
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.5
              }}
            >
              {contextLine}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={16}
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s ease" }}
        />
      </button>
      {open ? <div style={{ padding: `0 ${spacing[3]} ${spacing[3]}` }}>{children}</div> : null}
    </div>
  );
}

export function RejectionGroups({ groups, qualifiedCount = 0, evaluatedCount }: Props) {
  const { colors } = useTheme();
  const session = groups.session_volume;
  const liquidity = groups.liquidity;
  const structure = groups.structure;
  const totalEvaluated =
    evaluatedCount ??
    session.length + liquidity.length + structure.length + (groups.other?.length ?? 0);

  if (totalEvaluated === 0 && qualifiedCount === 0) return null;

  const subtitle =
    qualifiedCount > 0
      ? `${qualifiedCount} setup${qualifiedCount === 1 ? "" : "s"} qualified · ${totalEvaluated} evaluated`
      : "No setups met all required gates this scan";

  return (
    <section data-testid="scanner-rejection-groups" style={{ display: "grid", gap: spacing[3] }}>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Scan outcome
        </p>
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      </div>

      {session.length > 0 ? (
        <CollapsibleGroup
          testId="scanner-rejection-session-volume"
          title={`Volume below threshold · ${session.length} symbol${session.length === 1 ? "" : "s"}`}
          tag="Session volume"
          tagColor="#d97706"
          contextLine="All affected by the same market-wide condition"
          defaultOpen
        >
          <ChipGrid>
            {session.map((row) => (
              <span
                key={row.symbol}
                data-testid={`scanner-rejection-chip-${row.symbol}`}
                className="font-mono"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: spacing[1],
                  padding: `${spacing[1]} ${spacing[2]}`,
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  fontSize: typography.scale.xs,
                  color: colors.text
                }}
              >
                {row.symbol}
                <span style={{ color: "#d97706", fontWeight: 600 }}>−{Math.round(row.pct_below)}%</span>
              </span>
            ))}
          </ChipGrid>
        </CollapsibleGroup>
      ) : null}

      {liquidity.length > 0 ? (
        <CollapsibleGroup
          testId="scanner-rejection-liquidity"
          title={`Universe filter · permanent · ${liquidity.length} symbol${liquidity.length === 1 ? "" : "s"}`}
          tag="Liquidity"
          tagColor={colors.textMuted}
          defaultOpen={false}
        >
          <ChipGrid>
            {liquidity.map((row) => (
              <span
                key={row.symbol}
                data-testid={`scanner-rejection-liquidity-chip-${row.symbol}`}
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
                {row.symbol}
              </span>
            ))}
          </ChipGrid>
          <p
            data-testid="scanner-rejection-liquidity-note"
            style={{
              margin: `${spacing[2]} 0 0`,
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              lineHeight: 1.5
            }}
          >
            These symbols do not meet the minimum liquidity threshold on any day. Not related to today&apos;s
            conditions.
          </p>
        </CollapsibleGroup>
      ) : null}

      {structure.length > 0 ? (
        <CollapsibleGroup
          testId="scanner-rejection-structure"
          title={`Structure gates · ${structure.length} symbol${structure.length === 1 ? "" : "s"}`}
          tag="Technical"
          tagColor={colors.accent}
          defaultOpen={false}
        >
          <ChipGrid>
            {structure.map((row) => (
              <span
                key={`${row.symbol}-${row.reason}`}
                className="font-mono"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: spacing[1],
                  padding: `${spacing[1]} ${spacing[2]}`,
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  fontSize: typography.scale.xs,
                  color: colors.text
                }}
              >
                {row.symbol}
                <span style={{ color: colors.accent, fontWeight: 500 }}>{row.reason}</span>
              </span>
            ))}
          </ChipGrid>
        </CollapsibleGroup>
      ) : null}
    </section>
  );
}

function ChipGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }} data-testid="scanner-rejection-chip-grid">
      {children}
    </div>
  );
}

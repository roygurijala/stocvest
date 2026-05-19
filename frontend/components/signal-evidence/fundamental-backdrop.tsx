"use client";

import type { CSSProperties } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { SignalEvidenceFundamentalContext } from "@/lib/signal-evidence";
import {
  buildFundamentalContextPresentation,
  FUNDAMENTAL_CONTEXT_FOOTER
} from "@/lib/signal-evidence/fundamental-present";
import { UpgradePrompt } from "@/components/upgrade-prompt";

type FundamentalBackdropProps = {
  context: SignalEvidenceFundamentalContext | null | undefined;
  isPaid: boolean;
  mode: "day" | "swing" | undefined;
};

const BACKDROP_CHIP_STYLES: Record<
  "positive" | "neutral" | "mixed" | "weak",
  { border: string; background: string; color: string }
> = {
  positive: {
    border: "1px solid rgba(34,197,94,0.45)",
    background: "rgba(34,197,94,0.1)",
    color: "#16a34a"
  },
  neutral: {
    border: "1px solid rgba(148,163,184,0.35)",
    background: "rgba(148,163,184,0.08)",
    color: "inherit"
  },
  mixed: {
    border: "1px solid rgba(245,158,11,0.45)",
    background: "rgba(245,158,11,0.1)",
    color: "#d97706"
  },
  weak: {
    border: "1px solid rgba(239,68,68,0.45)",
    background: "rgba(239,68,68,0.1)",
    color: "#dc2626"
  }
};

function SectionHeader({ optionalOnly = false }: { optionalOnly?: boolean }) {
  const { colors } = useTheme();
  return (
    <div
      style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: spacing[2] }}
    >
      <h3 style={{ margin: 0, fontSize: typography.scale.sm, letterSpacing: "0.06em" }}>FUNDAMENTAL CONTEXT (optional)</h3>
      {!optionalOnly ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>(not scored)</span>
      ) : null}
    </div>
  );
}

function PillarList({ pillars }: { pillars: Array<{ label: string; text: string }> }) {
  const { colors } = useTheme();
  if (pillars.length === 0) return null;
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "grid",
        gap: spacing[1],
        fontSize: typography.scale.sm,
        color: colors.text
      }}
    >
      {pillars.map((row) => (
        <li key={row.label}>
          <span style={{ fontWeight: 600 }}>{row.label}:</span> {row.text}
        </li>
      ))}
    </ul>
  );
}

export function FundamentalBackdropPanel({ context, isPaid, mode }: FundamentalBackdropProps) {
  const { colors } = useTheme();

  if (mode === "day") {
    return null;
  }

  const shell: CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    display: "grid",
    gap: spacing[2]
  };

  if (!isPaid) {
    return (
      <section data-testid="fundamental-backdrop-upgrade" style={shell}>
        <SectionHeader optionalOnly />
        <UpgradePrompt
          feature="Fundamental backdrop"
          plan="Swing Pro"
          description="Upgrade to see earnings, guidance, and analyst activity as context alongside your swing read."
        />
      </section>
    );
  }

  const presentation = buildFundamentalContextPresentation(context);
  const chipStyle = presentation.backdropChip
    ? BACKDROP_CHIP_STYLES[presentation.backdropChip.tone]
    : null;

  return (
    <section data-testid={context ? "fundamental-backdrop-panel" : "fundamental-backdrop-unavailable"} style={shell}>
      <SectionHeader />

      {presentation.narrative.map((line) => (
        <p
          key={line}
          style={{
            margin: 0,
            fontSize: typography.scale.sm,
            color: colors.text,
            lineHeight: 1.55,
            fontWeight: line.startsWith("No fundamental") ? 600 : 400
          }}
        >
          {line}
        </p>
      ))}

      {presentation.backdropChip && chipStyle ? (
        <div
          style={{
            borderRadius: borderRadius.md,
            padding: spacing[2],
            border: chipStyle.border,
            background: chipStyle.background
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, fontSize: typography.scale.sm, color: chipStyle.color }}>
            {presentation.backdropChip.icon} {presentation.backdropChip.label}
          </p>
        </div>
      ) : null}

      <PillarList pillars={presentation.pillars} />

      {presentation.sectorLine ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>{presentation.sectorLine}</p>
      ) : null}

      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, fontStyle: "italic" }}>
        {FUNDAMENTAL_CONTEXT_FOOTER}
      </p>
    </section>
  );
}

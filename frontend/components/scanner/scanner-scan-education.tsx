"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ScannerEmptyStateContext } from "@/lib/scanner-empty-state";
import { useTheme } from "@/lib/theme-provider";

type Panel = {
  id: string;
  title: string;
  context: ScannerEmptyStateContext;
};

type Props = {
  panels: Panel[];
};

export function ScannerScanEducation({ panels }: Props) {
  const { colors } = useTheme();
  if (panels.length === 0) return null;

  return (
    <section
      id="scanner-scan-education"
      data-testid="scanner-scan-education"
      style={{
        display: "grid",
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
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
        Why this scan looks quiet
      </p>
      {panels.map((p) => (
        <EducationCollapsible key={p.id} panel={p} />
      ))}
    </section>
  );
}

function EducationCollapsible({ panel }: { panel: Panel }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const ctx = panel.context;
  const bullets =
    "reenableBullets" in ctx && Array.isArray(ctx.reenableBullets) ? ctx.reenableBullets : [];

  return (
    <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: spacing[2] }}>
      <button
        type="button"
        data-testid={`scanner-education-${panel.id}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2],
          border: "none",
          background: "transparent",
          color: colors.text,
          fontSize: typography.scale.sm,
          fontWeight: 600,
          cursor: "pointer",
          padding: 0,
          textAlign: "left"
        }}
      >
        <span>▶ {panel.title}</span>
        <ChevronDown
          size={16}
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 150ms ease",
            color: colors.textMuted
          }}
        />
      </button>
      {open ? (
        <div style={{ marginTop: spacing[2], fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.55 }}>
          <p style={{ margin: `0 0 ${spacing[2]}`, color: colors.text }}>{ctx.oneLiner}</p>
          {bullets.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {bullets.slice(0, 5).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

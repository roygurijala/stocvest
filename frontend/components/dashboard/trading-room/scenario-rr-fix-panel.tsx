"use client";

import { useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { ScenarioRrFixGuidance } from "@/lib/scenario/scenario-rr-fix-guidance";

const QUALITY_LABEL: Record<ScenarioRrFixGuidance["levers"][number]["quality"], string> = {
  best: "Best path",
  medium: "Alternative",
  risky: "Last resort"
};

export function ScenarioRrFixPanel({
  guidance,
  colors
}: {
  guidance: ScenarioRrFixGuidance;
  colors: ThemeColors;
}) {
  const [expanded, setExpanded] = useState(false);
  const best = guidance.levers[0];

  return (
    <div
      data-testid="scenario-rr-fix-panel"
      style={{
        marginTop: spacing[3],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted ?? colors.surface
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        What would clear the gate?
      </p>
      <p style={{ margin: "8px 0 0", fontSize: typography.scale.sm, lineHeight: 1.5, color: colors.text }}>
        {guidance.diagnosis}
      </p>
      {best ? (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: typography.scale.sm,
            lineHeight: 1.5,
            fontWeight: 600,
            color: colors.caution
          }}
        >
          {best.label}: {best.thresholdText}
        </p>
      ) : null}
      <p style={{ margin: "8px 0 0", fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        Current: {guidance.riskReward.toFixed(1)}:1 (risk ${guidance.riskPerShare.toFixed(2)} · reward $
        {guidance.rewardPerShare.toFixed(2)}) · need ≥ {guidance.minRr.toFixed(1)}:1 (reward $
        {guidance.requiredReward.toFixed(2)})
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          marginTop: spacing[2],
          padding: 0,
          border: "none",
          background: "transparent",
          color: colors.bullish,
          fontSize: typography.scale.xs,
          fontWeight: 600,
          cursor: "pointer"
        }}
      >
        {expanded ? "Hide calculation" : "Show calculation"}
      </button>
      {expanded ? (
        <ul
          style={{
            margin: `${spacing[2]} 0 0`,
            paddingLeft: 18,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.55
          }}
        >
          {guidance.levers.map((lever) => (
            <li key={lever.id} style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: colors.text }}>{QUALITY_LABEL[lever.quality]}:</span>{" "}
              {lever.label} — {lever.thresholdText}. {lever.detail}
              <span style={{ display: "block", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                {lever.calcLine}
              </span>
            </li>
          ))}
          {guidance.warnings.map((w) => (
            <li key={w} style={{ color: colors.caution }}>
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

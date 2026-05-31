"use client";

import { Check, Minus } from "lucide-react";
import type { PlanningGatesPayload } from "@/lib/signal-evidence/planning-gates-present";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  gates: PlanningGatesPayload;
  testId?: string;
};

export function PlanningGatesPanel({ gates, testId = "signal-evidence-planning-gates" }: Props) {
  const { colors } = useTheme();

  return (
    <section
      data-testid={testId}
      style={{
        marginTop: spacing[3],
        marginBottom: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted }}>
          PLANNING CONTEXT
        </span>
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 600,
            color: gates.all_favorable ? colors.bullish : colors.caution
          }}
        >
          {gates.regime_tag} · {gates.all_favorable ? "checks favorable" : "review warnings"}
        </span>
      </div>
      <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.text }}>
        {gates.summary}
      </p>
      <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
        {gates.checks.map((check) => (
          <li key={check.id} className="flex gap-2 text-xs leading-snug" data-testid={`${testId}-${check.id}`}>
            {check.pass ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: colors.bullish }} aria-hidden />
            ) : (
              <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: colors.caution }} aria-hidden />
            )}
            <span style={{ color: colors.text }}>
              <span className="font-semibold">{check.label}</span>
              {" — "}
              <span style={{ color: colors.textMuted }}>{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-2 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
        {gates.disclaimer}
      </p>
    </section>
  );
}

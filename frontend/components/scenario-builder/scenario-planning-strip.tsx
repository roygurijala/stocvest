"use client";

import { useMemo } from "react";
import { BuildScenarioButton } from "@/components/scenario-builder/build-scenario-button";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import {
  buildIneligibilityTooltip,
  isEligibleForScenario,
  scenarioIneligibilityLabel
} from "@/lib/scenario/eligibility";
import type { ScenarioInput } from "@/lib/scenario/types";
import { useTheme } from "@/lib/theme-provider";

type ScenarioPlanningStripProps = {
  input: ScenarioInput;
  testId?: string;
  /** Tighter layout for table rows / watchlist cards. */
  compact?: boolean;
  className?: string;
};

/**
 * High-visibility Scenario Builder entry — title, planning disclaimer, and CTA.
 * Surfaces why the builder is unavailable when eligibility fails.
 */
export function ScenarioPlanningStrip({
  input,
  testId = "scenario-planning-strip",
  compact = false,
  className = ""
}: ScenarioPlanningStripProps) {
  const { colors } = useTheme();
  const eligibility = useMemo(() => isEligibleForScenario(input), [input]);
  const tooltip = useMemo(() => buildIneligibilityTooltip(eligibility), [eligibility]);
  const primaryReason = eligibility.reasons[0]
    ? scenarioIneligibilityLabel(eligibility.reasons[0])
    : null;

  return (
    <section
      data-testid={testId}
      className={`${surfaceGlowClassName} ${className}`.trim()}
      style={{
        display: "flex",
        flexDirection: compact ? "column" : undefined,
        flexWrap: "wrap",
        alignItems: compact ? "stretch" : "center",
        justifyContent: "space-between",
        gap: compact ? spacing[3] : spacing[4],
        padding: compact ? spacing[3] : `${spacing[3]} ${spacing[4]}`,
        borderRadius: borderRadius.lg,
        border: `2px solid ${eligibility.eligible ? colors.accent : "rgba(245, 158, 11, 0.55)"}`,
        background: eligibility.eligible
          ? `color-mix(in srgb, ${colors.accent} 8%, ${colors.surface})`
          : `color-mix(in srgb, rgba(245, 158, 11, 0.12) 40%, ${colors.surface})`
      }}
    >
      <div className="min-w-0 flex-1">
        <p
          className="m-0 font-semibold uppercase tracking-[0.12em]"
          style={{
            fontSize: compact ? typography.scale.xs : typography.scale.sm,
            color: eligibility.eligible ? colors.accent : "#f59e0b"
          }}
        >
          Scenario builder
        </p>
        <p
          className="m-0 mt-1 leading-relaxed"
          style={{
            fontSize: compact ? typography.scale.xs : typography.scale.sm,
            color: colors.textMuted,
            maxWidth: compact ? undefined : "42rem"
          }}
        >
          {eligibility.eligible
            ? "Size risk and R-multiples against reference levels. STOCVEST does not submit or persist trades to a broker."
            : primaryReason ?? "Structural inputs are incomplete for this symbol."}
        </p>
        {!eligibility.eligible && !compact ? (
          <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }} title={tooltip}>
            Hover the button for the full checklist. Open Signals evidence for the richest reference levels.
          </p>
        ) : null}
      </div>
      <div className={compact ? "shrink-0" : "shrink-0 self-center"}>
        <BuildScenarioButton
          input={input}
          variant="prominent"
          compact={compact}
          testId={`${testId}-button`}
        />
      </div>
    </section>
  );
}

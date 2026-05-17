"use client";

import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import { ScenarioBuilderModal } from "@/components/scenario-builder/scenario-builder-modal";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  buildIneligibilityTooltip,
  isEligibleForScenario
} from "@/lib/scenario/eligibility";
import type { ScenarioInput } from "@/lib/scenario/types";
import { useTheme } from "@/lib/theme-provider";

interface BuildScenarioButtonProps {
  /** Full scenario payload — eligibility gate runs against this. */
  input: ScenarioInput;
  /**
   * Optional layout override for narrow contexts (table rows). Renders
   * a compact pill-sized button without changing semantics.
   */
  compact?: boolean;
  /** Stronger visual weight for primary planning surfaces. */
  variant?: "default" | "prominent";
  /**
   * Optional override for the `data-testid` so multiple instances in
   * the same DOM tree (e.g. a grid of gap cards) can be distinguished
   * in tests. Defaults to `build-scenario-button`.
   */
  testId?: string;
}

/**
 * "Build scenario" CTA.
 *
 * UX contract this component honors (intentionally, do not loosen):
 *
 *   - When eligible: button is enabled, the label reads "Build scenario,"
 *     hovering it shows "Ready to build scenario."
 *   - When ineligible: button is disabled, the label reads "Scenario
 *     unavailable," hovering shows the concatenated list of structural
 *     failure reasons.
 *   - The button NEVER reads "Place order," "Stage order," "Draft trade,"
 *     "Recommended," or anything that implies execution / endorsement.
 *   - Visual treatment is *deliberately neutral* (slate, not the accent
 *     blue we used for "Open order entry"). This re-categorizes the
 *     affordance from "execution" to "planning" at a glance.
 */
export function BuildScenarioButton({
  input,
  compact = false,
  variant = "default",
  testId = "build-scenario-button"
}: BuildScenarioButtonProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const eligibility = useMemo(() => isEligibleForScenario(input), [input]);
  const tooltip = useMemo(() => buildIneligibilityTooltip(eligibility), [eligibility]);

  const label = eligibility.eligible ? "Build scenario" : "Scenario unavailable";
  const labelLong = eligibility.eligible ? tooltip : `Scenario unavailable — ${tooltip}`;

  const prominent = variant === "prominent";
  const pad = compact
    ? `${spacing[2]} ${spacing[3]}`
    : prominent
      ? `${spacing[3]} ${spacing[5]}`
      : `${spacing[2]} ${spacing[4]}`;
  const fontSize = compact ? typography.scale.xs : prominent ? typography.scale.base : typography.scale.sm;
  const iconSize = compact ? 13 : prominent ? 16 : 14;

  const eligibleBorder = prominent ? colors.accent : colors.border;
  const ineligibleBorder = prominent ? "rgba(245, 158, 11, 0.65)" : colors.border;
  const eligibleBg = prominent
    ? `color-mix(in srgb, ${colors.accent} 14%, ${colors.surfaceMuted})`
    : colors.surfaceMuted;

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        data-eligible={eligibility.eligible ? "true" : "false"}
        data-variant={variant}
        aria-disabled={!eligibility.eligible}
        disabled={!eligibility.eligible}
        title={labelLong}
        onClick={() => {
          if (eligibility.eligible) setOpen(true);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[2],
          padding: pad,
          fontSize,
          fontWeight: 700,
          color: eligibility.eligible ? colors.text : prominent ? colors.text : colors.textMuted,
          background: eligibility.eligible ? eligibleBg : prominent ? colors.surfaceMuted : "transparent",
          border: `${prominent ? 2 : 1}px solid ${eligibility.eligible ? eligibleBorder : ineligibleBorder}`,
          borderRadius: borderRadius.md,
          cursor: eligibility.eligible ? "pointer" : "not-allowed",
          opacity: eligibility.eligible ? 1 : prominent ? 0.92 : 0.55,
          whiteSpace: "nowrap",
          minHeight: prominent && !compact ? 44 : undefined,
          boxShadow: prominent && eligibility.eligible ? `0 0 0 1px color-mix(in srgb, ${colors.accent} 25%, transparent)` : undefined
        }}
      >
        <Calculator size={iconSize} aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && eligibility.eligible ? (
        <ScenarioBuilderModal open={open} input={input} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

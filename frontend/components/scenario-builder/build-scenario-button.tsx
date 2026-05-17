"use client";

import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import { ScenarioBuilderModal } from "@/components/scenario-builder/scenario-builder-modal";
import { ScenarioBuilderPreviewModal } from "@/components/scenario-builder/scenario-builder-preview-modal";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  resolveScenarioBuilderCapability,
  type ScenarioReadinessContext
} from "@/lib/scenario/scenario-readiness";
import type { ScenarioInput } from "@/lib/scenario/types";
import { useTheme } from "@/lib/theme-provider";

interface BuildScenarioButtonProps {
  input: ScenarioInput;
  /** Layer / maturation / decision context — gates modal content, not button access. */
  readiness?: ScenarioReadinessContext | null;
  compact?: boolean;
  variant?: "default" | "prominent";
  testId?: string;
}

/**
 * Scenario Builder — always clickable. Preview / building-soon / full sheet
 * depends on setup readiness and structural completeness.
 */
export function BuildScenarioButton({
  input,
  readiness = null,
  compact = false,
  variant = "default",
  testId = "build-scenario-button"
}: BuildScenarioButtonProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const readinessCtx: ScenarioReadinessContext = useMemo(
    () =>
      readiness ?? {
        symbol: input.symbol,
        mode: input.mode,
        setupBias: null,
        hasReferenceLevels: undefined
      },
    [readiness, input.symbol, input.mode]
  );

  const resolved = useMemo(
    () => resolveScenarioBuilderCapability(readinessCtx, input),
    [readinessCtx, input]
  );

  const label = "Scenario Builder";
  const tooltip =
    resolved.capability === "full"
      ? "Open full scenario planning for this setup."
      : resolved.capability === "building_soon"
        ? "Setup approaching validity — preview what is still needed."
        : "Preview readiness and missing confirmations — full builder unlocks when the setup is actionable.";

  const prominent = variant === "prominent";
  const pad = compact
    ? `${spacing[2]} ${spacing[3]}`
    : prominent
      ? `${spacing[3]} ${spacing[5]}`
      : `${spacing[2]} ${spacing[4]}`;
  const fontSize = compact ? typography.scale.xs : prominent ? typography.scale.base : typography.scale.sm;
  const iconSize = compact ? 13 : prominent ? 16 : 14;

  const accentBorder =
    resolved.capability === "full"
      ? colors.accent
      : resolved.capability === "building_soon"
        ? "rgba(245, 158, 11, 0.65)"
        : colors.border;
  const accentBg = prominent
    ? `color-mix(in srgb, ${resolved.capability === "full" ? colors.accent : "#f59e0b"} 14%, ${colors.surfaceMuted})`
    : colors.surfaceMuted;

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        data-capability={resolved.capability}
        data-eligible={resolved.capability === "full" ? "true" : "false"}
        data-variant={variant}
        title={tooltip}
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[2],
          padding: pad,
          fontSize,
          fontWeight: 700,
          color: colors.text,
          background: accentBg,
          border: `${prominent ? 2 : 1}px solid ${accentBorder}`,
          borderRadius: borderRadius.md,
          cursor: "pointer",
          whiteSpace: "nowrap",
          minHeight: prominent && !compact ? 44 : undefined,
          boxShadow:
            prominent && resolved.capability === "full"
              ? `0 0 0 1px color-mix(in srgb, ${colors.accent} 25%, transparent)`
              : undefined
        }}
      >
        <Calculator size={iconSize} aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && resolved.capability === "full" ? (
        <ScenarioBuilderModal open={open} input={input} onClose={() => setOpen(false)} />
      ) : null}
      {open && resolved.capability !== "full" ? (
        <ScenarioBuilderPreviewModal
          open={open}
          input={input}
          resolved={resolved}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

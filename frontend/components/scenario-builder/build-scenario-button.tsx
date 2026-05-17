"use client";

import { Calculator } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ScenarioBuilderModal } from "@/components/scenario-builder/scenario-builder-modal";
import { ScenarioBuilderPreviewModal } from "@/components/scenario-builder/scenario-builder-preview-modal";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  resolveScenarioBuilderCapability,
  type ScenarioReadinessContext,
  type ScenarioReadinessResolved
} from "@/lib/scenario/scenario-readiness";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import type { ScenarioInput } from "@/lib/scenario/types";
import { useTheme } from "@/lib/theme-provider";

type ModalSession = {
  input: ScenarioInput;
  resolved: ScenarioReadinessResolved;
};

interface BuildScenarioButtonProps {
  input: ScenarioInput;
  /** Layer / maturation / decision context — gates modal content, not button access. */
  readiness?: ScenarioReadinessContext | null;
  compact?: boolean;
  variant?: "default" | "prominent";
  testId?: string;
  drillDown?: ScenarioBuilderDrillDown;
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
  testId = "build-scenario-button",
  drillDown
}: BuildScenarioButtonProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  /** Frozen at open so watchlist maturation / snapshot refreshes do not swap modals mid-flight. */
  const [session, setSession] = useState<ModalSession | null>(null);

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
      ? "Open full scenario planning — setup and execution window are both available."
      : "Preview setup and execution status. Full planning unlocks when both alignment and session conditions clear.";

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

  const handleOpen = useCallback(() => {
    setSession({ input, resolved });
    setOpen(true);
  }, [input, resolved]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSession(null);
  }, []);

  const drillDownResolved: ScenarioBuilderDrillDown = drillDown ?? {
    surface: "signals"
  };

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const modal =
    open && session && typeof document !== "undefined"
      ? createPortal(
          session.resolved.capability === "full" ? (
            <ScenarioBuilderModal open input={session.input} onClose={handleClose} />
          ) : (
            <ScenarioBuilderPreviewModal
              open
              input={session.input}
              resolved={session.resolved}
              drillDown={drillDownResolved}
              onClose={handleClose}
            />
          ),
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        data-capability={resolved.capability}
        data-eligible={resolved.capability === "full" ? "true" : "false"}
        data-variant={variant}
        title={tooltip}
        onClick={handleOpen}
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
      {modal}
    </>
  );
}

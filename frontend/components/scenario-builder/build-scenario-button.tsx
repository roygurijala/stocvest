"use client";

import { Calculator } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ScenarioBuilderModal } from "@/components/scenario-builder/scenario-builder-modal";
import { ScenarioBuilderPreviewModal } from "@/components/scenario-builder/scenario-builder-preview-modal";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  resolveScenarioBuilderCapability,
  type ScenarioReadinessContext,
  type ScenarioReadinessResolved
} from "@/lib/scenario/scenario-readiness";
import { useScenarioPreviewPanels } from "@/lib/hooks/use-scenario-preview-panels";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import {
  buildScenarioPreviewPanelData,
  type ScenarioPreviewPanelData
} from "@/lib/scenario/scenario-preview-panels";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import type { ScenarioExecutionTiming } from "@/lib/scenario/scenario-execution-timing";
import { useTheme } from "@/lib/theme-provider";

type ModalSession = {
  input: ScenarioInput;
  resolved: ScenarioReadinessResolved;
  systemDecision: TradeDecision;
  executionTiming?: ScenarioExecutionTiming;
};

function fallbackSystemDecision(): TradeDecision {
  return {
    state: "monitor",
    line: "Setup status unavailable — treat scenario math as exploratory only.",
    reinforcements: [],
    rationale: null
  };
}

interface BuildScenarioButtonProps {
  input: ScenarioInput;
  /** Layer / maturation / decision context — gates modal content, not button access. */
  readiness?: ScenarioReadinessContext | null;
  compact?: boolean;
  variant?: "default" | "prominent";
  testId?: string;
  drillDown?: ScenarioBuilderDrillDown;
  /** Pre-built layer/session panels (Signals, Watchlist, Evidence). Scanner omits this to auto-fetch. */
  previewPanels?: ScenarioPreviewPanelData;
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
  drillDown,
  previewPanels: previewPanelsProp
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
      ? "Plan entry, stop, and target — verdict banner shows whether desk gates clear for your geometry."
      : "Reference stop and target are required before the planning sheet can open.";

  const prominent = variant === "prominent";
  const pad = compact
    ? `${spacing[2]} ${spacing[3]}`
    : prominent
      ? `${spacing[3]} ${spacing[5]}`
      : `${spacing[2]} ${spacing[4]}`;
  const fontSize = compact ? typography.scale.xs : prominent ? typography.scale.base : typography.scale.sm;
  const iconSize = compact ? 13 : prominent ? 16 : 14;

  const accentBorder =
    resolved.capability === "full" ? colors.accent : colors.border;
  const accentBg = prominent
    ? `color-mix(in srgb, ${resolved.capability === "full" ? colors.accent : colors.caution} 14%, ${colors.surfaceMuted})`
    : colors.surfaceMuted;

  const handleOpen = useCallback(() => {
    const systemDecision =
      readinessCtx.systemDecision ?? fallbackSystemDecision();
    setSession({
      input,
      resolved,
      systemDecision,
      executionTiming: {
        entryTimingWeak: readinessCtx.entryTimingWeak,
        vwapConflict: readinessCtx.vwapConflict
      }
    });
    setOpen(true);
  }, [input, resolved, readinessCtx.systemDecision, readinessCtx.entryTimingWeak, readinessCtx.vwapConflict]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSession(null);
  }, []);

  const drillDownResolved: ScenarioBuilderDrillDown = drillDown ?? {
    surface: "signals"
  };

  const autoFetchPanels =
    drillDownResolved.surface === "scanner" || drillDownResolved.surface === "watchlist";
  const autoPanels = useScenarioPreviewPanels({
    symbol: input.symbol,
    mode: input.mode,
    surface: drillDownResolved.surface,
    executionTier: session?.resolved.executionTier ?? resolved.executionTier,
    enabled: open && autoFetchPanels && !previewPanelsProp,
    setupBias: readinessCtx.setupBias ?? null,
    gapGate: input.gap_intel_gate
  });

  const previewPanels: ScenarioPreviewPanelData =
    previewPanelsProp ??
    (autoFetchPanels
      ? autoPanels
      : buildScenarioPreviewPanelData({
          symbol: input.symbol,
          mode: input.mode,
          setupBias: readinessCtx.setupBias ?? "Neutral",
          executionTier: session?.resolved.executionTier ?? resolved.executionTier,
          surface: drillDownResolved.surface,
          gapGate: input.gap_intel_gate,
          loadingLayers: true
        }));

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  const modal =
    open && session && typeof document !== "undefined"
      ? createPortal(
          session.resolved.capability === "full" ? (
            <ScenarioBuilderModal
              open
              input={session.input}
              systemDecision={session.systemDecision}
              executionTiming={session.executionTiming}
              onClose={handleClose}
            />
          ) : (
            <ScenarioBuilderPreviewModal
              open
              input={session.input}
              resolved={session.resolved}
              drillDown={drillDownResolved}
              previewPanels={previewPanels}
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

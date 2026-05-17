"use client";

import { useMemo } from "react";

import { useGapIntel } from "@/lib/hooks/use-gap-intel";
import { useSignalComposite } from "@/lib/hooks/use-signal-composite";
import {
  buildScenarioPreviewPanelData,
  type ScenarioPreviewPanelData
} from "@/lib/scenario/scenario-preview-panels";
import { deriveSetupBiasFromComposite } from "@/lib/signals/composite-layer-rows";
import type { ScenarioBuilderSurface } from "@/lib/scenario/scenario-builder-drill-down";
import type { ScenarioExecutionTier } from "@/lib/scenario/scenario-readiness";
import type { ScenarioInput } from "@/lib/scenario/types";

export function useScenarioPreviewPanels(args: {
  symbol: string;
  mode: "day" | "swing";
  surface: ScenarioBuilderSurface;
  executionTier: ScenarioExecutionTier;
  enabled: boolean;
  setupBias?: "Bullish" | "Bearish" | "Neutral" | null;
  gapGate?: ScenarioInput["gap_intel_gate"];
}): ScenarioPreviewPanelData {
  const sym = args.symbol.trim().toUpperCase();
  const { composite, isInitialLoading: compositeLoading } = useSignalComposite(sym, args.mode, {
    enabled: args.enabled && Boolean(sym)
  });
  const { snapshot: gapIntel, isInitialLoading: gapLoading } = useGapIntel(sym, args.mode, {
    enabled: args.enabled && Boolean(sym)
  });

  return useMemo(() => {
    const bias =
      args.setupBias ??
      deriveSetupBiasFromComposite(composite, []) ??
      ("Neutral" as const);
    return buildScenarioPreviewPanelData({
      symbol: sym,
      mode: args.mode,
      setupBias: bias,
      composite,
      gapIntel,
      gapGate: args.gapGate,
      executionTier: args.executionTier,
      surface: args.surface,
      loadingLayers: compositeLoading || gapLoading
    });
  }, [
    sym,
    args.mode,
    args.setupBias,
    args.surface,
    args.executionTier,
    args.gapGate,
    composite,
    gapIntel,
    compositeLoading,
    gapLoading
  ]);
}

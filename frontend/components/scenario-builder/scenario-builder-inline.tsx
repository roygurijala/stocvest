"use client";

import { BuildScenarioButton } from "@/components/scenario-builder/build-scenario-button";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { ScenarioReadinessContext } from "@/lib/scenario/scenario-readiness";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";

type ScenarioBuilderInlineProps = {
  input: ScenarioInput;
  readiness?: ScenarioReadinessContext | null;
  drillDown?: ScenarioBuilderDrillDown;
  testId?: string;
  compact?: boolean;
  /** Watchlist / scanner use subtle styling; Signals / Evidence stay prominent. */
  prominent?: boolean;
};

/**
 * Compact Scenario Builder entry for symbol / watchlist toolbars (no separate strip).
 */
export function ScenarioBuilderInline({
  input,
  readiness = null,
  drillDown,
  testId = "scenario-builder-inline",
  compact = true,
  prominent = false
}: ScenarioBuilderInlineProps) {
  return (
    <span className="inline-flex shrink-0 items-center" data-testid={testId}>
      <BuildScenarioButton
        input={input}
        readiness={readiness}
        variant={prominent ? "prominent" : "default"}
        compact={compact}
        testId={`${testId}-button`}
        drillDown={drillDown}
      />
    </span>
  );
}

"use client";

import { BuildScenarioButton } from "@/components/scenario-builder/build-scenario-button";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { ScenarioReadinessContext } from "@/lib/scenario/scenario-readiness";

type ScenarioBuilderInlineProps = {
  input: ScenarioInput;
  readiness?: ScenarioReadinessContext | null;
  testId?: string;
  compact?: boolean;
};

/**
 * Compact Scenario Builder entry for symbol / watchlist toolbars (no separate strip).
 */
export function ScenarioBuilderInline({
  input,
  readiness = null,
  testId = "scenario-builder-inline",
  compact = true
}: ScenarioBuilderInlineProps) {
  return (
    <span className="inline-flex shrink-0 items-center" data-testid={testId}>
      <BuildScenarioButton
        input={input}
        readiness={readiness}
        variant="prominent"
        compact={compact}
        testId={`${testId}-button`}
      />
    </span>
  );
}

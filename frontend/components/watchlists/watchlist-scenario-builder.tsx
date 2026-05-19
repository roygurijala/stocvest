"use client";

import { useMemo } from "react";
import { ScenarioBuilderInline } from "@/components/scenario-builder/scenario-builder-inline";
import type { SnapshotPayload } from "@/lib/api/market";
import { buildScenarioPlanningBundle } from "@/lib/scenario/scenario-planning-bundle";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

type Props = {
  symbol: string;
  mode: "day" | "swing";
  snapshot?: SnapshotPayload;
  maturation?: WatchlistMaturationRow;
  testId?: string;
};

/**
 * Watchlist Scenario Builder — list rows use maturation + quote only.
 * Composite / gap-intel load when the user opens the builder (see BuildScenarioButton).
 */
export function WatchlistScenarioBuilder({ symbol, mode, snapshot, maturation, testId }: Props) {
  const symU = symbol.trim().toUpperCase();

  const bundle = useMemo(
    () =>
      buildScenarioPlanningBundle({
        symbol: symU,
        tradingMode: mode,
        snapshot,
        maturation
      }),
    [symU, mode, snapshot, maturation]
  );

  return (
    <span
      className="inline-flex shrink-0 items-center"
      data-testid={testId ?? `build-scenario-watchlist-${symU}`}
      data-scenario-source={bundle.fromComposite ? "composite" : "maturation-or-snapshot"}
    >
      <ScenarioBuilderInline
        input={bundle.input}
        readiness={bundle.readiness}
        drillDown={{ surface: "watchlist" }}
        compact
        testId={`${testId ?? `build-scenario-watchlist-${symU}`}-button`}
      />
    </span>
  );
}

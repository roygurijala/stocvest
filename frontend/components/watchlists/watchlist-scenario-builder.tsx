"use client";

import { useMemo } from "react";
import { ScenarioBuilderInline } from "@/components/scenario-builder/scenario-builder-inline";
import type { SnapshotPayload } from "@/lib/api/market";
import { useSignalComposite } from "@/lib/hooks/use-signal-composite";
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
 * Watchlist Scenario Builder — uses the same composite-backed bundle as Signals.
 */
export function WatchlistScenarioBuilder({ symbol, mode, snapshot, maturation, testId }: Props) {
  const symU = symbol.trim().toUpperCase();
  const { composite } = useSignalComposite(symU, mode, { enabled: Boolean(symU) });

  const bundle = useMemo(
    () =>
      buildScenarioPlanningBundle({
        symbol: symU,
        tradingMode: mode,
        composite,
        snapshot,
        maturation
      }),
    [symU, mode, composite, snapshot, maturation]
  );

  return (
    <span
      className="inline-flex shrink-0 items-center"
      data-testid={testId ?? `build-scenario-watchlist-${symU}`}
      data-scenario-source={bundle.fromComposite ? "composite" : "snapshot"}
    >
      <ScenarioBuilderInline
        input={bundle.input}
        readiness={bundle.readiness}
        compact
        testId={`${testId ?? `build-scenario-watchlist-${symU}`}-button`}
      />
    </span>
  );
}

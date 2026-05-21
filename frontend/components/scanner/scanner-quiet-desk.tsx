"use client";

import { useMemo } from "react";
import { ScannerMarketConditionsCard } from "@/components/scanner/scanner-market-conditions-card";
import { ScannerNearReadyZone } from "@/components/scanner/scanner-near-ready-zone";
import { RejectionGroups } from "@/components/scanner/RejectionGroups";
import { WhatWouldChangeFooter } from "@/components/scanner/WhatWouldChangeFooter";
import { buildMarketConditionsQuietCard } from "@/lib/scanner-quiet-copy";
import {
  buildNearReadyCards,
  buildWhatWouldChangeContent
} from "@/lib/scanner/scanner-quiet-desk";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { spacing } from "@/lib/design-system";

type Props = {
  summary: ScannerScanSummary;
  synthesis?: ScannerSynthesis | null;
  deskFilter: "swing" | "day" | "all";
};

/**
 * Quiet-scan body: closest to qualifying → market conditions → scan outcome → what to watch.
 * (Hero strip above carries session chrome + headline only.)
 */
export function ScannerQuietDesk({ summary, synthesis, deskFilter }: Props) {
  const regimeLabel = summary.regime.label;

  const marketConditions = useMemo(
    () => buildMarketConditionsQuietCard(summary, synthesis),
    [summary, synthesis]
  );

  const nearCards = useMemo(
    () => buildNearReadyCards(summary.near_qualification, regimeLabel, deskFilter),
    [summary.near_qualification, regimeLabel, deskFilter]
  );

  const whatWouldChangeContent = useMemo(
    () => buildWhatWouldChangeContent(synthesis, regimeLabel, nearCards.map((c) => c.symbol)),
    [synthesis, regimeLabel, nearCards]
  );

  return (
    <div data-testid="scanner-quiet-desk" style={{ display: "grid", gap: spacing[4] }}>
      <ScannerNearReadyZone cards={nearCards} regimeLabel={regimeLabel} />

      <ScannerMarketConditionsCard model={marketConditions} />

      {synthesis ? (
        <RejectionGroups
          groups={synthesis.rejection_groups}
          qualifiedCount={summary.qualifying.total}
          evaluatedCount={summary.universe.symbols_evaluated ?? undefined}
          regimeLabel={regimeLabel}
          spyPct={summary.regime.spy_pct}
          qqqPct={summary.regime.qqq_pct}
        />
      ) : null}

      <WhatWouldChangeFooter content={whatWouldChangeContent} />
    </div>
  );
}

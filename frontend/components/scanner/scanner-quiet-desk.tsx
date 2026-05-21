"use client";

import { useMemo } from "react";
import { ScannerMarketConditionsCard } from "@/components/scanner/scanner-market-conditions-card";
import { ScannerNearReadyZone } from "@/components/scanner/scanner-near-ready-zone";
import { RejectionGroups } from "@/components/scanner/RejectionGroups";
import { WhatWouldChangeFooter } from "@/components/scanner/WhatWouldChangeFooter";
import {
  buildMarketConditionsQuietCard,
  sessionVolumeIsPrimaryBlocker,
  shouldShowQuietWhatWouldChangeSection
} from "@/lib/scanner-quiet-copy";
import {
  buildNearReadyCards,
  buildScanOutcomeWatchHint,
  buildVolumeProximityLeads,
  buildWhatWouldChangeContent,
  volumeLeadToNearReadyCard
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
 * Quiet-scan body: closest to qualifying → market conditions → scan outcome.
 * Full “what would change” only when the cause is not already obvious (mixed / complex).
 */
export function ScannerQuietDesk({ summary, synthesis, deskFilter }: Props) {
  const regimeLabel = summary.regime.label;

  const marketConditions = useMemo(
    () => buildMarketConditionsQuietCard(summary, synthesis),
    [summary, synthesis]
  );

  const nearCards = useMemo(() => {
    const structural = buildNearReadyCards(summary.near_qualification, regimeLabel, deskFilter);
    const seen = new Set(structural.map((c) => c.symbol));
    const volLeads = buildVolumeProximityLeads(synthesis, seen, structural.length === 0 ? 2 : 1);
    const volCards = volLeads.map((lead, i) => volumeLeadToNearReadyCard(lead, regimeLabel, i));
    return [...structural, ...volCards];
  }, [summary.near_qualification, regimeLabel, deskFilter, synthesis]);

  const volumeLeaderSymbols = useMemo(() => {
    const fromCards = nearCards.filter((c) => c.source === "volume").map((c) => c.symbol);
    if (fromCards.length > 0) return fromCards;
    return buildVolumeProximityLeads(synthesis, new Set(), 2).map((l) => l.symbol);
  }, [nearCards, synthesis]);

  const showFullGuidance = useMemo(
    () => shouldShowQuietWhatWouldChangeSection(summary, synthesis),
    [summary, synthesis]
  );

  const scanWatchHint = useMemo(() => {
    if (showFullGuidance || !sessionVolumeIsPrimaryBlocker(summary, synthesis)) return null;
    return buildScanOutcomeWatchHint(volumeLeaderSymbols);
  }, [showFullGuidance, summary, synthesis, volumeLeaderSymbols]);

  const whatWouldChangeContent = useMemo(() => {
    if (!showFullGuidance) return null;
    return buildWhatWouldChangeContent(
      synthesis,
      regimeLabel,
      nearCards.filter((c) => c.source === "alignment").map((c) => c.symbol),
      volumeLeaderSymbols
    );
  }, [showFullGuidance, synthesis, regimeLabel, nearCards, volumeLeaderSymbols]);

  return (
    <div data-testid="scanner-quiet-desk" style={{ display: "grid", gap: spacing[4] }}>
      <ScannerNearReadyZone cards={nearCards} regimeLabel={regimeLabel} />

      <ScannerMarketConditionsCard model={marketConditions} />

      {synthesis ? (
        <RejectionGroups
          groups={synthesis.rejection_groups}
          qualifiedCount={summary.qualifying.total}
          evaluatedCount={summary.universe.symbols_evaluated ?? undefined}
          watchHint={scanWatchHint}
        />
      ) : null}

      {whatWouldChangeContent ? <WhatWouldChangeFooter content={whatWouldChangeContent} /> : null}
    </div>
  );
}

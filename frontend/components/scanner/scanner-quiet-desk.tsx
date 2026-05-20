"use client";

import { useMemo } from "react";
import { ScannerDevelopingUniverse } from "@/components/scanner/scanner-developing-universe";
import { ScannerNearReadyZone } from "@/components/scanner/scanner-near-ready-zone";
import { ScannerQuietMarketBanner } from "@/components/scanner/scanner-quiet-market-banner";
import { RejectionGroups } from "@/components/scanner/RejectionGroups";
import { WhatWouldChangeFooter } from "@/components/scanner/WhatWouldChangeFooter";
import { buildSwingReenableBulletsShort } from "@/lib/dashboard-posture";
import {
  buildDevelopingMovementGroups,
  buildNearReadyCards,
  regimeBlocksDesk,
  synthesizeWhatWouldChange
} from "@/lib/scanner/scanner-quiet-desk";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: ScannerScanSummary;
  synthesis?: ScannerSynthesis | null;
  causeBullets: string[];
  marketScopeLine?: string | null;
  deskFilter: "swing" | "day" | "all";
  weeklyAvgPct5d?: number | null;
};

export function ScannerQuietDesk({
  summary,
  synthesis,
  causeBullets,
  marketScopeLine,
  deskFilter,
  weeklyAvgPct5d = null
}: Props) {
  const { colors } = useTheme();
  const regimeLabel = summary.regime.label;

  const nearCards = useMemo(
    () => buildNearReadyCards(summary.near_qualification, regimeLabel, deskFilter),
    [summary.near_qualification, regimeLabel, deskFilter]
  );

  const nearSymbolSet = useMemo(() => new Set(nearCards.map((c) => c.symbol)), [nearCards]);

  const developingGroups = useMemo(
    () =>
      buildDevelopingMovementGroups(summary.watchlist_progression, deskFilter, nearSymbolSet),
    [summary.watchlist_progression, deskFilter, nearSymbolSet]
  );

  const developingCount =
    developingGroups.improving.length +
    developingGroups.stable.length +
    developingGroups.weakening.length;

  const footnote = regimeBlocksDesk(regimeLabel)
    ? "Bearish regime prevents trading against the tape — individual alignment alone does not clear swing gates."
    : undefined;

  const whatWouldChange = synthesizeWhatWouldChange(
    synthesis,
    regimeLabel,
    nearCards.map((c) => c.symbol)
  );

  const reenable = buildSwingReenableBulletsShort({
    regimeLabel,
    sectorTape: "mixed",
    weeklyAvgPct5d
  });

  return (
    <div data-testid="scanner-quiet-desk" style={{ display: "grid", gap: spacing[4] }}>
      <ScannerQuietMarketBanner regimeLabel={regimeLabel} bullets={causeBullets} footnote={footnote} />

      {marketScopeLine ? (
        <p
          data-testid="scanner-market-scope-line"
          style={{
            margin: 0,
            fontSize: typography.scale.sm,
            fontWeight: 500,
            color: colors.textMuted,
            lineHeight: 1.45
          }}
        >
          {marketScopeLine}
        </p>
      ) : null}

      <ScannerNearReadyZone cards={nearCards} regimeLabel={regimeLabel} />

      <ScannerDevelopingUniverse groups={developingGroups} totalCount={developingCount} />

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

      <WhatWouldChangeFooter text={whatWouldChange || reenable.join(" ")} />
    </div>
  );
}

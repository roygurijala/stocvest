"use client";

import { WatchlistDecisionCardFromRow } from "@/components/watchlists/watchlist-decision-card";
import { ScannerCollapsible } from "@/components/scanner/ScannerCollapsible";
import {
  groupSymbolsIntoAttentionTiers,
  sortSymbolsInAttentionTier,
  watchlistAttentionSectionMeta,
  type WatchlistAttentionTier
} from "@/lib/watchlist-decision-card-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import type { SnapshotPayload } from "@/lib/api/market";
import { spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { useMemo } from "react";

const TIER_ORDER: WatchlistAttentionTier[] = ["check_now", "getting_close", "tracking"];

/** Tracking tier starts collapsed when it holds this many symbols or more. */
export const WATCHLIST_TRACKING_COLLAPSE_MIN = 6;

type Props = {
  symbols: string[];
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined;
  snapshotForSymbol: (sym: string) => SnapshotPayload | undefined;
  planMode: "swing" | "day";
  deskEvaluatingForSymbol?: (sym: string) => boolean | undefined;
  onRemove: (sym: string) => void;
  onRefresh?: (sym: string) => void;
  /** Tiers that must be expanded (e.g. after search jump or add). */
  forceOpenTiers?: WatchlistAttentionTier[];
  /** Symbol to show a short-lived “Just added” badge on. */
  justAddedSymbol?: string | null;
};

function tierCardListClass(tier: WatchlistAttentionTier, count: number): string {
  if (tier === "check_now" || count < 3) {
    return "m-0 flex list-none flex-col gap-2 p-0";
  }
  return "m-0 grid list-none grid-cols-1 gap-2 p-0 lg:grid-cols-2";
}

function tierCountHint(tier: WatchlistAttentionTier, count: number): string {
  const meta = watchlistAttentionSectionMeta(tier);
  if (count === 1) return `1 symbol · ${meta.subtitle}`;
  return `${count} symbols · ${meta.subtitle}`;
}

function TierCardList({
  tier,
  list,
  rowForSymbol,
  snapshotForSymbol,
  planMode,
  deskEvaluatingForSymbol,
  onRemove,
  onRefresh,
  justAddedSymbol
}: {
  tier: WatchlistAttentionTier;
  list: string[];
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined;
  snapshotForSymbol: (sym: string) => SnapshotPayload | undefined;
  planMode: "swing" | "day";
  deskEvaluatingForSymbol?: (sym: string) => boolean | undefined;
  onRemove: (sym: string) => void;
  onRefresh?: (sym: string) => void;
  justAddedSymbol?: string | null;
}) {
  const justAddedU = justAddedSymbol?.trim().toUpperCase() ?? "";
  return (
    <ul className={tierCardListClass(tier, list.length)} data-testid={`watchlist-tier-list-${tier}`}>
      {list.map((symU) => (
        <li key={symU} id={`watchlist-row-${symU}`} data-watchlist-tier={tier}>
          <WatchlistDecisionCardFromRow
            symbol={symU}
            row={rowForSymbol(symU)}
            snapshot={snapshotForSymbol(symU)}
            planMode={planMode}
            deskEvaluating={deskEvaluatingForSymbol?.(symU)}
            justAdded={justAddedU === symU}
            onRemove={() => onRemove(symU)}
            onRefresh={onRefresh ? () => onRefresh(symU) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}

export function WatchlistDecisionQueue({
  symbols,
  rowForSymbol,
  snapshotForSymbol,
  planMode,
  deskEvaluatingForSymbol,
  onRemove,
  onRefresh,
  forceOpenTiers,
  justAddedSymbol
}: Props) {
  const { colors } = useTheme();
  const grouped = useMemo(
    () => groupSymbolsIntoAttentionTiers(symbols, rowForSymbol),
    [symbols, rowForSymbol]
  );
  const forceOpenSet = useMemo(() => new Set(forceOpenTiers ?? []), [forceOpenTiers]);

  return (
    <div className="flex flex-col" style={{ gap: spacing[4] }} data-testid="watchlist-decision-queue">
      {TIER_ORDER.map((tier) => {
        const list = sortSymbolsInAttentionTier(grouped[tier], rowForSymbol);
        if (list.length === 0) return null;
        const meta = watchlistAttentionSectionMeta(tier);
        const hint = tierCountHint(tier, list.length);
        const cards = (
          <TierCardList
            tier={tier}
            list={list}
            rowForSymbol={rowForSymbol}
            snapshotForSymbol={snapshotForSymbol}
            planMode={planMode}
            deskEvaluatingForSymbol={deskEvaluatingForSymbol}
            onRemove={onRemove}
            onRefresh={onRefresh}
            justAddedSymbol={justAddedSymbol}
          />
        );

        if (tier === "check_now") {
          return (
            <section key={tier} data-testid={`watchlist-tier-${tier}`}>
              <header className="mb-2 flex flex-wrap items-baseline gap-2">
                <h3 className="m-0 text-sm font-bold tracking-wide" style={{ color: colors.text }}>
                  <span aria-hidden>{meta.icon} </span>
                  {meta.title}
                </h3>
                <span className="text-xs" style={{ color: colors.textMuted }}>
                  {hint}
                </span>
              </header>
              {cards}
            </section>
          );
        }

        const defaultOpen =
          tier === "getting_close" ? true : list.length < WATCHLIST_TRACKING_COLLAPSE_MIN;

        return (
          <ScannerCollapsible
            key={tier}
            testId={`watchlist-tier-${tier}`}
            title={`${meta.icon} ${meta.title}`}
            hint={hint}
            defaultOpen={defaultOpen}
            forceOpen={forceOpenSet.has(tier)}
            persistSessionKey={`watchlist-tier-${tier}`}
            embedded
          >
            {cards}
          </ScannerCollapsible>
        );
      })}
    </div>
  );
}

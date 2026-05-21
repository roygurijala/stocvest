"use client";

import { WatchlistDecisionCardFromRow } from "@/components/watchlists/watchlist-decision-card";
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

type Props = {
  symbols: string[];
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined;
  snapshotForSymbol: (sym: string) => SnapshotPayload | undefined;
  planMode: "swing" | "day";
  deskEvaluatingForSymbol?: (sym: string) => boolean | undefined;
  onRemove: (sym: string) => void;
  onRefresh?: (sym: string) => void;
};

export function WatchlistDecisionQueue({
  symbols,
  rowForSymbol,
  snapshotForSymbol,
  planMode,
  deskEvaluatingForSymbol,
  onRemove,
  onRefresh
}: Props) {
  const { colors } = useTheme();
  const grouped = useMemo(
    () => groupSymbolsIntoAttentionTiers(symbols, rowForSymbol),
    [symbols, rowForSymbol]
  );

  return (
    <div className="flex flex-col" style={{ gap: spacing[4] }} data-testid="watchlist-decision-queue">
      {TIER_ORDER.map((tier) => {
        const list = sortSymbolsInAttentionTier(grouped[tier], rowForSymbol);
        if (list.length === 0) return null;
        const meta = watchlistAttentionSectionMeta(tier);
        return (
          <section key={tier} data-testid={`watchlist-tier-${tier}`}>
            <header className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="m-0 text-sm font-bold tracking-wide" style={{ color: colors.text }}>
                <span aria-hidden>{meta.icon} </span>
                {meta.title}
              </h3>
              <span className="text-xs" style={{ color: colors.textMuted }}>
                {meta.subtitle}
              </span>
            </header>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {list.map((symU) => (
                <li key={symU} id={`watchlist-row-${symU}`}>
                  <WatchlistDecisionCardFromRow
                    symbol={symU}
                    row={rowForSymbol(symU)}
                    snapshot={snapshotForSymbol(symU)}
                    planMode={planMode}
                    deskEvaluating={deskEvaluatingForSymbol?.(symU)}
                    onRemove={() => onRemove(symU)}
                    onRefresh={onRefresh ? () => onRefresh(symU) : undefined}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

"use client";

import {
  WATCHLIST_SORT_OPTIONS,
  WATCHLIST_TIER_GROUPING_LINES,
  watchlistSortModeDetail,
  type WatchlistSortMode
} from "@/lib/watchlist-sort-preference";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  sortMode: WatchlistSortMode;
};

export function WatchlistOrderExplainer({ sortMode }: Props) {
  const { colors } = useTheme();
  const sortLabel = WATCHLIST_SORT_OPTIONS.find((o) => o.value === sortMode)?.label ?? "Attention";

  return (
    <details
      data-testid="watchlist-order-explainer"
      className="rounded-lg border px-3 py-2 text-xs leading-relaxed"
      style={{ borderColor: colors.border, background: colors.surfaceMuted, color: colors.textMuted }}
    >
      <summary
        className="cursor-pointer select-none font-semibold"
        style={{ color: colors.text }}
      >
        How symbols are ordered
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="m-0">
          Symbols are grouped by layer alignment (out of 6), then sorted within each group using your Sort cards
          setting.
        </p>
        <div>
          <p className="m-0 mb-1 font-semibold" style={{ color: colors.text }}>
            Groups (top to bottom)
          </p>
          <ul className="m-0 list-disc pl-4">
            {WATCHLIST_TIER_GROUPING_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <p className="m-0">
          <span className="font-semibold" style={{ color: colors.text }}>
            Current sort ({sortLabel}):
          </span>{" "}
          {watchlistSortModeDetail(sortMode)}
        </p>
      </div>
    </details>
  );
}
